import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "@limo/db";
import { goals, achievements, users, calls, contacts } from "@limo/db";
import { eq, and, gte, lte, desc, count, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";

export async function goalsRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();
  fastify.addHook("preHandler", requireAuth);

  // GET /goals  — user sees own; manager sees team's
  fastify.get("/goals", async (request) => {
    const { id: userId, role, teamId } = request.user as any;

    if (role === "manager" || role === "admin") {
      // Manager: all goals they set + stats
      const rows = await db
        .select({ goal: goals, userName: users.name })
        .from(goals)
        .innerJoin(users, eq(users.id, goals.userId))
        .where(eq(goals.managerId, userId))
        .orderBy(desc(goals.createdAt));
      return { goals: rows.map((r) => ({ ...r.goal, userName: r.userName })) };
    }

    const rows = await db.select().from(goals)
      .where(eq(goals.userId, userId))
      .orderBy(desc(goals.createdAt));
    return { goals: rows };
  });

  // POST /goals  — manager only
  fastify.post("/goals", async (request, reply) => {
    const { id: managerId, role, teamId } = request.user as any;
    if (role !== "manager" && role !== "admin") {
      return reply.code(403).send({ message: "Apenas managers podem criar metas" });
    }

    const body = z.object({
      userId:    z.string().uuid(),
      metric:    z.enum(["calls", "contacts_added", "meetings", "deals"]),
      target:    z.number().int().positive(),
      period:    z.enum(["daily", "weekly", "monthly"]),
      startDate: z.string().datetime(),
      endDate:   z.string().datetime(),
    }).parse(request.body);

    const [goal] = await db.insert(goals).values({
      userId: body.userId,
      managerId,
      metric: body.metric,
      target: body.target,
      period: body.period,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
    }).returning();

    return reply.code(201).send({ goal });
  });

  // DELETE /goals/:id
  fastify.delete("/goals/:id", async (request, reply) => {
    const { id: managerId, role } = request.user as any;
    if (role !== "manager" && role !== "admin") {
      return reply.code(403).send({ message: "Apenas managers podem remover metas" });
    }
    const { id } = request.params as any;
    await db.delete(goals).where(and(eq(goals.id, id), eq(goals.managerId, managerId)));
    return reply.code(204).send();
  });

  // GET /goals/leaderboard  — team leaderboard with current-period progress
  fastify.get("/goals/leaderboard", async (request) => {
    const { teamId } = request.user as any;

    // Count calls per user this month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const callCounts = await db
      .select({ userId: calls.userId, count: count() })
      .from(calls)
      .innerJoin(users, eq(users.id, calls.userId))
      .where(and(eq(users.teamId, teamId), gte(calls.startedAt, monthStart)))
      .groupBy(calls.userId);

    const contactCounts = await db
      .select({ userId: contacts.userId, count: count() })
      .from(contacts)
      .innerJoin(users, eq(users.id, contacts.userId))
      .where(and(eq(users.teamId, teamId), gte(contacts.createdAt, monthStart)))
      .groupBy(contacts.userId);

    const teamUsers = await db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users).where(eq(users.teamId, teamId));

    const callMap = Object.fromEntries(callCounts.map((r) => [r.userId, Number(r.count)]));
    const contactMap = Object.fromEntries(contactCounts.map((r) => [r.userId, Number(r.count)]));

    const teamGoals = await db.select().from(goals)
      .where(and(
        gte(goals.startDate, monthStart),
        lte(goals.endDate, new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      ));

    const leaderboard = teamUsers
      .filter((u) => u.role !== "manager" && u.role !== "admin")
      .map((u) => {
        const userGoals = teamGoals.filter((g) => g.userId === u.id);
        const callGoal  = userGoals.find((g) => g.metric === "calls");
        const ctGoal    = userGoals.find((g) => g.metric === "contacts_added");
        const calls_    = callMap[u.id] ?? 0;
        const contacts_ = contactMap[u.id] ?? 0;
        const points    = calls_ * 2 + contacts_ * 1;
        return {
          userId: u.id,
          name: u.name,
          calls: calls_,
          contactsAdded: contacts_,
          callsTarget: callGoal?.target ?? null,
          contactsTarget: ctGoal?.target ?? null,
          points,
        };
      })
      .sort((a, b) => b.points - a.points);

    return { leaderboard, month: monthStart.toISOString() };
  });

  // GET /goals/achievements
  fastify.get("/goals/achievements", async (request) => {
    const { id: userId } = request.user as any;
    const rows = await db.select().from(achievements)
      .where(eq(achievements.userId, userId))
      .orderBy(desc(achievements.unlockedAt));
    return { achievements: rows };
  });

  // POST /goals/achievements/check  — called internally to award badges
  fastify.post("/goals/achievements/check", async (request, reply) => {
    const { id: userId } = request.user as any;
    const now = new Date();

    const [callCount] = await db.select({ count: count() }).from(calls).where(eq(calls.userId, userId));
    const [contactCount] = await db.select({ count: count() }).from(contacts).where(eq(contacts.userId, userId));

    const earned: { badge: string; label: string }[] = [];

    const BADGES = [
      { badge: "first_call",      label: "Primeira ligação",        condition: () => Number(callCount.count) >= 1 },
      { badge: "calls_10",        label: "10 ligações",             condition: () => Number(callCount.count) >= 10 },
      { badge: "calls_50",        label: "50 ligações",             condition: () => Number(callCount.count) >= 50 },
      { badge: "calls_100",       label: "100 ligações 🎯",         condition: () => Number(callCount.count) >= 100 },
      { badge: "first_contact",   label: "Primeiro contato",        condition: () => Number(contactCount.count) >= 1 },
      { badge: "contacts_25",     label: "25 contatos adicionados", condition: () => Number(contactCount.count) >= 25 },
      { badge: "contacts_100",    label: "100 contatos 🚀",         condition: () => Number(contactCount.count) >= 100 },
    ];

    const existing = await db.select({ badge: achievements.badge }).from(achievements)
      .where(eq(achievements.userId, userId));
    const existing_set = new Set(existing.map((r) => r.badge));

    for (const b of BADGES) {
      if (!existing_set.has(b.badge) && b.condition()) {
        earned.push({ badge: b.badge, label: b.label });
      }
    }

    if (earned.length > 0) {
      await db.insert(achievements).values(
        earned.map((e) => ({ userId, badge: e.badge, label: e.label }))
      ).onConflictDoNothing();
    }

    return { awarded: earned };
  });
}
