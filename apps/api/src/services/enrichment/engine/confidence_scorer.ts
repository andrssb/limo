// Confidence scores: 0–100
// Higher = more trustworthy. Used across all enrichment modules.

export type PhoneSourceType =
  | "site_oficial"       // 1 — phone on the official site
  | "whatsapp_link"      // 2 — wa.me or api.whatsapp.com link
  | "contato_rodape"     // 3 — contact page / footer / lojas / unidades
  | "google_places"      // 4 — Google Places / Business Profile
  | "cnpj_cadastral"     // 5 — CNPJ registration data (Receita Federal)
  | "redes_sociais"      // 6 — confirmed commercial social profiles
  | "diretorio_setorial" // 7 — industry / sector directories
  | "base_licenciada";   // 8 — licensed/paid databases

export type EmailSourceType =
  | "verified_smtp"     // confirmed delivery via SMTP
  | "proxycurl"         // Proxycurl API (personal email)
  | "pdl"               // People Data Labs API
  | "mx_pattern"        // inferred from MX record + name pattern
  | "site_scrape"       // found on official site
  | "voyager_api"       // LinkedIn Voyager API (1st degree)
  | "guessed";          // pattern guess with no validation

export type DomainSourceType =
  | "cnpj_email"    // extracted from CNPJ cadastral email
  | "mx_lookup"     // MX record resolved
  | "playwright"    // found via Playwright site navigation
  | "google_places" // Google Maps / Places API
  | "bing_search"   // Bing Web Search API
  | "known_domain"  // explicitly provided
  | "name_guess"    // derived from company name slug
  | "ai_inferred";  // AI-suggested (lowest trust)

// ─── Phone confidence ─────────────────────────────────────────────────────────

const PHONE_SOURCE_BASE: Record<PhoneSourceType, number> = {
  site_oficial:       85,
  whatsapp_link:      80,
  contato_rodape:     75,
  google_places:      70,
  cnpj_cadastral:     65,
  redes_sociais:      55,
  diretorio_setorial: 45,
  base_licenciada:    60,
};

export function scorePhone(params: {
  sourceType: PhoneSourceType;
  isNormalized: boolean;
  ageHours?: number;
}): number {
  let score = PHONE_SOURCE_BASE[params.sourceType];
  if (!params.isNormalized) score -= 10;
  if (params.ageHours !== undefined) {
    if (params.ageHours > 720) score -= 10;  // > 30 days
    if (params.ageHours > 2160) score -= 15; // > 90 days
  }
  return clamp(score);
}

// ─── Email confidence ─────────────────────────────────────────────────────────

const EMAIL_SOURCE_BASE: Record<EmailSourceType, number> = {
  verified_smtp: 95,
  proxycurl:     80,
  pdl:           78,
  voyager_api:   75,
  site_scrape:   70,
  mx_pattern:    60,
  guessed:       30,
};

export function scoreEmail(params: {
  sourceType: EmailSourceType;
  patternLearned?: boolean;
  ageHours?: number;
}): number {
  let score = EMAIL_SOURCE_BASE[params.sourceType];
  if (params.patternLearned) score = Math.min(score + 10, 95);
  if (params.ageHours !== undefined && params.ageHours > 2160) score -= 10;
  return clamp(score);
}

// ─── Domain confidence ────────────────────────────────────────────────────────

const DOMAIN_SOURCE_BASE: Record<DomainSourceType, number> = {
  mx_lookup:      85,
  cnpj_email:     80,
  google_places:  75,
  known_domain:   72,
  playwright:     75,
  name_guess:     45,
  bing_search:    50,
  ai_inferred:    35,
};

export function scoreDomain(params: {
  sourceType: DomainSourceType;
  hasMxRecord: boolean;
  isFreeDomain?: boolean;
}): number {
  let score = DOMAIN_SOURCE_BASE[params.sourceType];
  if (params.hasMxRecord) score = Math.min(score + 10, 95);
  if (params.isFreeDomain) return 0; // gmail, hotmail etc.
  return clamp(score);
}

// ─── Company confidence ───────────────────────────────────────────────────────

export function scoreCompany(params: {
  hasCnpj: boolean;
  cnpjActive?: boolean;
  hasOfficialDomain: boolean;
  sourceCount: number;
}): number {
  let score = 0;
  if (params.hasCnpj)          score += 35;
  if (params.cnpjActive)       score += 20;
  if (params.hasOfficialDomain) score += 25;
  score += Math.min(params.sourceCount * 5, 20);
  return clamp(score);
}

// ─── Identity confidence (person ↔ company) ───────────────────────────────────

export function scoreIdentity(params: {
  nameMatch: boolean;
  companyMatch: boolean;
  roleMatch: boolean;
  linkedinConfirmed: boolean;
  escavadorConfirmed?: boolean;
}): number {
  let score = 0;
  if (params.linkedinConfirmed)   score += 40;
  if (params.escavadorConfirmed)  score += 30;
  if (params.companyMatch)        score += 15;
  if (params.nameMatch)           score += 10;
  if (params.roleMatch)           score += 5;
  return clamp(score);
}

// ─── Confidence levels (0–100 → 4 buckets) ────────────────────────────────────

export type ConfidenceLevel = "baixa" | "media" | "alta" | "altissima";

export function classifyConfidence(score: number): ConfidenceLevel {
  if (score >= 90) return "altissima";
  if (score >= 70) return "alta";
  if (score >= 40) return "media";
  return "baixa";
}

// Boost when multiple independent sources confirm the same value: +8 per extra
// confirming source, capped at +24. A single source keeps its base score.
export function multiSourceBoost(baseScore: number, sourceCount: number): number {
  if (sourceCount <= 1) return clamp(baseScore);
  return clamp(baseScore + Math.min((sourceCount - 1) * 8, 24));
}

// ─── Phone ownership kind (distinct from PhoneSourceType) ─────────────────────
// PhoneSourceType says WHERE the number came from; PhoneKind says WHOSE it is.
// A company number must never be presented as the person's direct line.

export type PhoneKind =
  | "direto_pessoa"       // direct line tied to the person
  | "comercial_empresa"   // company commercial line
  | "whatsapp_comercial"  // company WhatsApp
  | "atendimento"         // support / SAC
  | "unidade"             // branch / store
  | "generico"            // generic, unattributed
  | "sem_evidencia";      // found but no evidence of ownership

// Classifies a phone's ownership from the signals we have. Without a
// person-specific source, a number is treated as a company channel — never as
// the person's direct line.
export function classifyPhoneKind(params: {
  sourceType: PhoneSourceType;
  isWhatsApp: boolean;
  tiedToPerson?: boolean;   // true only when the source is the person themselves
}): PhoneKind {
  if (params.isWhatsApp) return "whatsapp_comercial";
  if (params.tiedToPerson) return "direto_pessoa";
  switch (params.sourceType) {
    case "site_oficial":
    case "cnpj_cadastral":
    case "google_places":
      return "comercial_empresa";
    case "contato_rodape":
      return "atendimento";
    case "redes_sociais":
    case "diretorio_setorial":
    case "base_licenciada":
      return "generico";
    default:
      return "sem_evidencia";
  }
}

// Human-friendly label for the UI.
export function phoneKindLabel(kind: PhoneKind): string {
  const labels: Record<PhoneKind, string> = {
    direto_pessoa:      "Telefone direto da pessoa",
    comercial_empresa:  "Telefone comercial da empresa",
    whatsapp_comercial: "WhatsApp comercial",
    atendimento:        "Telefone de atendimento",
    unidade:            "Telefone da unidade",
    generico:           "Telefone genérico",
    sem_evidencia:      "Sem evidência de titularidade",
  };
  return labels[kind];
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
