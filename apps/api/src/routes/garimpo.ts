import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "@limo/db";
import { garimpoRuns, personas, lists } from "@limo/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { addJob, QUEUES, type GarimpoJob } from "../lib/queue.js";
import { getTeamPlan, getPlanLimits, getListContactCount } from "../lib/plans.js";

export async function garimpoRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();
  fastify.addHook("preHandler", requireAuth);

  // GET /garimpo/config
  fastify.get("/garimpo/config", async () => {
    return {
      sources: ["receita_federal", "base_propria", "extensao_linkedin"],
    };
  });

  // GET /garimpo/runs
  fastify.get("/garimpo/runs", async (request) => {
    const { id: userId, teamId } = request.user as any;
    const rows = await db
      .select({
        run: garimpoRuns,
        personaName: personas.name,
        listName: lists.name,
      })
      .from(garimpoRuns)
      .innerJoin(personas, eq(personas.id, garimpoRuns.personaId))
      .innerJoin(lists, eq(lists.id, garimpoRuns.listId))
      .where(eq(garimpoRuns.userId, userId))
      .orderBy(desc(garimpoRuns.startedAt))
      .limit(50);

    return {
      runs: rows.map((r) => ({
        ...r.run,
        personaName: r.personaName,
        listName: r.listName,
      })),
    };
  });

  // POST /garimpo/run  — trigger manual run
  fastify.post("/garimpo/run", async (request, reply) => {
    const { id: userId, teamId, role } = request.user as any;
    const { personaId, listId, maxContacts } = z.object({
      personaId:   z.string().uuid(),
      listId:      z.string().uuid(),
      maxContacts: z.number().int().positive().max(100000).optional(),
    }).parse(request.body);

    // Só gestor/admin define o teto de contatos por run; demais perfis seguem o plano.
    const runMax = (role === "manager" || role === "admin") ? maxContacts : undefined;

    // Verify persona & list belong to this team
    const [persona] = await db.select().from(personas)
      .where(and(eq(personas.id, personaId), eq(personas.teamId, teamId))).limit(1);
    if (!persona) return reply.code(404).send({ message: "Persona não encontrada" });

    const [list] = await db.select().from(lists)
      .where(and(eq(lists.id, listId), eq(lists.teamId, teamId))).limit(1);
    if (!list) return reply.code(404).send({ message: "Lista não encontrada" });

    // Enforce plan contact limit before starting
    const [plan, currentCount] = await Promise.all([
      getTeamPlan(teamId),
      getListContactCount(listId),
    ]);
    const { contactsPerList } = getPlanLimits(plan);
    if (currentCount >= contactsPerList) {
      return reply.code(402).send({
        message: `Limite do plano atingido: essa lista já tem ${currentCount} contatos (máx. ${contactsPerList} no plano ${plan}).`,
        limit:   contactsPerList,
        current: currentCount,
        plan,
      });
    }

    const [run] = await db.insert(garimpoRuns).values({
      personaId, listId, userId, status: "pending",
    }).returning();

    await addJob<GarimpoJob>(QUEUES.GARIMPO, "garimpo-run", {
      runId: run.id,
      personaId,
      listId,
      userId,
      teamId,
      maxContacts: runMax,
    });

    return reply.code(202).send({ run });
  });

  // GET /garimpo/runs/:id
  fastify.get("/garimpo/runs/:id", async (request, reply) => {
    const { id: userId } = request.user as any;
    const { id } = request.params as any;
    const [row] = await db
      .select({
        run: garimpoRuns,
        personaName: personas.name,
        listName: lists.name,
      })
      .from(garimpoRuns)
      .innerJoin(personas, eq(personas.id, garimpoRuns.personaId))
      .innerJoin(lists, eq(lists.id, garimpoRuns.listId))
      .where(and(eq(garimpoRuns.id, id), eq(garimpoRuns.userId, userId)))
      .limit(1);

    if (!row) return reply.code(404).send({ message: "Run não encontrada" });
    return { run: { ...row.run, personaName: row.personaName, listName: row.listName } };
  });
}
