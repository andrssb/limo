import { getDb } from "@limo/db";
import { enrCompanies } from "@limo/db";
import { eq, ilike, or } from "drizzle-orm";
import { enrichCnpj, extractDomainFromEmail } from "../../companies.js";
import { scoreCompany } from "./confidence_scorer.js";
import { recordSource } from "./source_auditor.js";

// ─── Name normalisation ───────────────────────────────────────────────────────

const LEGAL_SUFFIXES = /\s+(s\.?a\.?|ltda\.?|me\.?|epp\.?|eireli\.?|s\/a|sa)\.?\s*$/i;

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(LEGAL_SUFFIXES, "")
    .trim()
    .toLowerCase();
}

// Digits-only CNPJ (14 chars) for reliable joins across formatted/unformatted
// sources. Returns null unless it's a full 14-digit CNPJ.
export function cnpjDigits(cnpj?: string | null): string | null {
  if (!cnpj) return null;
  const d = cnpj.replace(/\D/g, "").slice(0, 14);
  return d.length === 14 ? d : null;
}

// Canonical host form for reliable domain joins: lowercases, drops protocol,
// "www.", path, query and port. "https://www.Acme.com.br/sobre" → "acme.com.br".
export function canonicalDomain(d?: string | null): string | null {
  if (!d) return null;
  const host = d.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!
    .split("?")[0]!
    .split(":")[0]!;
  return host || null;
}

// ─── Main resolver ────────────────────────────────────────────────────────────

export interface ResolvedCompany {
  id: string;
  name: string;
  tradeName: string | null;
  legalName: string | null;
  cnpj: string | null;
  sector: string | null;
  state: string | null;
  city: string | null;
  employeeRange: string | null;
  confidenceScore: number;
  domain: string | null;         // best known domain (may be null)
}

export async function resolveCompany(input: {
  name?: string;
  cnpj?: string;
  domain?: string;
  sector?: string;
  state?: string;
  city?: string;
}): Promise<ResolvedCompany | null> {
  const db = getDb();

  // 1. Try exact CNPJ match first (most reliable)
  if (input.cnpj) {
    const clean = input.cnpj.replace(/\D/g, "");
    const formatted = clean.length === 14
      ? `${clean.slice(0,2)}.${clean.slice(2,5)}.${clean.slice(5,8)}/${clean.slice(8,12)}-${clean.slice(12)}`
      : input.cnpj;

    const [existing] = await db
      .select()
      .from(enrCompanies)
      .where(eq(enrCompanies.cnpj, formatted))
      .limit(1);

    if (existing) return toResolved(existing, input.domain);

    // Not in our DB yet — fetch from BrasilAPI and create
    const cnpjData = await enrichCnpj(clean);
    if (cnpjData) {
      return createFromCnpj(cnpjData, input);
    }
  }

  // 2. Try name match
  if (input.name) {
    const normalized = normalizeName(input.name);
    const [existing] = await db
      .select()
      .from(enrCompanies)
      .where(
        or(
          ilike(enrCompanies.name, `%${normalized}%`),
          ilike(enrCompanies.tradeName, `%${normalized}%`),
          ilike(enrCompanies.legalName, `%${normalized}%`)
        )!
      )
      .limit(1);

    if (existing) return toResolved(existing, input.domain);
  }

  // 3. Not found — create a new entry with what we have
  return createNew(input);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createFromCnpj(
  cnpjData: any,
  input: Parameters<typeof resolveCompany>[0]
): Promise<ResolvedCompany> {
  const db = getDb();

  const domain = extractDomainFromEmail(cnpjData.email ?? "") || input.domain || null;

  const score = scoreCompany({
    hasCnpj:          true,
    cnpjActive:       cnpjData.situacao_cadastral === "ATIVA",
    hasOfficialDomain: !!domain,
    sourceCount:      2,
  });

  const [row] = await db
    .insert(enrCompanies)
    .values({
      name:           normalizeName(cnpjData.razao_social ?? input.name ?? ""),
      tradeName:      cnpjData.nome_fantasia || null,
      legalName:      cnpjData.razao_social ?? null,
      cnpj:           cnpjData.cnpj ?? null,
      sector:         cnpjData.cnae_fiscal_descricao ?? input.sector ?? null,
      state:          cnpjData.uf ?? input.state ?? null,
      city:           cnpjData.municipio ?? input.city ?? null,
      confidenceScore: score,
    })
    .onConflictDoNothing()
    .returning();

  if (row) {
    await recordSource({
      entityType:      "company",
      entityId:        row.id,
      fieldName:       "cnpj",
      fieldValue:      row.cnpj ?? "",
      sourceType:      "cnpj_cadastral",
      sourcePriority:  5,
      sourceUrl:       `https://publica.cnpj.ws/cnpj/${(row.cnpj ?? "").replace(/\D/g, "")}`,
      confidenceScore: score,
      isValid:         true,
    });
  }

  return toResolved(row ?? { ...input, id: "", confidenceScore: score }, domain);
}

async function createNew(
  input: Parameters<typeof resolveCompany>[0]
): Promise<ResolvedCompany | null> {
  if (!input.name && !input.cnpj) return null;
  const db = getDb();

  const score = scoreCompany({
    hasCnpj:          !!input.cnpj,
    hasOfficialDomain: !!input.domain,
    sourceCount:      1,
  });

  const [row] = await db
    .insert(enrCompanies)
    .values({
      name:           normalizeName(input.name ?? ""),
      cnpj:           input.cnpj ?? null,
      sector:         input.sector ?? null,
      state:          input.state ?? null,
      city:           input.city ?? null,
      confidenceScore: score,
    })
    .onConflictDoNothing()
    .returning();

  return row ? toResolved(row, input.domain) : null;
}

function toResolved(row: any, inputDomain?: string | null): ResolvedCompany {
  return {
    id:              row.id,
    name:            row.name ?? "",
    tradeName:       row.tradeName ?? null,
    legalName:       row.legalName ?? null,
    cnpj:            row.cnpj ?? null,
    sector:          row.sector ?? null,
    state:           row.state ?? null,
    city:            row.city ?? null,
    employeeRange:   row.employeeRange ?? null,
    confidenceScore: row.confidenceScore ?? 0,
    domain:          inputDomain ?? null,
  };
}
