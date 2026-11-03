import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "@limo/db";
import { calls, callAnalyses, contacts } from "@limo/db";
import { eq, and, desc, count, gte, lte, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { uploadAudio } from "../lib/storage.js";
import { addJob, QUEUES } from "../lib/queue.js";
import { ingestCall } from "../services/call-ingestion.js";
import { randomUUID } from "crypto";

const createCallSchema = z.object({
  contactId: z.string().uuid(),
  type: z.enum(["whatsapp", "manual", "imported"]),
  direction: z.enum(["inbound", "outbound"]).default("outbound"),
  startedAt: z.string().datetime(),
});

// Ingestão normalizada agnóstica ao canal (Fase 0). Aceita uma gravação única
// (audioUrl — típico de VoIP/upload) OU duas trilhas (diarização real do navegador).
const ingestCallSchema = z
  .object({
    contactId:      z.string().uuid().optional(),
    channel:        z.enum(["browser", "voip", "upload", "whatsapp"]),
    direction:      z.enum(["inbound", "outbound"]).default("outbound"),
    startedAt:      z.string().datetime().optional(),
    endedAt:        z.string().datetime().optional(),
    durationSeconds: z.number().int().positive().optional(),
    audioUrl:       z.string().url().optional(),
    sdrAudioUrl:    z.string().url().optional(),
    leadAudioUrl:   z.string().url().optional(),
    sourceMeta:     z.record(z.unknown()).optional(),
  })
  .refine((b) => b.audioUrl || (b.sdrAudioUrl && b.leadAudioUrl), {
    message: "Informe audioUrl (gravação única) ou sdrAudioUrl + leadAudioUrl (2 trilhas).",
  });

const completeCallSchema = z.object({
  endedAt: z.string().datetime(),
  durationSeconds: z.number().int().positive(),
});

export async function callsRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  fastify.addHook("preHandler", requireAuth);

  fastify.post("/calls", async (request, reply) => {
    const { id: userId } = request.user;
    const body = createCallSchema.parse(request.body);

    const [call] = await db.insert(calls).values({
      userId,
      contactId: body.contactId,
      type: body.type,
      direction: body.direction,
      startedAt: new Date(body.startedAt),
      transcriptionStatus: "pending",
      analysisStatus: "pending",
    }).returning();

    return reply.code(201).send({ call });
  });

  // POST /calls/ingest — entrada normalizada agnóstica ao canal. Cria a call já
  // com o áudio (URL única do VoIP/upload ou 2 trilhas do navegador) e dispara o
  // processamento. É aqui que qualquer fonte de gravação pluga (pré-integração
  // universal de VoIP); o adaptador por provedor só traduz o payload pra este shape.
  fastify.post("/calls/ingest", async (request, reply) => {
    const { id: userId } = request.user;
    const body = ingestCallSchema.parse(request.body);

    const { callId } = await ingestCall({
      userId,
      contactId:       body.contactId,
      channel:         body.channel,
      direction:       body.direction,
      startedAt:       body.startedAt ? new Date(body.startedAt) : undefined,
      endedAt:         body.endedAt ? new Date(body.endedAt) : null,
      durationSeconds: body.durationSeconds ?? null,
      audioUrl:        body.audioUrl ?? null,
      sdrAudioUrl:     body.sdrAudioUrl ?? null,
      leadAudioUrl:    body.leadAudioUrl ?? null,
      sourceMeta:      body.sourceMeta ?? null,
    });

    return reply.code(201).send({ callId, status: "processing" });
  });

  // POST /calls/upload — sobe um arquivo de áudio (uma trilha) e devolve a URL.
  // Usado pela extensão pra persistir as gravações completas (SDR/lead) ao fim da
  // call ao vivo; depois chama /calls/ingest com as URLs pra análise pós-call.
  fastify.post("/calls/upload", async (request, reply) => {
    const { id: userId } = request.user;
    const data = await request.file();
    if (!data) return reply.code(400).send({ message: "Arquivo de áudio não enviado" });

    const buffer = await data.toBuffer();
    const key = `calls/${userId}/recordings/${randomUUID()}.${getExtFromMime(data.mimetype)}`;
    const url = await uploadAudio(key, buffer, data.mimetype);

    return reply.send({ url, sizeBytes: buffer.length });
  });

  fastify.get("/calls", async (request, reply) => {
    const { id: userId, teamId, role } = request.user;
    const query = request.query as any;
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const pageSize = Math.min(100, parseInt(query.pageSize ?? "20", 10));
    const offset = (page - 1) * pageSize;

    const filters = [eq(calls.userId, userId)];
    if (query.contactId) filters.push(eq(calls.contactId, query.contactId));
    if (query.result) filters.push(eq(calls.result, query.result));
    if (query.dateFrom) filters.push(gte(calls.startedAt, new Date(query.dateFrom)));
    if (query.dateTo) filters.push(lte(calls.startedAt, new Date(query.dateTo)));

    const where = and(...filters);
    const [{ total }] = await db.select({ total: count() }).from(calls).where(where);
    const data = await db.select().from(calls).where(where)
      .orderBy(desc(calls.startedAt))
      .limit(pageSize)
      .offset(offset);

    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  });

  fastify.get("/calls/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { id: userId } = request.user;

    const [call] = await db.select().from(calls)
      .where(and(eq(calls.id, id), eq(calls.userId, userId)))
      .limit(1);
    if (!call) return reply.code(404).send({ message: "Chamada não encontrada" });

    const [analysis] = await db.select().from(callAnalyses).where(eq(callAnalyses.callId, id)).limit(1);

    return reply.send({ call, analysis: analysis ?? null });
  });

  fastify.post("/calls/:id/audio", async (request, reply) => {
    const { id: callId } = request.params as { id: string };
    const { id: userId } = request.user;

    const [call] = await db.select().from(calls)
      .where(and(eq(calls.id, callId), eq(calls.userId, userId)))
      .limit(1);
    if (!call) return reply.code(404).send({ message: "Chamada não encontrada" });

    const data = await request.file();
    if (!data) return reply.code(400).send({ message: "Arquivo de áudio não enviado" });

    const buffer = await data.toBuffer();
    const key = `calls/${userId}/${callId}/${randomUUID()}.${getExtFromMime(data.mimetype)}`;
    const audioUrl = await uploadAudio(key, buffer, data.mimetype);

    await db.update(calls).set({
      audioUrl,
      audioSizeBytes: buffer.length,
      transcriptionStatus: "pending",
    }).where(eq(calls.id, callId));

    await addJob(QUEUES.CALL_PROCESS, "process-call", { callId, userId });

    return reply.send({ success: true, audioUrl, message: "Áudio enviado e sendo processado" });
  });

  fastify.post("/calls/:id/complete", async (request, reply) => {
    const { id: callId } = request.params as { id: string };
    const { id: userId } = request.user;
    const body = completeCallSchema.parse(request.body);

    const [updated] = await db.update(calls).set({
      endedAt: new Date(body.endedAt),
      durationSeconds: body.durationSeconds,
    }).where(and(eq(calls.id, callId), eq(calls.userId, userId))).returning();

    if (!updated) return reply.code(404).send({ message: "Chamada não encontrada" });
    return reply.send({ call: updated });
  });

  fastify.get("/calls/:id/analysis", async (request, reply) => {
    const { id: callId } = request.params as { id: string };
    const { id: userId } = request.user;

    const [call] = await db.select({ id: calls.id }).from(calls)
      .where(and(eq(calls.id, callId), eq(calls.userId, userId))).limit(1);
    if (!call) return reply.code(404).send({ message: "Chamada não encontrada" });

    const [analysis] = await db.select().from(callAnalyses).where(eq(callAnalyses.callId, callId)).limit(1);
    if (!analysis) return reply.code(404).send({ message: "Análise ainda não disponível", status: "pending" });

    return reply.send({ analysis });
  });

  fastify.get("/calls/:id/transcript", async (request, reply) => {
    const { id: callId } = request.params as { id: string };
    const { id: userId } = request.user;

    const [call] = await db.select({ transcriptionText: calls.transcriptionText, transcriptionSegments: calls.transcriptionSegments, transcriptionStatus: calls.transcriptionStatus })
      .from(calls)
      .where(and(eq(calls.id, callId), eq(calls.userId, userId)))
      .limit(1);

    if (!call) return reply.code(404).send({ message: "Chamada não encontrada" });
    if (call.transcriptionStatus !== "done") return reply.send({ status: call.transcriptionStatus, transcript: null });

    return reply.send({
      status: "done",
      transcript: call.transcriptionText,
      segments: call.transcriptionSegments,
    });
  });
}

function getExtFromMime(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("mp3")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "webm";
}
