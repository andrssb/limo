import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "@limo/db";
import { teams, users, weeklyReports, teamInvites } from "@limo/db";
import { eq, and, gt, desc } from "drizzle-orm";
import { requireAuth, requireManager } from "../middleware/auth.js";
import { addJob, QUEUES } from "../lib/queue.js";
import { summarizeQuota } from "../lib/quotas.js";
import { randomBytes } from "crypto";

function generateCode(): string {
  return randomBytes(5).toString("hex").toUpperCase(); // 10 chars, e.g. "A3F9C12E04"
}

export async function teamsRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  fastify.get("/teams/mine", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id: userId, teamId, role } = request.user;
    if (!teamId) return reply.code(404).send({ message: "Usuário não pertence a um time" });

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team) return reply.code(404).send({ message: "Time não encontrado" });

    const members = await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.teamId, teamId));

    const personaQuota = summarizeQuota(team);
    return reply.send({ team, members, personaQuota });
  });

  // ── Invites ─────────────────────────────────────────────────────────────────

  fastify.post("/teams/invites", { preHandler: [requireManager] }, async (request, reply) => {
    const { id: userId, teamId } = request.user;
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });

    const body = z.object({
      maxUses: z.number().int().positive().optional(),
      expiresInDays: z.number().int().positive().default(7),
    }).parse(request.body ?? {});

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + body.expiresInDays);

    const [invite] = await db.insert(teamInvites).values({
      teamId,
      code: generateCode(),
      createdBy: userId,
      maxUses: body.maxUses ?? null,
      expiresAt,
    }).returning();

    return reply.code(201).send({ invite });
  });

  fastify.get("/teams/invites", { preHandler: [requireManager] }, async (request, reply) => {
    const { teamId } = request.user;
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });

    const invites = await db.select().from(teamInvites)
      .where(and(eq(teamInvites.teamId, teamId), gt(teamInvites.expiresAt, new Date())))
      .orderBy(desc(teamInvites.createdAt));

    return reply.send({ invites });
  });

  fastify.delete("/teams/invites/:code", { preHandler: [requireManager] }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const { teamId } = request.user;
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });

    const deleted = await db.delete(teamInvites)
      .where(and(eq(teamInvites.code, code), eq(teamInvites.teamId, teamId)))
      .returning();

    if (deleted.length === 0) return reply.code(404).send({ message: "Convite não encontrado" });
    return reply.send({ success: true });
  });

  // ── Join via invite code ─────────────────────────────────────────────────────

  fastify.post("/teams/join", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id: userId, teamId: currentTeamId } = request.user;

    if (currentTeamId) {
      return reply.code(400).send({ message: "Usuário já pertence a um time" });
    }

    const { inviteCode } = z.object({ inviteCode: z.string().min(1) }).parse(request.body);

    const [invite] = await db.select().from(teamInvites)
      .where(and(eq(teamInvites.code, inviteCode.toUpperCase()), gt(teamInvites.expiresAt, new Date())))
      .limit(1);

    if (!invite) return reply.code(404).send({ message: "Convite inválido ou expirado" });
    if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
      return reply.code(410).send({ message: "Este convite atingiu o limite de usos" });
    }

    await db.update(users).set({ teamId: invite.teamId }).where(eq(users.id, userId));
    await db.update(teamInvites).set({ uses: invite.uses + 1 }).where(eq(teamInvites.id, invite.id));

    return reply.send({ success: true, teamId: invite.teamId });
  });

  // ── Reports ──────────────────────────────────────────────────────────────────

  fastify.get("/teams/:id/report/latest", { preHandler: [requireManager] }, async (request, reply) => {
    const { id: teamId } = request.params as { id: string };

    const [report] = await db.select().from(weeklyReports)
      .where(eq(weeklyReports.teamId, teamId))
      .orderBy(desc(weeklyReports.createdAt))
      .limit(1);

    if (!report) return reply.code(404).send({ message: "Nenhum relatório disponível ainda" });
    return reply.send({ report });
  });

  fastify.get("/teams/:id/report/weekly", { preHandler: [requireManager] }, async (request, reply) => {
    const { id: teamId } = request.params as { id: string };
    const { weekStart } = request.query as { weekStart?: string };

    const reports = await db.select().from(weeklyReports)
      .where(eq(weeklyReports.teamId, teamId))
      .orderBy(desc(weeklyReports.weekStart))
      .limit(weekStart ? 1 : 10);

    return reply.send({ reports });
  });

  fastify.post("/teams/:id/report/trigger", { preHandler: [requireManager] }, async (request, reply) => {
    const { id: teamId } = request.params as { id: string };
    await addJob(QUEUES.WEEKLY_REPORT, "generate-report", { teamId });
    return reply.send({ success: true, message: "Relatório sendo gerado" });
  });
}
