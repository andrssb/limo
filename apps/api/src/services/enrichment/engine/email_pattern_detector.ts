import { getDb } from "@limo/db";
import { enrEmailPatterns } from "@limo/db";
import { eq } from "drizzle-orm";
import { promises as dns } from "dns";
import { scoreEmail } from "./confidence_scorer.js";
import { recordSource } from "./source_auditor.js";

// ─── Canonical pattern names ──────────────────────────────────────────────────

export type EmailPattern =
  | "first.last"     // joao.silva@
  | "flast"          // jsilva@
  | "firstl"         // joaos@
  | "first"          // joao@
  | "last.first"     // silva.joao@
  | "lastfirst"      // silvajoao@
  | "last"           // silva@
  | "first_last"     // joao_silva@
  | "first-last";    // joao-silva@

// ─── Name normalisation ───────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

function apply(pattern: EmailPattern, first: string, last: string, domain: string): string {
  const f  = norm(first);
  const l  = norm(last);
  const fi = f[0] ?? "";
  const li = l[0] ?? "";
  const map: Record<EmailPattern, string> = {
    "first.last":  `${f}.${l}@${domain}`,
    "flast":       `${fi}${l}@${domain}`,
    "firstl":      `${f}${li}@${domain}`,
    "first":       `${f}@${domain}`,
    "last.first":  `${l}.${f}@${domain}`,
    "lastfirst":   `${l}${f}@${domain}`,
    "last":        `${l}@${domain}`,
    "first_last":  `${f}_${l}@${domain}`,
    "first-last":  `${f}-${l}@${domain}`,
  };
  return map[pattern];
}

// ─── MX provider → preferred patterns ────────────────────────────────────────

const PROVIDER_PATTERNS: Record<string, EmailPattern[]> = {
  google:    ["first.last", "flast", "first"],
  microsoft: ["first.last", "flast", "first"],
  zoho:      ["first.last", "flast", "first"],
  locaweb:   ["first.last", "flast", "first"],
  kinghost:  ["first.last", "flast", "first"],
};

const DEFAULT_PATTERN_ORDER: EmailPattern[] = [
  "first.last", "flast", "firstl", "first", "last.first", "last", "first_last", "first-last",
];

// ─── Detect pattern from known email + name ───────────────────────────────────

export function detectPattern(
  knownEmail: string,
  firstName: string,
  lastName: string
): EmailPattern | null {
  const [local] = knownEmail.split("@");
  if (!local) return null;

  for (const pattern of DEFAULT_PATTERN_ORDER) {
    if (apply(pattern, firstName, lastName, "x").split("@")[0] === local) {
      return pattern;
    }
  }
  return null;
}

// ─── Learn and persist a pattern ─────────────────────────────────────────────

export async function learnPattern(params: {
  domain:      string;
  mxProvider:  string | null;
  pattern:     EmailPattern;
  example:     string;
  entityId?:   string;
}): Promise<void> {
  const db = getDb();

  const score = scoreEmail({
    sourceType:     "mx_pattern",
    patternLearned: true,
  });

  const existing = await db
    .select()
    .from(enrEmailPatterns)
    .where(eq(enrEmailPatterns.domain, params.domain))
    .limit(1);

  if (existing[0]) {
    const examples = [...new Set([...(existing[0].examples as string[]), params.example])].slice(0, 5);
    await db
      .update(enrEmailPatterns)
      .set({
        pattern:         params.pattern,
        mxProvider:      params.mxProvider,
        examples,
        sampleCount:     (existing[0].sampleCount ?? 1) + 1,
        confidenceScore: Math.min(score + (existing[0].sampleCount ?? 1) * 3, 90),
        lastValidatedAt: new Date(),
      })
      .where(eq(enrEmailPatterns.id, existing[0].id));
  } else {
    await db.insert(enrEmailPatterns).values({
      domain:          params.domain,
      pattern:         params.pattern,
      mxProvider:      params.mxProvider,
      examples:        [params.example],
      confidenceScore: score,
      sampleCount:     1,
      lastValidatedAt: new Date(),
    });
  }

  if (params.entityId) {
    await recordSource({
      entityType:      "email",
      entityId:        params.entityId,
      fieldName:       "email_pattern",
      fieldValue:      params.pattern,
      sourceType:      "mx_pattern",
      confidenceScore: score,
      isValid:         true,
    });
  }
}

// ─── Get or infer best pattern for a domain ───────────────────────────────────

export async function getPatternForDomain(domain: string): Promise<{
  pattern: EmailPattern;
  confidenceScore: number;
  mxProvider: string | null;
} | null> {
  const db = getDb();

  const stored = await db
    .select()
    .from(enrEmailPatterns)
    .where(eq(enrEmailPatterns.domain, domain))
    .limit(1);

  if (stored[0]) {
    return {
      pattern:         stored[0].pattern as EmailPattern,
      confidenceScore: stored[0].confidenceScore,
      mxProvider:      stored[0].mxProvider,
    };
  }

  // Resolve MX and suggest a default pattern for this provider
  try {
    const records = await dns.resolveMx(domain);
    const mx = records.sort((a, b) => a.priority - b.priority)[0]?.exchange ?? "";
    let provider: string | null = null;
    for (const key of Object.keys(PROVIDER_PATTERNS)) {
      if (mx.includes(key)) { provider = key; break; }
    }
    const pattern = provider ? PROVIDER_PATTERNS[provider]![0]! : "first.last";
    return { pattern, confidenceScore: 40, mxProvider: provider };
  } catch { return null; }
}

// ─── Generate candidates for a person + domain ───────────────────────────────

export async function generateCandidates(
  firstName: string,
  lastName:  string,
  domain:    string
): Promise<Array<{ email: string; pattern: EmailPattern; confidence: number }>> {
  const stored = await getPatternForDomain(domain);

  const results: Array<{ email: string; pattern: EmailPattern; confidence: number }> = [];

  if (stored) {
    // Best guess based on known/inferred pattern
    results.push({
      email:      apply(stored.pattern, firstName, lastName, domain),
      pattern:    stored.pattern,
      confidence: stored.confidenceScore,
    });
  }

  // Always include top 3 fallback patterns
  for (const pattern of DEFAULT_PATTERN_ORDER.slice(0, 3)) {
    const email = apply(pattern, firstName, lastName, domain);
    if (!results.find((r) => r.email === email)) {
      results.push({ email, pattern, confidence: 30 });
    }
  }

  return results;
}
