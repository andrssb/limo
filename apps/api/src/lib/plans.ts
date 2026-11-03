import { getDb } from "@limo/db";
import { teams } from "@limo/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ─── Plan definitions ─────────────────────────────────────────────────────────

export type PlanName = "trial" | "start" | "metrics" | "business" | "tester";

export interface PlanLimits {
  contactsPerList: number;   // max contacts a single list can hold
}

// "tester" = plano interno do dono: tudo liberado (limite efetivamente infinito).
const UNLIMITED = 1_000_000;

const PLAN_LIMITS: Record<PlanName, PlanLimits> = {
  trial:    { contactsPerList: 30  },
  start:    { contactsPerList: 100 },
  metrics:  { contactsPerList: 200 },
  business: { contactsPerList: 500 },
  tester:   { contactsPerList: UNLIMITED },
};

export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan as PlanName] ?? PLAN_LIMITS.trial;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

export async function getTeamPlan(teamId: string): Promise<PlanName> {
  try {
    const db = getDb();
    const [row] = await db.select({ plan: teams.plan }).from(teams).where(eq(teams.id, teamId)).limit(1);
    return (row?.plan as PlanName) ?? "trial";
  } catch {
    return "trial";
  }
}

export async function getListContactCount(listId: string): Promise<number> {
  try {
    const db = getDb();
    const [row]: any[] = await db.execute(
      sql`SELECT COUNT(*) AS n FROM list_contacts WHERE list_id = ${listId}`
    );
    return parseInt(row?.n ?? "0");
  } catch {
    return 0;
  }
}
