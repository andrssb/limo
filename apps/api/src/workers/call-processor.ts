import { Worker } from "bullmq";
import { createRedis } from "../lib/redis.js";
import { getDb } from "@limo/db";
import { calls, callAnalyses, contacts, users } from "@limo/db";
import { eq } from "drizzle-orm";
import { transcribeAudioUrl, transcribeTwoTrackUrls } from "../services/transcription.js";
import { analyzeCall } from "../services/ai.js";
import { getTeamKnowledgeContext } from "../services/coaching.js";
import { QUEUES, addJob, type CallProcessJob } from "../lib/queue.js";

export function startCallProcessorWorker(): Worker {
  const worker = new Worker<CallProcessJob>(
    QUEUES.CALL_PROCESS,
    async (job) => {
      const { callId } = job.data;
      const db = getDb();

      const [call] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
      if (!call) throw new Error(`Call ${callId} not found`);

      const hasTracks = !!(call.sdrAudioUrl && call.leadAudioUrl);
      if (!call.audioUrl && !hasTracks) {
        await db.update(calls).set({ transcriptionStatus: "failed" }).where(eq(calls.id, callId));
        return;
      }

      // Step 1: Transcribe. Com 2 trilhas separadas → diarização REAL (cada lado
      // numa trilha). Caso contrário, fallback no áudio único (heurística de falante).
      await db.update(calls).set({ transcriptionStatus: "processing" }).where(eq(calls.id, callId));

      const { text, segments } = hasTracks
        ? await transcribeTwoTrackUrls(call.sdrAudioUrl!, call.leadAudioUrl!)
        : await transcribeAudioUrl(call.audioUrl!);

      await db.update(calls).set({
        transcriptionStatus: "done",
        transcriptionText: text,
        transcriptionSegments: segments as any,
        analysisStatus: "processing",
      }).where(eq(calls.id, callId));

      // Step 2: Fetch contact (se houver) + team knowledge (product + playbook).
      // Calls sem contato (ex.: reunião de qualificação no Meet) derivam o time
      // a partir do próprio usuário.
      const contact = call.contactId
        ? (await db.select().from(contacts).where(eq(contacts.id, call.contactId)).limit(1))[0]
        : undefined;

      let teamId = contact?.teamId ?? null;
      if (!teamId) {
        const [u] = await db.select({ teamId: users.teamId }).from(users).where(eq(users.id, call.userId)).limit(1);
        teamId = u?.teamId ?? null;
      }
      const teamKnowledge = teamId
        ? await getTeamKnowledgeContext(teamId).catch(() => "")
        : "";

      // Step 3: Analyze (grounded in the product/playbook the team sells)
      const analysis = await analyzeCall({
        segments,
        contactName: contact ? `${contact.firstName} ${contact.lastName}` : "Lead",
        companyName: contact?.companyName ?? null,
        jobTitle: contact?.jobTitle ?? null,
        durationSeconds: call.durationSeconds ?? segments.reduce((a, s) => Math.max(a, s.endMs), 0) / 1000,
        teamKnowledge,
      });

      // Step 4: Store analysis
      await db.insert(callAnalyses).values({
        callId,
        result: analysis.result,
        flashSummary: analysis.flashSummary,
        diagnosis: analysis.diagnosis as any,
        nextStep: analysis.nextStep,
        keyMoments: analysis.keyMoments as any,
        talkRatio: analysis.talkRatio,
        sentimentScore: analysis.sentimentScore,
        // Fase 3 — score detalhado, frameworks e análise de conversão/perda.
        score: (analysis.score ?? null) as any,
        frameworks: (analysis.frameworks ?? null) as any,
        outcome: (analysis.outcome ?? null) as any,
      });

      await db.update(calls).set({
        analysisStatus: "done",
        result: analysis.result,
      }).where(eq(calls.id, callId));

      // Trigger CRM sync so the call is logged in connected CRMs (só com contato)
      if (call.contactId) {
        await addJob(QUEUES.CRM_SYNC, "sync-with-call", {
          contactId: call.contactId,
          userId: call.userId,
          callId,
        });
      }

      job.log(`Call ${callId} processed: ${analysis.result}`);
    },
    { connection: createRedis(), concurrency: 3 }
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const db = getDb();
    await db.update(calls)
      .set({ transcriptionStatus: "failed", analysisStatus: "failed" })
      .where(eq(calls.id, job.data.callId));
    console.error(`[CallProcessor] Job ${job.id} failed:`, err.message);
  });

  return worker;
}
