import { groq, MODELS } from "../../../lib/groq.js";
import { getDb } from "@limo/db";
import { enrPeople } from "@limo/db";
import { or, eq, inArray, sql } from "drizzle-orm";
import { recordSources } from "./source_auditor.js";
import { canonicalDomain, normalizeName, cnpjDigits } from "./company_resolver.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PersonaInput {
  roleName:           string;   // e.g. "Gerente de RH"
  painPoint?:         string;   // e.g. "alto custo de turnover"
  productDescription?: string;
  companyName:        string;
  companyTradeName?:  string;   // RF nome fantasia — matches LinkedIn brand name
  cnpj?:              string;
  companyId?:         string;   // enr_companies.id for source auditing
  sector?:            string;
  domain?:            string;   // used to match people at the company
}

export interface PersonaCandidate {
  firstName:      string;
  lastName:       string;
  jobTitle:       string;
  adherenceScore: number;       // 0-100
  source:         string;       // provenance from the base (e.g. "linkedin", "extension")
  linkedinUrl?:   string;
  email?:         string;
  phone?:         string;
}

// ─── In-memory cache for role expansions (per process lifetime) ───────────────

const roleExpansionCache = new Map<string, string[]>();

// ─── Role expansion ───────────────────────────────────────────────────────────
// Uses AI to generate PT + EN variations of a given role title.
// This is orchestration/normalization — it never invents people, only widens the
// set of job titles we accept as a match. Cached per role within a process.

export async function expandRoles(
  roleName: string,
  painPoint?: string,
  sector?: string
): Promise<string[]> {
  const cacheKey = `${roleName}|${sector ?? ""}`;
  if (roleExpansionCache.has(cacheKey)) return roleExpansionCache.get(cacheKey)!;

  const context = [
    painPoint && `Dor/problema que o produto resolve: ${painPoint}`,
    sector    && `Setor da empresa: ${sector}`,
  ].filter(Boolean).join(". ");

  const prompt = `Você é especialista em prospecção B2B no Brasil.

Dado o cargo-alvo "${roleName}"${context ? ` (contexto: ${context})` : ""}, gere uma lista com todas as variações reais deste cargo em empresas brasileiras — tanto em português quanto em inglês, incluindo diferentes níveis hierárquicos e terminologias de mercado.

Retorne APENAS um JSON válido:
{"roles": ["Cargo 1", "Cargo 2", ...]}

Inclua de 8 a 15 variações. Sem explicações.`;

  try {
    const res = await groq.chat.completions.create({
      model:           MODELS.fast,
      max_tokens:      400,
      messages:        [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
    const roles: string[] = [roleName, ...(parsed.roles ?? [])];
    const unique = [...new Set(roles.map((r: string) => r.trim()).filter(Boolean))];
    roleExpansionCache.set(cacheKey, unique);
    return unique;
  } catch {
    return [roleName];
  }
}

// ─── Adherence scoring ────────────────────────────────────────────────────────
// How well does a found person's title match the target persona?

export function scoreAdherence(
  foundTitle: string,
  expandedRoles: string[]
): number {
  const ft = foundTitle.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  for (const role of expandedRoles) {
    const rt = role.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (ft === rt) return 100;                          // exact match
    if (ft.includes(rt) || rt.includes(ft)) return 85;  // substring match
  }

  // Partial keyword overlap
  const targetWords = expandedRoles[0]!.toLowerCase().split(/\s+/);
  const overlap = targetWords.filter((w) => w.length > 3 && ft.includes(w)).length;
  if (overlap > 0) return Math.min(40 + overlap * 15, 70);

  return 20; // found at company but role doesn't match well
}

// ─── Real people from own base (enr_people) ───────────────────────────────────
// The shared people base is fed by the LinkedIn extension and prior enrichment.
// We never invent anyone: if the base has no one at this company, we return [].

async function findInBase(params: PersonaInput): Promise<PersonaCandidate[]> {
  const conditions = [];

  // Strongest join key: CNPJ (exact, format-independent). Present for companies
  // that came from "Descobrir" (Receita Federal).
  const cnpj = cnpjDigits(params.cnpj);
  if (cnpj) conditions.push(eq(enrPeople.cnpj, cnpj));

  // Primary fuzzy key: the canonical company domain (precise).
  const domain = canonicalDomain(params.domain);
  if (domain) conditions.push(eq(enrPeople.companyDomain, domain));

  // Secondary key: normalized company name. Match against BOTH the legal name
  // and the trade name, since LinkedIn stores the brand (~trade) while RF stores
  // the legal name. Exact-after-normalization avoids false positives.
  const normNames = [...new Set(
    [params.companyName, params.companyTradeName]
      .filter((n): n is string => !!n)
      .map((n) => normalizeName(n))
      .filter((n) => n.length >= 3)
  )];
  if (normNames.length > 0) conditions.push(inArray(enrPeople.companyNameNorm, normNames));

  // Fuzzy fallback: trigram similarity tolerates name variations the exact match
  // misses ("Acme Tech" vs "ACME TECNOLOGIA LTDA", spacing, abbreviations). The
  // extension stores the LinkedIn brand name while RF stores the legal name, so
  // exact rarely matches without a CNPJ/domain link (absent in prod). enr_people
  // is small, so this is cheap. Conservative threshold to limit false positives.
  for (const nn of normNames) {
    conditions.push(sql`similarity(${enrPeople.companyNameNorm}, ${nn}) > 0.45`);
  }

  if (conditions.length === 0) return [];

  const db = getDb();
  const rows = await db
    .select()
    .from(enrPeople)
    .where(or(...conditions))
    .limit(25);

  // Reinforce the base: stamp the company CNPJ onto people matched by domain/name
  // that don't have it yet, so future runs join by the strong CNPJ key.
  if (cnpj) {
    const toStamp = rows.filter((r) => !r.cnpj).map((r) => r.id);
    if (toStamp.length > 0) {
      try {
        await db.update(enrPeople).set({ cnpj }).where(inArray(enrPeople.id, toStamp));
      } catch { /* non-critical reinforcement */ }
    }
  }

  return rows.map((r) => {
    const [fnFallback = "", ...rest] = (r.fullName ?? "").split(" ");
    return {
      firstName:      r.firstName ?? fnFallback,
      lastName:       r.lastName  ?? rest.join(" "),
      jobTitle:       r.jobTitle  ?? "",
      adherenceScore: 0, // filled by caller against expanded roles
      source:         r.source ?? "base",
      linkedinUrl:    r.linkedinUrl ?? undefined,
      email:          r.email ?? undefined,
      phone:          r.phone ?? undefined,
    };
  });
}

// ─── Alternative persona suggestions ─────────────────────────────────────────
// Given a product's pain point + sector, suggests OTHER roles/areas that could
// also benefit — shown to the SDR as expansion ideas (roles, never fake people).

export interface AlternativePersonaSuggestion {
  roleName:   string;
  department: string;
  reasoning:  string;
}

export async function suggestAlternativePersonas(
  painPoint:          string,
  productDescription: string,
  sector?:            string
): Promise<AlternativePersonaSuggestion[]> {
  const prompt = `Você é especialista em prospecção B2B no Brasil.

Produto: "${productDescription}"
Dor que resolve: "${painPoint}"
${sector ? `Setor-alvo: ${sector}` : ""}

Além do decisor principal já mapeado, quais OUTRAS áreas ou cargos dentro da empresa também poderiam se beneficiar deste produto ou influenciar a compra?

Responda apenas em JSON:
{"suggestions":[{"roleName":"...","department":"...","reasoning":"..."}]}

Máximo 4 sugestões. Seja específico e prático para o contexto brasileiro.`;

  try {
    const res = await groq.chat.completions.create({
      model:           MODELS.fast,
      max_tokens:      500,
      messages:        [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
    return parsed.suggestions ?? [];
  } catch { return []; }
}

// ─── Main entry point ─────────────────────────────────────────────────────────
// Returns REAL people that the base already knows at this company, ranked by how
// well their title matches the target role. Returns [] when nobody is known yet —
// the caller treats that honestly as "decisor não encontrado".

export async function findPersonas(params: PersonaInput): Promise<PersonaCandidate[]> {
  // 1. Expand role variations (PT + EN) — used only for matching, not invention
  const expandedRoles = await expandRoles(
    params.roleName,
    params.painPoint,
    params.sector
  );

  // 2. Pull real people from the shared base
  const people = await findInBase(params);

  // 3. Score adherence and keep only reasonable role matches
  const candidates = people
    .map((c) => ({ ...c, adherenceScore: scoreAdherence(c.jobTitle, expandedRoles) }))
    .filter((c) => c.adherenceScore >= 40)
    .sort((a, b) => b.adherenceScore - a.adherenceScore);

  // 4. Audit sources
  if (params.companyId && candidates.length > 0) {
    await recordSources(
      candidates.map((c) => ({
        entityType:      "company",
        entityId:        params.companyId!,
        fieldName:       "persona_candidate",
        fieldValue:      `${c.firstName} ${c.lastName} — ${c.jobTitle}`,
        sourceType:      c.source,
        confidenceScore: c.adherenceScore,
        isValid:         true,
      }))
    );
  }

  return candidates;
}
