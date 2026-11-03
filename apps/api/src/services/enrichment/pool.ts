// Cross-team enrichment pool — every contact enriched by any team
// contributes to (and benefits from) a shared anonymised data cache.

import { getDb } from "@limo/db";
import { enrichmentPool } from "@limo/db";
import { eq, or, and } from "drizzle-orm";

export interface PoolEntry {
  email:           string | null;
  emailConfidence: string | null;
  emailsFound:     string[];
  phonesFound:     string[];
  processesFound:  number;
  sources:         string[];
}

// Returns cached result if fresher than maxAgeHours (default 72h)
export async function getFromPool(
  linkedinUrl?: string,
  fullName?: string,
  companyDomain?: string,
  maxAgeHours = 72
): Promise<PoolEntry | null> {
  const db = getDb();

  const conditions = [];
  if (linkedinUrl)   conditions.push(eq(enrichmentPool.linkedinUrl, linkedinUrl));
  if (fullName && companyDomain) {
    conditions.push(
      and(eq(enrichmentPool.fullName, fullName), eq(enrichmentPool.companyDomain, companyDomain))!
    );
  }
  if (!conditions.length) return null;

  const [row] = await db
    .select()
    .from(enrichmentPool)
    .where(or(...conditions))
    .limit(1);

  if (!row) return null;

  const ageMs = Date.now() - new Date(row.lastEnrichedAt).getTime();
  if (ageMs > maxAgeHours * 60 * 60 * 1000) return null;

  return {
    email:           row.email,
    emailConfidence: row.emailConfidence,
    emailsFound:     (row.emailsFound as string[]) ?? [],
    phonesFound:     (row.phonesFound  as string[]) ?? [],
    processesFound:  row.processesFound,
    sources:         (row.sources      as string[]) ?? [],
  };
}

// Upserts a result into the pool — merges with any existing entry
export async function saveToPool(params: {
  linkedinUrl?:    string;
  fullName?:       string;
  companyDomain?:  string;
  email?:          string | null;
  emailConfidence?: string;
  emailsFound?:    string[];
  phonesFound?:    string[];
  processesFound?: number;
  sources?:        string[];
  rawData?:        Record<string, unknown>;
}): Promise<void> {
  const db = getDb();

  const existing = params.linkedinUrl
    ? await db.select().from(enrichmentPool).where(eq(enrichmentPool.linkedinUrl, params.linkedinUrl)).limit(1)
    : [];

  const prev = existing[0];

  // Merge arrays — deduplicate and keep all valid entries
  const mergeArr = (a?: string[], b?: string[]) =>
    [...new Set([...(a ?? []), ...(b ?? [])])].filter(Boolean);

  if (prev) {
    await db.update(enrichmentPool).set({
      email:           params.email          ?? prev.email,
      emailConfidence: params.emailConfidence ?? prev.emailConfidence ?? "guessed",
      emailsFound:     mergeArr(params.emailsFound, prev.emailsFound as string[]),
      phonesFound:     mergeArr(params.phonesFound,  prev.phonesFound  as string[]),
      processesFound:  Math.max(params.processesFound ?? 0, prev.processesFound),
      sources:         mergeArr(params.sources, prev.sources as string[]),
      rawData:         { ...(prev.rawData as object), ...(params.rawData ?? {}) },
      lastEnrichedAt:  new Date(),
    }).where(eq(enrichmentPool.id, prev.id));
  } else {
    await db.insert(enrichmentPool).values({
      linkedinUrl:    params.linkedinUrl,
      fullName:       params.fullName,
      companyDomain:  params.companyDomain,
      email:          params.email ?? null,
      emailConfidence: params.emailConfidence ?? "guessed",
      emailsFound:    params.emailsFound ?? [],
      phonesFound:    params.phonesFound  ?? [],
      processesFound: params.processesFound ?? 0,
      sources:        params.sources ?? [],
      rawData:        params.rawData ?? {},
    }).onConflictDoNothing();
  }
}
