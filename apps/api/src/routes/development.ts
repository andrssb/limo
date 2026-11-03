import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "@limo/db";
import { users, calls, callAnalyses, memberSkills } from "@limo/db";
import { eq, and, gte, lt, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { generateMemberDevelopment } from "../services/ai.js";
import { getTeamKnowledgeContext } from "../services/coaching.js";

// Fase 5 — desenvolvimento individual. Gestor define skills; IA acompanha a
// evolução pelos scores de ligação (Fase 3). Restrito a manager/admin.
export async function developmentRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();
  fastify.addHook("preHandler", requireAuth);

  function ensureManager(role: string, reply: any): boolean {
    if (role !== "manager" && role !== "admin") {
      reply.code(403).send({ message: "Acesso restrito a gestores e Heads de Vendas" });
      return false;
    }
    return true;
  }

  async function memberInTeam(memberId: string, teamId: string) {
    const [m] = await db.select().from(users)
      .where(and(eq(users.id, memberId), eq(users.teamId, teamId))).limit(1);
    return m;
  }

  const CRITERIA = ["opening", "painDiscovery", "solutionClarity", "frameworkUsage", "advanceToDemo"] as const;

  // GET — painel de desenvolvimento do membro (skills + evolução + IA)
  fastify.get("/members/:id/development", async (request, reply) => {
    const { role, teamId } = request.user as any;
    if (!ensureManager(role, reply)) return;
    const { id: memberId } = request.params as { id: string };
    const days = Math.min(365, Math.max(7, parseInt((request.query as any)?.days ?? "30", 10)));

    const member = await memberInTeam(memberId, teamId);
    if (!member) return reply.code(404).send({ message: "Membro não encontrado no time" });

    const [skillRow] = await db.select().from(memberSkills).where(eq(memberSkills.userId, memberId)).limit(1);
    const skills = {
      hardSkills: (skillRow?.hardSkills as string[]) ?? [],
      softSkills: (skillRow?.softSkills as string[]) ?? [],
      note: skillRow?.note ?? null,
      updatedAt: skillRow?.updatedAt ? skillRow.updatedAt.toISOString() : null,
    };

    const now = Date.now();
    const cutoff = new Date(now - days * 86400000);
    const prevCutoff = new Date(now - 2 * days * 86400000);

    // Ligações analisadas do membro (com score da Fase 3) no período atual + anterior.
    const rows = await db.select({
      startedAt: calls.startedAt,
      result: calls.result,
      score: callAnalyses.score,
      flash: callAnalyses.flashSummary,
    })
      .from(callAnalyses)
      .innerJoin(calls, eq(calls.id, callAnalyses.callId))
      .where(and(eq(calls.userId, memberId), gte(calls.startedAt, prevCutoff)))
      .orderBy(desc(calls.startedAt));

    const current = rows.filter((r) => r.startedAt >= cutoff && r.score);
    const previous = rows.filter((r) => r.startedAt < cutoff && r.startedAt >= prevCutoff && r.score);

    function avgOverall(list: typeof rows): number | null {
      const vals = list.map((r) => (r.score as any)?.overall ?? 0);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }

    let avgScore: Record<string, number> | null = null;
    if (current.length) {
      avgScore = { overall: avgOverall(current)! };
      for (const c of CRITERIA) {
        avgScore[c] = current.reduce((a, r) => a + ((r.score as any)?.[c] ?? 0), 0) / current.length;
      }
    }

    const prevAvg = avgOverall(previous);
    const trend = avgScore && prevAvg != null ? avgScore.overall - prevAvg : null;

    const history = current.slice(0, 10).map((r) => ({
      date: r.startedAt.toISOString(),
      overall: Math.round((r.score as any)?.overall ?? 0),
      result: r.result ?? null,
    }));

    let ai = null;
    if (current.length) {
      const teamKnowledge = teamId ? await getTeamKnowledgeContext(teamId).catch(() => "") : "";
      ai = await generateMemberDevelopment({
        memberName: member.name,
        periodDays: days,
        callCount: current.length,
        avgScore: avgScore!,
        trend,
        hardSkills: skills.hardSkills,
        softSkills: skills.softSkills,
        recentSummaries: current.map((r) => r.flash).filter(Boolean).slice(0, 12) as string[],
        teamKnowledge,
      }).catch(() => null);
    }

    return reply.send({ member: { id: member.id, name: member.name }, skills, callCount: current.length, avgScore, trend, history, ai });
  });

  // PUT — gestor define as hard/soft skills de foco do membro
  fastify.put("/members/:id/skills", async (request, reply) => {
    const { id: managerId, role, teamId } = request.user as any;
    if (!ensureManager(role, reply)) return;
    const { id: memberId } = request.params as { id: string };

    const body = z.object({
      hardSkills: z.array(z.string().max(120)).max(20).default([]),
      softSkills: z.array(z.string().max(120)).max(20).default([]),
      note: z.string().max(2000).optional(),
    }).parse(request.body ?? {});

    const member = await memberInTeam(memberId, teamId);
    if (!member) return reply.code(404).send({ message: "Membro não encontrado no time" });

    const [saved] = await db.insert(memberSkills).values({
      teamId, userId: memberId,
      hardSkills: body.hardSkills as any,
      softSkills: body.softSkills as any,
      note: body.note ?? null,
      updatedBy: managerId,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: memberSkills.userId,
      set: {
        hardSkills: body.hardSkills as any,
        softSkills: body.softSkills as any,
        note: body.note ?? null,
        updatedBy: managerId,
        updatedAt: new Date(),
      },
    }).returning();

    return reply.send({ skills: saved });
  });
}
