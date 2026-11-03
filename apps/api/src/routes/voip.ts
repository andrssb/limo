import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "@limo/db";
import { teams, users, contacts } from "@limo/db";
import { eq, and, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { requireAuth } from "../middleware/auth.js";
import { ingestCall } from "../services/call-ingestion.js";

const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

// ─── Pré-integração universal de VoIP (Fase 2 — esqueleto) ──────────────────
// Webhook server-to-server: o provedor de VoIP do cliente manda a gravação da
// chamada pra cá, autenticado por uma API KEY do time (não pelo login do user —
// um webhook não tem como mandar JWT). Cai na ingestão universal (/calls/ingest)
// que já existe. Provider-agnóstico: aceita um payload NORMALIZADO. Quando fechar
// um cliente, escreve-se um adaptador fininho (payload do VoIP dele → este shape),
// opcionalmente roteado por /voip/ingest/:provider. NÃO toca na extensão/CWS.
export async function voipRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  // Payload normalizado que qualquer VoIP/adaptador entrega.
  const ingestSchema = z.object({
    recordingUrl:     z.string().url().optional(),      // gravação única (mista) — típico de VoIP
    sdrRecordingUrl:  z.string().url().optional(),       // trilhas separadas (se o provedor der)
    leadRecordingUrl: z.string().url().optional(),
    direction:        z.enum(["inbound", "outbound"]).default("outbound"),
    durationSeconds:  z.number().int().positive().optional(),
    startedAt:        z.string().datetime().optional(),
    agentEmail:       z.string().email().optional(),     // mapeia o SDR/usuário dono da call
    contactPhone:     z.string().optional(),             // tenta casar/atrelar um contato
    externalId:       z.string().optional(),             // id da chamada no provedor
    provider:         z.string().optional(),             // p/ rastreio (twilio, aircall, ...)
    meta:             z.record(z.unknown()).optional(),  // payload bruto do provedor
  }).refine((b) => b.recordingUrl || (b.sdrRecordingUrl && b.leadRecordingUrl), {
    message: "Informe recordingUrl (gravação única) ou sdrRecordingUrl + leadRecordingUrl.",
  });

  // POST /voip/ingest — webhook autenticado por API key (header x-limo-voip-key).
  // Sem requireAuth (é server-to-server).
  fastify.post("/voip/ingest", async (request, reply) => {
    const key = (request.headers["x-limo-voip-key"] ?? "") as string;
    if (!key) return reply.code(401).send({ message: "API key ausente (header x-limo-voip-key)." });

    const [team] = await db.select().from(teams).where(eq(teams.voipApiKey, key)).limit(1);
    if (!team) return reply.code(401).send({ message: "API key inválida." });

    const body = ingestSchema.parse(request.body);

    // Resolve o usuário dono da call: pelo e-mail do agente, senão o manager do time.
    let userId = team.managerId;
    if (body.agentEmail) {
      const [agent] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.teamId, team.id), sql`lower(${users.email}) = ${body.agentEmail.toLowerCase()}`))
        .limit(1);
      if (agent) userId = agent.id;
    }

    // Best-effort: casa um contato existente pelo telefone (últimos 8 dígitos).
    let contactId: string | null = null;
    const digits = onlyDigits(body.contactPhone);
    if (digits.length >= 8) {
      const [c]: any[] = await db.execute(sql`
        SELECT id FROM contacts
        WHERE team_id = ${team.id}
          AND regexp_replace(coalesce(phone,''), '\\D', '', 'g') LIKE ${"%" + digits.slice(-8)}
        LIMIT 1`);
      contactId = c?.id ?? null;
    }

    const { callId } = await ingestCall({
      userId,
      contactId,
      channel:         "voip",
      direction:       body.direction,
      durationSeconds: body.durationSeconds ?? null,
      startedAt:       body.startedAt ? new Date(body.startedAt) : undefined,
      audioUrl:        body.recordingUrl ?? null,
      sdrAudioUrl:     body.sdrRecordingUrl ?? null,
      leadAudioUrl:    body.leadRecordingUrl ?? null,
      sourceMeta:      { provider: body.provider ?? "voip", externalId: body.externalId, raw: body.meta },
    });

    return reply.code(202).send({ callId, status: "processing" });
  });

  // ── Gestão da API key (gestor/admin) ───────────────────────────────────────
  fastify.get("/voip/api-key", { preHandler: [requireAuth] }, async (request, reply) => {
    const { teamId, role } = request.user as any;
    if (role !== "manager" && role !== "admin") return reply.code(403).send({ message: "Acesso restrito a gestores" });
    const [team] = await db.select({ key: teams.voipApiKey }).from(teams).where(eq(teams.id, teamId)).limit(1);
    return reply.send({ apiKey: team?.key ?? null });
  });

  // Gera/rotaciona a chave do time.
  fastify.post("/voip/api-key", { preHandler: [requireAuth] }, async (request, reply) => {
    const { teamId, role } = request.user as any;
    if (role !== "manager" && role !== "admin") return reply.code(403).send({ message: "Acesso restrito a gestores" });
    const apiKey = "limo_voip_" + randomBytes(24).toString("hex");
    await db.update(teams).set({ voipApiKey: apiKey }).where(eq(teams.id, teamId));
    return reply.send({ apiKey });
  });
}
