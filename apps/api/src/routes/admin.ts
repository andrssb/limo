import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "@limo/db";
import { enrRuns, teams } from "@limo/db";
import { sql, desc, eq } from "drizzle-orm";
import { requireManager, requireOwner } from "../middleware/auth.js";
import { addJob, QUEUES, type PassiveEngineJob } from "../lib/queue.js";
import { UFS_ROTATION, stateOfDay } from "../workers/passive-engine.js";
import { randomUUID } from "crypto";
import { config } from "../config.js";

const PERIOD_MS_24H = 24 * 60 * 60 * 1000;
const PERIOD_MS_7D  = 7  * 24 * 60 * 60 * 1000;

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  // ─── GET /admin/passive-engine/stats ────────────────────────────────────────
  // Aggregates last 24h and last 7d, plus the latest run summary.

  fastify.get("/admin/passive-engine/stats", { preHandler: [requireManager] }, async (_req, reply) => {
    const now = Date.now();
    const cutoff24h = new Date(now - PERIOD_MS_24H);
    const cutoff7d  = new Date(now - PERIOD_MS_7D);

    const [agg24h]: any[] = await db.execute(sql`
      SELECT
        COUNT(*)::int                                AS runs,
        COALESCE(SUM(companies_processed), 0)::int   AS companies_processed,
        COALESCE(SUM(people_found), 0)::int          AS people_found,
        COALESCE(SUM(job_titles_identified), 0)::int AS job_titles_identified,
        COALESCE(SUM(linkedin_urls_found), 0)::int   AS linkedin_urls_found,
        COALESCE(SUM(emails_inferred), 0)::int       AS emails_inferred,
        COALESCE(SUM(phones_found), 0)::int          AS phones_found,
        COALESCE(SUM(records_saved), 0)::int         AS records_saved,
        COALESCE(SUM(errors_count), 0)::int          AS errors
      FROM enr_runs
      WHERE started_at >= ${cutoff24h.toISOString()}
    `);

    const [agg7d]: any[] = await db.execute(sql`
      SELECT
        COUNT(*)::int                                AS runs,
        COALESCE(SUM(companies_processed), 0)::int   AS companies_processed,
        COALESCE(SUM(people_found), 0)::int          AS people_found,
        COALESCE(SUM(records_saved), 0)::int         AS records_saved,
        COALESCE(SUM(errors_count), 0)::int          AS errors
      FROM enr_runs
      WHERE started_at >= ${cutoff7d.toISOString()}
    `);

    const [lastDone] = await db.select().from(enrRuns)
      .where(eq(enrRuns.status, "done"))
      .orderBy(desc(enrRuns.completedAt))
      .limit(1);

    const [current] = await db.select().from(enrRuns)
      .where(eq(enrRuns.status, "running"))
      .orderBy(desc(enrRuns.startedAt))
      .limit(1);

    return reply.send({
      last24h:    agg24h ?? {},
      last7d:     agg7d  ?? {},
      lastDone:   lastDone ?? null,
      current:    current ?? null,
      ufs:        UFS_ROTATION,        // lista de UFs na ordem de rotação
      targetUF:   stateOfDay(),        // UF do dia (default do trigger)
    });
  });

  // ─── GET /admin/passive-engine/coverage ─────────────────────────────────────
  // % de empresas varridas pelo motor (last_engine_pass não nulo) por estado.

  fastify.get("/admin/passive-engine/coverage", { preHandler: [requireManager] }, async (_req, reply) => {
    const rows: any[] = await db.execute(sql`
      SELECT state,
             COUNT(*)::int               AS total,
             COUNT(last_engine_pass)::int AS processed
      FROM   disc_companies
      WHERE  state IS NOT NULL
      GROUP  BY state
    `);
    const coverage = rows.map((r) => ({
      state:     r.state,
      total:     Number(r.total),
      processed: Number(r.processed),
      pct:       r.total > 0 ? Math.round((Number(r.processed) / Number(r.total)) * 1000) / 10 : 0,
    }));
    return reply.send({ coverage });
  });

  // ─── GET /admin/passive-engine/runs ─────────────────────────────────────────
  // Paginated list of recent runs (most recent first).

  fastify.get("/admin/passive-engine/runs", { preHandler: [requireManager] }, async (req, reply) => {
    const limit  = Math.min(Number((req.query as any).limit  ?? 30), 100);
    const offset = Math.max(Number((req.query as any).offset ?? 0),  0);
    const runs = await db.select().from(enrRuns)
      .orderBy(desc(enrRuns.startedAt))
      .limit(limit)
      .offset(offset);
    return reply.send({ runs });
  });

  // ─── POST /admin/passive-engine/trigger ─────────────────────────────────────
  // Manually start a new run. Refuses if another run is already in progress.

  fastify.post("/admin/passive-engine/trigger", { preHandler: [requireManager] }, async (req, reply) => {
    const userId = (req.user as any).id as string;

    // Estado opcional — se ausente, o worker usa a UF do dia (rotação).
    const body  = (req.body ?? {}) as { state?: string };
    const state = body.state ? body.state.toUpperCase() : undefined;
    if (state && !(UFS_ROTATION as readonly string[]).includes(state)) {
      return reply.code(400).send({ message: "Estado (UF) inválido" });
    }

    const [running] = await db.select({ id: enrRuns.id }).from(enrRuns)
      .where(eq(enrRuns.status, "running"))
      .limit(1);
    if (running) {
      return reply.code(409).send({ message: "Já existe uma execução em andamento" });
    }

    const runId = randomUUID();
    await db.insert(enrRuns).values({
      id:                runId,
      triggeredBy:       "manual",
      triggeredByUserId: userId,
      status:            "running",
    });

    const job: PassiveEngineJob = {
      runId,
      triggeredBy:       "manual",
      triggeredByUserId: userId,
      state,
    };
    await addJob(QUEUES.PASSIVE_ENGINE, "run", job);

    return reply.send({ runId, status: "queued", state: state ?? stateOfDay() });
  });

  // ─── GET /admin/assertiva/usage ─────────────────────────────────────────────
  // Consumo do pool da Assertiva no mês corrente. ESTIMADO: conta as consultas
  // pagas registradas em paid_enrichments (provider='assertiva') × custo/consulta.
  // `official` fica null até existir endpoint de saldo na API da Assertiva —
  // quando houver, basta preencher esse campo aqui (UI já trata os dois casos).
  // Restrito ao dono: o pool é global e compartilhado entre todos os times.

  fastify.get("/admin/assertiva/usage", { preHandler: [requireOwner] }, async (_req, reply) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [row]: any[] = await db.execute(sql`
      SELECT
        COUNT(*)::int                                  AS queries,
        COUNT(*) FILTER (WHERE matched)::int           AS matched_queries
      FROM paid_enrichments
      WHERE provider = 'assertiva'
        AND created_at >= ${monthStart.toISOString()}
    `);

    const queries     = Number(row?.queries ?? 0);
    const costPerQ    = config.ASSERTIVA_COST_PER_QUERY_BRL;
    const poolBrl     = config.ASSERTIVA_MONTHLY_POOL_BRL;
    const estCostBrl  = Math.round(queries * costPerQ * 100) / 100;
    const pctUsed     = poolBrl > 0 ? Math.round((estCostBrl / poolBrl) * 1000) / 10 : 0;
    const remainingQ  = costPerQ > 0 ? Math.max(0, Math.floor((poolBrl - estCostBrl) / costPerQ)) : 0;

    return reply.send({
      source:          "estimated",        // 'estimated' | 'official' (futuro)
      monthStart:      monthStart.toISOString(),
      queries,
      matchedQueries:  Number(row?.matched_queries ?? 0),
      costPerQueryBrl: costPerQ,
      poolBrl,
      estCostBrl,
      pctUsed,
      remainingQueries: remainingQ,
      official:        null,               // saldo oficial da Assertiva (pendente endpoint)
    });
  });

  // ─── Liga/desliga da Assertiva por time (gestor) ─────────────────────────────
  // Em demo, liga pra trazer o telefone/e-mail real; em teste, desliga pra não gastar.
  fastify.get("/admin/assertiva/setting", { preHandler: [requireManager] }, async (req, reply) => {
    const { teamId } = req.user as any;
    const [t] = await db.select({ enabled: teams.assertivaEnabled }).from(teams).where(eq(teams.id, teamId)).limit(1);
    return reply.send({ enabled: t?.enabled ?? true });
  });

  fastify.put("/admin/assertiva/setting", { preHandler: [requireManager] }, async (req, reply) => {
    const { teamId } = req.user as any;
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    await db.update(teams).set({ assertivaEnabled: enabled }).where(eq(teams.id, teamId));
    return reply.send({ enabled });
  });
}
