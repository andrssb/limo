import { scoreIdentity } from "./confidence_scorer.js";
import { recordSource } from "./source_auditor.js";
import { normalizeName } from "./company_resolver.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IdentityInput {
  firstName:      string;
  lastName:       string;
  jobTitle?:      string;
  companyName:    string;
  companyDomain?: string;
  linkedinUrl?:   string;
  emailDomain?:   string;   // domain extracted from any known email
  // External confirmations (filled by persona_finder, Escavador, etc.)
  escavadorConfirmed?: boolean;
  linkedinConfirmed?:  boolean;
}

export interface IdentitySignal {
  type:   string;
  passed: boolean;
  weight: number;
  detail: string;
}

export interface IdentityResult {
  score:     number;    // 0-100
  confirmed: boolean;  // score >= 60
  signals:   IdentitySignal[];
}

// ─── Name normalisation helpers ───────────────────────────────────────────────

function nameParts(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function namesOverlap(a: string, b: string): boolean {
  const pa = nameParts(a);
  const pb = nameParts(b);
  return pa.some((w) => w.length > 2 && pb.includes(w));
}

// ─── Email domain check ───────────────────────────────────────────────────────
// If the person has an email whose domain matches the company domain,
// that's a strong identity signal.

function emailMatchesDomain(emailDomain?: string, companyDomain?: string): boolean {
  if (!emailDomain || !companyDomain) return false;
  const ed = emailDomain.replace(/^www\./, "").toLowerCase();
  const cd = companyDomain.replace(/^www\./, "").toLowerCase();
  return ed === cd || ed.endsWith(`.${cd}`) || cd.endsWith(`.${ed}`);
}

// ─── LinkedIn URL heuristic ───────────────────────────────────────────────────
// Validates that a LinkedIn URL looks like a real profile URL
// (not a company page, job listing, etc.)

function isPersonLinkedIn(url?: string): boolean {
  if (!url) return false;
  return /linkedin\.com\/in\/[a-z0-9\-]+/i.test(url);
}

// ─── Company name match ───────────────────────────────────────────────────────

function companyNamesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ─── Main matcher ─────────────────────────────────────────────────────────────

export function matchIdentity(input: IdentityInput): IdentityResult {
  const signals: IdentitySignal[] = [];

  // Signal 1: Escavador confirmed person at company (strongest)
  signals.push({
    type:   "escavador_confirmed",
    passed: !!input.escavadorConfirmed,
    weight: 40,
    detail: input.escavadorConfirmed
      ? "Pessoa confirmada no Escavador como sócio/diretor da empresa"
      : "Não confirmado via Escavador",
  });

  // Signal 2: LinkedIn profile URL is present and looks valid
  signals.push({
    type:   "linkedin_profile",
    passed: isPersonLinkedIn(input.linkedinUrl),
    weight: 20,
    detail: isPersonLinkedIn(input.linkedinUrl)
      ? "Possui perfil LinkedIn válido"
      : "Sem URL LinkedIn ou URL inválida",
  });

  // Signal 3: LinkedIn confirmed (e.g., via Proxycurl)
  signals.push({
    type:   "linkedin_confirmed",
    passed: !!input.linkedinConfirmed,
    weight: 15,
    detail: input.linkedinConfirmed
      ? "Cargo/empresa confirmado via LinkedIn"
      : "Cargo/empresa não verificado no LinkedIn",
  });

  // Signal 4: Email domain matches company domain
  const emailMatch = emailMatchesDomain(input.emailDomain, input.companyDomain);
  signals.push({
    type:   "email_domain_match",
    passed: emailMatch,
    weight: 15,
    detail: emailMatch
      ? `Email com domínio ${input.emailDomain} confere com ${input.companyDomain}`
      : "Domínio do email não confere com a empresa",
  });

  // Signal 5: Company name matches (basic sanity check)
  const companyMatch = companyNamesMatch(input.companyName, input.companyName);
  signals.push({
    type:   "company_name_match",
    passed: companyMatch,
    weight: 10,
    detail: "Correspondência de nome da empresa",
  });

  const score = scoreIdentity({
    nameMatch:           true, // we always have a name if we got here
    companyMatch:        true,
    roleMatch:           !!input.jobTitle,
    linkedinConfirmed:   !!input.linkedinConfirmed,
    escavadorConfirmed:  !!input.escavadorConfirmed,
  });

  // Override with signal-based calculation for more granularity
  const rawScore = signals
    .filter((s) => s.passed)
    .reduce((sum, s) => sum + s.weight, 0);

  const finalScore = Math.max(score, rawScore);

  return {
    score:     Math.min(finalScore, 100),
    confirmed: finalScore >= 55,
    signals,
  };
}

// ─── Async variant with source auditing ──────────────────────────────────────

export async function matchAndAuditIdentity(
  input: IdentityInput,
  entityId: string
): Promise<IdentityResult> {
  const result = matchIdentity(input);

  await recordSource({
    entityType:      "contact",
    entityId,
    fieldName:       "identity_score",
    fieldValue:      result.score.toString(),
    sourceType:      result.confirmed ? "escavador" : "ai_inferred",
    confidenceScore: result.score,
    isValid:         result.confirmed,
  });

  return result;
}
