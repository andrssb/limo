import type { FastifyInstance } from "fastify";
import { getDb } from "@limo/db";
import { contacts, calls, callAnalyses, messages, leadQualifications } from "@limo/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { qualifyLead, generateQualificationInsights, generateOutboundInsights } from "../services/ai.js";
import { getTeamKnowledgeContext } from "../services/coaching.js";

// Fase 4 — Qualificador de Garantia do Lead. Restrito a Heads/gestores/admin.
export async function qualificationRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();
  fastify.addHook("preHandler", requireAuth);

  function ensureManager(role: string, reply: any): boolean {
    if (role !== "manager" && role !== "admin") {
      reply.code(403).send({ message: "Acesso restrito a gestores e Heads de Vendas" });
      return false;
    }
    return true;
  }

  // GET — insights estratégicos agregados do funil de qualificação (Fase 4b).
  // Considera a ÚLTIMA qualificação por contato no período. Manager/admin.
  fastify.get("/qualification/insights", async (request, reply) => {
    const { role, teamId } = request.user as any;
    if (!ensureManager(role, reply)) return;
    const days = Math.min(365, Math.max(1, parseInt((request.query as any)?.days ?? "30", 10)));

    const rows = await db.select().from(leadQualifications)
      .where(eq(leadQualifications.teamId, teamId))
      .orderBy(desc(leadQualifications.createdAt));

    // Dedup: mantém a qualificação mais recente por contato.
    const latest = new Map<string, typeof rows[number]>();
    for (const r of rows) if (!latest.has(r.contactId)) latest.set(r.contactId, r);

    const cutoff = new Date(Date.now() - days * 86400000);
    const inPeriod = [...latest.values()].filter((r) => r.createdAt >= cutoff);

    const byOrigin: Record<string, number> = { inbound: 0, outbound: 0, referral: 0, partner: 0, other: 0 };
    let qualified = 0, partial = 0, disqualified = 0, scoreSum = 0;
    const reasons: string[] = [];
    const marketingNotes: string[] = [];
    for (const r of inPeriod) {
      byOrigin[r.origin] = (byOrigin[r.origin] ?? 0) + 1;
      if (r.classification === "qualified") qualified++;
      else if (r.classification === "partial") partial++;
      else disqualified++;
      scoreSum += (r.score as any)?.overall ?? 0;
      if (r.classification !== "qualified") reasons.push(...((r.reasons as string[]) ?? []));
      if (r.marketingNote) marketingNotes.push(r.marketingNote);
    }

    const total = inPeriod.length;
    const avgScore = total ? scoreSum / total : 0;
    const funnel = { total, qualified, partial, disqualified, byOrigin, avgScore };

    if (total === 0) {
      return reply.send({ period: { days }, funnel, insights: null, message: "Sem leads qualificados no período." });
    }

    const teamKnowledge = teamId ? await getTeamKnowledgeContext(teamId).catch(() => "") : "";
    const insights = await generateQualificationInsights({
      periodDays: days,
      total, qualified, partial, disqualified, byOrigin, avgScore,
      sampleReasons: reasons.slice(0, 30),
      marketingNotes: marketingNotes.slice(0, 20),
      teamKnowledge,
    }).catch(() => null);

    return reply.send({ period: { days }, funnel, insights });
  });

  // GET — inteligência de prospecção OUTBOUND (Fase 4c). Manager/admin.
  fastify.get("/qualification/outbound", async (request, reply) => {
    const { role, teamId } = request.user as any;
    if (!ensureManager(role, reply)) return;
    const days = Math.min(365, Math.max(1, parseInt((request.query as any)?.days ?? "30", 10)));

    const rows = await db.select().from(leadQualifications)
      .where(eq(leadQualifications.teamId, teamId))
      .orderBy(desc(leadQualifications.createdAt));

    const latest = new Map<string, typeof rows[number]>();
    for (const r of rows) if (!latest.has(r.contactId)) latest.set(r.contactId, r);

    const cutoff = new Date(Date.now() - days * 86400000);
    const outbound = [...latest.values()].filter((r) => r.origin === "outbound" && r.createdAt >= cutoff);

    const stats = {
      total: outbound.length,
      opportunities: outbound.filter((r) => r.classification === "qualified").length,
      disqualified: outbound.filter((r) => r.classification === "disqualified").length,
      avgIcpFit: 0,
      avgDaysInPipeline: 0,
      channels: { calls: 0, whatsapp: 0, linkedin: 0 },
    };

    if (outbound.length === 0) {
      return reply.send({ period: { days }, stats, insights: null, message: "Sem prospecção outbound no período." });
    }

    stats.avgIcpFit = outbound.reduce((a, r) => a + ((r.score as any)?.icpFit ?? 0), 0) / outbound.length;

    const ids = outbound.map((r) => r.contactId);
    const [contactRows, callRows, msgRows] = await Promise.all([
      db.select({ id: contacts.id, createdAt: contacts.createdAt, linkedinUrl: contacts.linkedinUrl })
        .from(contacts).where(inArray(contacts.id, ids)),
      db.selectDistinct({ contactId: calls.contactId }).from(calls).where(inArray(calls.contactId, ids)),
      db.selectDistinct({ contactId: messages.contactId }).from(messages).where(inArray(messages.contactId, ids)),
    ]);

    const now = Date.now();
    stats.avgDaysInPipeline = contactRows.length
      ? contactRows.reduce((a, c) => a + (now - new Date(c.createdAt).getTime()) / 86400000, 0) / contactRows.length
      : 0;
    stats.channels.calls = callRows.length;
    stats.channels.whatsapp = msgRows.length;
    stats.channels.linkedin = contactRows.filter((c) => c.linkedinUrl).length;

    const successSamples = outbound.filter((r) => r.classification === "qualified").map((r) => r.summary).slice(0, 15);
    const lossSamples = outbound.filter((r) => r.classification !== "qualified").flatMap((r) => (r.reasons as string[]) ?? []).slice(0, 25);

    const teamKnowledge = teamId ? await getTeamKnowledgeContext(teamId).catch(() => "") : "";
    const insights = await generateOutboundInsights({
      periodDays: days,
      total: stats.total, opportunities: stats.opportunities, disqualified: stats.disqualified,
      avgIcpFit: stats.avgIcpFit, avgDaysInPipeline: stats.avgDaysInPipeline, channels: stats.channels,
      successSamples, lossSamples, teamKnowledge,
    }).catch(() => null);

    return reply.send({ period: { days }, stats, insights });
  });

  // GET — última qualificação do lead
  fastify.get("/contacts/:id/qualification", async (request, reply) => {
    const { role, teamId } = request.user as any;
    if (!ensureManager(role, reply)) return;
    const { id: contactId } = request.params as { id: string };

    const [qual] = await db.select().from(leadQualifications)
      .where(and(eq(leadQualifications.contactId, contactId), eq(leadQualifications.teamId, teamId)))
      .orderBy(desc(leadQualifications.createdAt))
      .limit(1);

    return reply.send({ qualification: qual ?? null });
  });

  // POST — (re)qualifica o lead com base na Educação de Produto + interações
  fastify.post("/contacts/:id/qualify", async (request, reply) => {
    const { id: userId, role, teamId } = request.user as any;
    if (!ensureManager(role, reply)) return;
    const { id: contactId } = request.params as { id: string };

    const [contact] = await db.select().from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.teamId, teamId))).limit(1);
    if (!contact) return reply.code(404).send({ message: "Contato não encontrado" });

    // Histórico de interações: ligações (com resultado/resumo) + mensagens.
    const recentCalls = await db.select({
      startedAt: calls.startedAt, result: calls.result, flash: callAnalyses.flashSummary,
    })
      .from(calls)
      .leftJoin(callAnalyses, eq(callAnalyses.callId, calls.id))
      .where(eq(calls.contactId, contactId))
      .orderBy(desc(calls.startedAt))
      .limit(8);

    const recentMessages = await db.select({ content: messages.content, direction: messages.direction, sentAt: messages.sentAt })
      .from(messages)
      .where(eq(messages.contactId, contactId))
      .orderBy(desc(messages.sentAt))
      .limit(12);

    const historyLines: string[] = [];
    for (const c of recentCalls) {
      historyLines.push(`- Ligação ${c.startedAt.toLocaleDateString("pt-BR")}: ${c.result ?? "sem análise"}${c.flash ? ` — ${c.flash}` : ""}`);
    }
    for (const m of recentMessages) {
      const who = m.direction === "outbound" ? "BDR" : contact.firstName;
      historyLines.push(`- Msg ${m.sentAt.toLocaleDateString("pt-BR")} ${who}: "${(m.content ?? "").slice(0, 100)}"`);
    }

    const teamKnowledge = teamId ? await getTeamKnowledgeContext(teamId).catch(() => "") : "";
    const enrichment = contact.enrichmentData ? JSON.stringify(contact.enrichmentData).slice(0, 1200) : null;

    const result = await qualifyLead({
      contactName: `${contact.firstName} ${contact.lastName}`,
      companyName: contact.companyName,
      jobTitle: contact.jobTitle,
      location: contact.location,
      technicalSource: contact.source,
      enrichment,
      interactionHistory: historyLines.join("\n"),
      teamKnowledge,
    });

    const [saved] = await db.insert(leadQualifications).values({
      contactId, userId, teamId,
      origin: result.origin,
      classification: result.classification,
      score: result.score as any,
      reasons: result.reasons as any,
      summary: result.summary,
      marketingNote: result.marketingNote,
      status: "done",
    }).returning();

    return reply.code(201).send({ qualification: saved });
  });
}
