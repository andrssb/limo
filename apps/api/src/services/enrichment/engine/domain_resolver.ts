import { promises as dns } from "dns";
import { getDb } from "@limo/db";
import { enrDomains } from "@limo/db";
import { eq, sql } from "drizzle-orm";
import { extractDomainFromEmail } from "../../companies.js";
import { scoreDomain } from "./confidence_scorer.js";
import { recordSource } from "./source_auditor.js";
import { findDomainViaGooglePlaces, findDomainViaBing } from "./web_search_enricher.js";
import type { DomainSourceType } from "./confidence_scorer.js";

const FREE_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "outlook.com", "yahoo.com",
  "bol.com.br", "uol.com.br", "terra.com.br", "ig.com.br",
  "live.com", "icloud.com", "protonmail.com",
]);

function isFreeDomain(domain: string): boolean {
  return FREE_DOMAINS.has(domain.toLowerCase());
}

async function hasMx(domain: string): Promise<boolean> {
  try {
    const records = await dns.resolveMx(domain);
    return records.length > 0;
  } catch { return false; }
}

// Extract MX provider name for pattern hints
export async function getMxProvider(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolveMx(domain);
    const top = records.sort((a, b) => a.priority - b.priority)[0]?.exchange ?? "";
    if (top.includes("google")) return "google";
    if (top.includes("outlook") || top.includes("microsoft")) return "microsoft";
    if (top.includes("zoho"))    return "zoho";
    if (top.includes("locaweb")) return "locaweb";
    if (top.includes("uol") || top.includes("kinghost")) return "kinghost";
    return top.split(".").slice(-2).join(".") || null;
  } catch { return null; }
}

// ─── Main resolver ────────────────────────────────────────────────────────────

export interface ResolvedDomain {
  domain: string;
  isOfficial: boolean;
  confidenceScore: number;
  source: string;
  mxProvider: string | null;
}

export async function resolveDomain(params: {
  companyId:    string;
  cnpjEmail?:   string | null;
  companyName?: string;
  knownDomains?: string[];
  city?:         string;
  state?:        string;
}): Promise<ResolvedDomain | null> {
  const db = getDb();

  // 1. Return cached confirmed domain
  const existing = await db
    .select()
    .from(enrDomains)
    .where(eq(enrDomains.companyId, params.companyId))
    .orderBy(sql`${enrDomains.confidenceScore} DESC`)
    .limit(5);

  const official = existing.find((d) => d.isOfficial);
  if (official && official.confidenceScore >= 70) {
    return {
      domain:          official.domain,
      isOfficial:      true,
      confidenceScore: official.confidenceScore,
      source:          official.source ?? "cached",
      mxProvider:      null,
    };
  }

  // ── Helper: verify one candidate via MX + persist if valid ──────────────────
  async function trySave(candidate: { domain: string; source: DomainSourceType; priority: number }) {
    const [hasMxRecord, mxProvider] = await Promise.all([
      hasMx(candidate.domain),
      getMxProvider(candidate.domain),
    ]);
    if (!hasMxRecord) return null;

    const score = scoreDomain({
      sourceType:   candidate.source,
      hasMxRecord:  true,
      isFreeDomain: isFreeDomain(candidate.domain),
    });

    await db
      .insert(enrDomains)
      .values({ companyId: params.companyId, domain: candidate.domain, isOfficial: true, confidenceScore: score, source: candidate.source, verifiedAt: new Date() })
      .onConflictDoNothing();

    await recordSource({
      entityType:      "domain",
      entityId:        params.companyId,
      fieldName:       "domain",
      fieldValue:      candidate.domain,
      sourceType:      candidate.source as any,
      confidenceScore: score,
      isValid:         true,
    });

    return { domain: candidate.domain, isOfficial: true, confidenceScore: score, source: candidate.source as string, mxProvider };
  }

  // 2. Phase 1 — high-quality eager candidates (cnpj_email + known_domains)
  const phase1: Array<{ domain: string; source: DomainSourceType; priority: number }> = [];

  if (params.cnpjEmail) {
    const d = extractDomainFromEmail(params.cnpjEmail);
    if (d && !isFreeDomain(d)) phase1.push({ domain: d, source: "cnpj_email", priority: 1 });
  }

  for (const d of params.knownDomains ?? []) {
    const clean = d.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]!;
    if (clean && !isFreeDomain(clean)) phase1.push({ domain: clean, source: "known_domain", priority: 2 });
  }

  for (const c of phase1.sort((a, b) => a.priority - b.priority)) {
    const result = await trySave(c);
    if (result) return result;
  }

  // 3. Phase 2 — web search (Google Places + Bing) + name_guess in parallel
  //    Only reached if phase 1 found nothing. Web searches fire concurrently with
  //    name slug computation to minimise wall time.
  const slug = params.companyName
    ? params.companyName
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/\s+(s\.?a\.?|ltda\.?|me\.?|epp\.?|eireli\.?|s\/a|sa)\.?\s*$/i, "")
        .replace(/[^a-z0-9]/g, "")
    : "";

  const [placesDomain, bingDomain] = await Promise.all([
    params.companyName ? findDomainViaGooglePlaces(params.companyName, params.city)  : null,
    params.companyName ? findDomainViaBing(params.companyName, params.state)         : null,
  ]);

  const phase2: Array<{ domain: string; source: DomainSourceType; priority: number }> = [];

  if (placesDomain && !isFreeDomain(placesDomain)) {
    phase2.push({ domain: placesDomain, source: "google_places", priority: 3 });
  }

  if (slug.length >= 3) {
    for (const tld of [".com.br", ".com", ".net.br"]) {
      const d = `${slug}${tld}`;
      if (!phase2.find((c) => c.domain === d)) {
        phase2.push({ domain: d, source: "name_guess", priority: 4 });
      }
    }
  }

  if (bingDomain && !isFreeDomain(bingDomain) && !phase2.find((c) => c.domain === bingDomain)) {
    phase2.push({ domain: bingDomain, source: "bing_search", priority: 5 });
  }

  for (const c of phase2.sort((a, b) => a.priority - b.priority)) {
    const result = await trySave(c);
    if (result) return result;
  }

  return null;
}
