import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "@limo/db";
import { extensionEvents } from "@limo/db";

// Telemetria mínima e anônima do funil da extensão. Endpoint PÚBLICO (roda antes
// de existir conta) e best-effort: nunca falha ruidosamente nem bloqueia nada do
// lado da extensão. Sempre 204 — a extensão dispara fire-and-forget.
const eventSchema = z.object({
  type:    z.enum(["install", "app_open", "login_view", "login_attempt"]),
  anonId:  z.string().min(8).max(64),
  ok:      z.boolean().optional(),   // só p/ login_attempt
  version: z.string().max(20).optional(),
});

export async function eventsRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  fastify.post("/events", async (request, reply) => {
    const parsed = eventSchema.safeParse(request.body);
    // Payload inválido/ruído → ignora em silêncio (telemetria não é crítica).
    if (!parsed.success) return reply.code(204).send();

    const e = parsed.data;
    try {
      await db.insert(extensionEvents).values({
        type:       e.type,
        anonId:     e.anonId,
        ok:         e.ok ?? null,
        extVersion: e.version ?? null,
      });
    } catch (err) {
      request.log.error({ err }, "failed to record extension event");
    }
    return reply.code(204).send();
  });
}
