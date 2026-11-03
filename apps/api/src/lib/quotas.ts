import { eq, sql } from "drizzle-orm";

// Persona quota per plan. 1 unit = 1 contact returned by Garimpo IA.
// Trial gets a smaller allowance to encourage upgrade.
//
// ⚠️ Calibrado com o custo do enriquecimento Assertiva (plano consumível de
// R$550/mês). Cada persona ≈ 1 consulta Assertiva, então a SOMA das quotas
// dos times ativos não pode estourar o pool mensal.
//
// 2026-06-09: consulta em LOTE saiu a R$0,25 (era ~R$0,70) → pool rende ~2.200/mês
// (era ~785). Quotas escaladas ~2,8× mantendo o MESMO custo/margem por plano:
//   start 220×0,25=R$55 · metrics 500×0,25=R$125 · business 600×0,25=R$150.
// Trial mantido conservador em 50 (abuso de signup independe do custo; ~44
// trials drenariam o pool — margem de segurança ampla).

export const PERSONAS_MONTHLY_ALLOWANCE: Record<string, number> = {
  trial:    50,
  start:    220,
  metrics:  500,
  business: 600,
  tester:   1_000_000, // plano interno do dono — sem limite prático
};

export function allowanceForPlan(plan: string): number {
  return PERSONAS_MONTHLY_ALLOWANCE[plan] ?? 0;
}

const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export interface PersonaQuotaSummary {
  monthlyAllowance: number;
  monthlyUsed: number;
  monthlyRemaining: number;
  extraBalance: number;
  totalAvailable: number;
  periodStartedAt: Date | null;
  periodEndsAt: Date | null;
}

// ─── Period reset / bootstrap ────────────────────────────────────────────────
// If the team has never run a quota or the period is older than 30 days,
// reset personas_used and bump period_started_at to now.

export async function ensureQuotaPeriod(db: any, teamsTable: any, teamId: string): Promise<void> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId)).limit(1);
  if (!team) return;

  const now = Date.now();
  const startedAt = team.personasPeriodStartedAt ? new Date(team.personasPeriodStartedAt).getTime() : null;
  const expired = startedAt !== null && now - startedAt >= PERIOD_MS;

  if (startedAt === null) {
    await db.update(teamsTable)
      .set({ personasPeriodStartedAt: new Date() })
      .where(eq(teamsTable.id, teamId));
  } else if (expired) {
    await db.update(teamsTable)
      .set({ personasPeriodStartedAt: new Date(), personasUsedCurrentPeriod: 0 })
      .where(eq(teamsTable.id, teamId));
  }
}

// Atomically debit N personas from the team. Drains monthly allowance first,
// then extra balance. Safe to call after a run finishes with `count = contactsFound`.

export async function debitPersonaQuota(db: any, teamsTable: any, teamId: string, count: number): Promise<void> {
  if (count <= 0) return;
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId)).limit(1);
  if (!team) return;

  const monthlyAllowance = allowanceForPlan(team.plan);
  const monthlyRemaining = Math.max(0, monthlyAllowance - (team.personasUsedCurrentPeriod ?? 0));
  const drawFromMonthly = Math.min(count, monthlyRemaining);
  const drawFromExtra   = count - drawFromMonthly;

  await db.update(teamsTable)
    .set({
      personasUsedCurrentPeriod: sql`${teamsTable.personasUsedCurrentPeriod} + ${drawFromMonthly}`,
      personasExtraBalance:      sql`GREATEST(${teamsTable.personasExtraBalance} - ${drawFromExtra}, 0)`,
    })
    .where(eq(teamsTable.id, teamId));
}

export function summarizeQuota(team: any): PersonaQuotaSummary {
  const monthlyAllowance = allowanceForPlan(team.plan);
  const monthlyUsed = team.personasUsedCurrentPeriod ?? 0;
  const extraBalance = team.personasExtraBalance ?? 0;
  const monthlyRemaining = Math.max(0, monthlyAllowance - monthlyUsed);
  return {
    monthlyAllowance,
    monthlyUsed,
    monthlyRemaining,
    extraBalance,
    totalAvailable: monthlyRemaining + extraBalance,
    periodStartedAt: team.personasPeriodStartedAt,
    periodEndsAt:    team.personasPeriodStartedAt
      ? new Date(team.personasPeriodStartedAt.getTime() + PERIOD_MS)
      : null,
  };
}
