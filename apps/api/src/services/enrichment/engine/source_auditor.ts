import { getDb } from "@limo/db";
import { enrSources } from "@limo/db";
import { eq, and, desc } from "drizzle-orm";
import type { PhoneSourceType, EmailSourceType, DomainSourceType } from "./confidence_scorer.js";

export type EntityType = "company" | "contact" | "domain" | "phone" | "email";

export interface SourceRecord {
  entityType:      EntityType;
  entityId:        string;
  fieldName:       string;
  fieldValue:      string;
  sourceType:      PhoneSourceType | EmailSourceType | DomainSourceType | string;
  sourcePriority?: number;
  sourceUrl?:      string;
  snippet?:        string;   // excerpt where the data appeared (evidence)
  personId?:       string;   // related person (enr_people.id)
  companyId?:      string;   // related company (enr_companies.id)
  phoneKind?:      string;   // phone ownership kind (only for phone fields)
  confidenceScore: number;
  isValid?:        boolean;
}

// Record a single data point with its full provenance
export async function recordSource(params: SourceRecord): Promise<void> {
  const db = getDb();
  await db.insert(enrSources).values({
    entityType:      params.entityType,
    entityId:        params.entityId,
    fieldName:       params.fieldName,
    fieldValue:      params.fieldValue,
    sourceType:      params.sourceType,
    sourcePriority:  params.sourcePriority ?? null,
    sourceUrl:       params.sourceUrl ?? null,
    snippet:         params.snippet ?? null,
    personId:        params.personId ?? null,
    companyId:       params.companyId ?? null,
    phoneKind:       params.phoneKind ?? null,
    confidenceScore: params.confidenceScore,
    isValid:         params.isValid ?? null,
  });
}

// Record multiple data points in a single batch insert
export async function recordSources(records: SourceRecord[]): Promise<void> {
  if (!records.length) return;
  const db = getDb();
  await db.insert(enrSources).values(
    records.map((r) => ({
      entityType:      r.entityType,
      entityId:        r.entityId,
      fieldName:       r.fieldName,
      fieldValue:      r.fieldValue,
      sourceType:      r.sourceType,
      sourcePriority:  r.sourcePriority ?? null,
      sourceUrl:       r.sourceUrl ?? null,
      snippet:         r.snippet ?? null,
      personId:        r.personId ?? null,
      companyId:       r.companyId ?? null,
      phoneKind:       r.phoneKind ?? null,
      confidenceScore: r.confidenceScore,
      isValid:         r.isValid ?? null,
    }))
  );
}

// Get the full audit trail for an entity
export async function getSourceHistory(
  entityType: EntityType,
  entityId: string
) {
  const db = getDb();
  return db
    .select()
    .from(enrSources)
    .where(and(eq(enrSources.entityType, entityType), eq(enrSources.entityId, entityId)))
    .orderBy(desc(enrSources.collectedAt));
}

// Get the best (highest confidence) value for a specific field
export async function getBestSource(
  entityType: EntityType,
  entityId: string,
  fieldName: string
) {
  const db = getDb();
  const rows = await db
    .select()
    .from(enrSources)
    .where(
      and(
        eq(enrSources.entityType, entityType),
        eq(enrSources.entityId, entityId),
        eq(enrSources.fieldName, fieldName)
      )
    )
    .orderBy(desc(enrSources.confidenceScore))
    .limit(1);
  return rows[0] ?? null;
}

// Mark a specific source record as validated (or invalidated)
export async function markValidated(sourceId: string, isValid: boolean): Promise<void> {
  const db = getDb();
  await db
    .update(enrSources)
    .set({ isValid, validatedAt: new Date() })
    .where(eq(enrSources.id, sourceId));
}
