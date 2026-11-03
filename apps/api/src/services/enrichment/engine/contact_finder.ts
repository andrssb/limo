import { getFromPool, saveToPool } from "../pool.js";
import { generateCandidates, detectPattern, learnPattern } from "./email_pattern_detector.js";
import { extractPhones } from "./phone_extractor.js";
import { recordSources } from "./source_auditor.js";
import type { EmailSourceType, PhoneSourceType } from "./confidence_scorer.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmailType = "professional" | "personal";
export type PhoneType = "commercial" | "whatsapp" | "personal" | "unknown";

export interface FoundEmail {
  address:    string;
  type:       EmailType;
  confidence: number;
  source:     EmailSourceType;
}

export interface FoundPhone {
  number:     string;
  type:       PhoneType;
  confidence: number;
  source:     PhoneSourceType;
  isWhatsApp: boolean;
}

export interface ContactResult {
  // Best confirmed values
  email:       string | null;
  emailType:   EmailType | null;
  emailConf:   number;
  phone:       string | null;
  phoneType:   PhoneType | null;
  phoneConf:   number;
  whatsapp:    string | null;
  // Full lists for storage in enrichmentData
  allEmails:   FoundEmail[];
  allPhones:   FoundPhone[];
  sources:     string[];
  fromCache:   boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function classifyPhone(phone: string, isWhatsApp: boolean): PhoneType {
  if (isWhatsApp) return "whatsapp";
  // Defensive: phone is typed string, but cache/external sources can deliver a
  // number — coerce before .replace so a single bad value never crashes the worker.
  const digits = String(phone ?? "").replace(/\D/g, "");
  // Brazilian mobile: 11 digits with 9th digit = 9
  if (digits.length === 13 && digits[4] === "9") return "personal";
  // Landline: 10 digits (with country code stripped)
  return "commercial";
}

function classifyEmail(address: string, companyDomain?: string): EmailType {
  if (!companyDomain) return "professional";
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  return domain === companyDomain || domain.endsWith(`.${companyDomain}`)
    ? "professional"
    : "personal";
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function findContact(params: {
  firstName:    string;
  lastName:     string;
  jobTitle?:    string;
  companyName:  string;
  companyId?:   string;
  domain?:      string;
  cnpj?:        string;
  linkedinUrl?: string;
  city?:        string;
  // Contact entity ID from contacts table (for auditing)
  contactId?:   string;
}): Promise<ContactResult> {
  const sources: string[] = [];
  const allEmails: FoundEmail[] = [];
  const allPhones: FoundPhone[] = [];

  // ── 1. Check enrichment pool cache ────────────────────────────────────────
  const cached = await getFromPool(
    params.linkedinUrl,
    `${params.firstName} ${params.lastName}`,
    params.domain
  );

  if (cached && (cached.email || cached.phonesFound.length > 0)) {
    const email = cached.email ?? null;
    const phone = cached.phonesFound[0] ?? null;

    if (email) {
      allEmails.push({
        address:    email,
        type:       classifyEmail(email, params.domain),
        confidence: cached.emailConfidence === "verified" ? 95
                  : cached.emailConfidence === "probable"  ? 75
                  : 50,
        source: "mx_pattern",
      });
    }

    for (const p of cached.phonesFound) {
      allPhones.push({
        number:     p,
        type:       "commercial",
        confidence: 60,
        source:     "cnpj_cadastral",
        isWhatsApp: false,
      });
    }

    return buildResult(email, phone, allEmails, allPhones, [...(cached.sources ?? [])], true);
  }

  // ── 3. Email candidates from domain pattern ────────────────────────────────
  if (params.domain) {
    const candidates = await generateCandidates(params.firstName, params.lastName, params.domain);
    for (const c of candidates) {
      if (!allEmails.find((e) => e.address === c.email)) {
        allEmails.push({
          address:    c.email,
          type:       "professional",
          confidence: c.confidence,
          source:     "mx_pattern",
        });
      }
    }
    if (candidates.length > 0) sources.push("mx_pattern");
  }

  // ── 4. Phone extraction (8-source pipeline) ────────────────────────────────
  const phonesFound = await extractPhones({
    entityId:    params.contactId ?? params.companyId ?? "unknown",
    entityType:  "contact",
    domain:      params.domain,
    cnpj:        params.cnpj,
    companyName: params.companyName,
    city:        params.city,
  });

  for (const p of phonesFound) {
    if (!allPhones.find((ph) => ph.number === p.phone)) {
      allPhones.push({
        number:     p.phone,
        type:       classifyPhone(p.phone, p.isWhatsApp),
        confidence: p.confidenceScore,
        source:     p.sourceType,
        isWhatsApp: p.isWhatsApp,
      });
      if (!sources.includes(p.sourceType)) sources.push(p.sourceType);
    }
  }

  // ── 5. Learn email pattern if we found a confirmed professional email ──────
  const confirmedProf = allEmails.find((e) => e.type === "professional" && e.confidence >= 70);
  if (confirmedProf && params.domain) {
    const pattern = detectPattern(confirmedProf.address, params.firstName, params.lastName);
    if (pattern) {
      await learnPattern({
        domain:     params.domain,
        mxProvider: null,
        pattern,
        example:    confirmedProf.address,
        entityId:   params.contactId,
      });
    }
  }

  // ── 6. Persist to enrichment pool ─────────────────────────────────────────
  const bestEmail = allEmails.sort((a, b) => b.confidence - a.confidence)[0];
  const bestPhone = allPhones.sort((a, b) => b.confidence - a.confidence)[0];

  await saveToPool({
    linkedinUrl:     params.linkedinUrl,
    fullName:        `${params.firstName} ${params.lastName}`,
    companyDomain:   params.domain,
    email:           bestEmail?.address ?? null,
    emailConfidence: bestEmail
      ? bestEmail.confidence >= 80 ? "verified"
      : bestEmail.confidence >= 55 ? "probable"
      : "guessed"
      : "guessed",
    emailsFound:     allEmails.map((e) => e.address),
    phonesFound:     allPhones.map((p) => p.number),
    processesFound:  0,
    sources,
    rawData: {},
  });

  // ── 7. Audit all findings ─────────────────────────────────────────────────
  if (params.contactId) {
    await recordSources([
      ...allEmails.map((e) => ({
        entityType:      "contact" as const,
        entityId:        params.contactId!,
        fieldName:       "email",
        fieldValue:      e.address,
        sourceType:      e.source,
        confidenceScore: e.confidence,
        isValid:         e.confidence >= 60,
      })),
      ...allPhones.map((p) => ({
        entityType:      "contact" as const,
        entityId:        params.contactId!,
        fieldName:       p.isWhatsApp ? "whatsapp" : "phone",
        fieldValue:      p.number,
        sourceType:      p.source,
        confidenceScore: p.confidence,
        isValid:         p.confidence >= 50,
      })),
    ]);
  }

  return buildResult(
    bestEmail?.address ?? null,
    bestPhone?.number  ?? null,
    allEmails,
    allPhones,
    sources,
    false
  );
}

// ─── Result builder ───────────────────────────────────────────────────────────

function buildResult(
  email:     string | null,
  phone:     string | null,
  allEmails: FoundEmail[],
  allPhones: FoundPhone[],
  sources:   string[],
  fromCache: boolean
): ContactResult {
  const emailEntry  = allEmails.find((e) => e.address === email);
  const phoneEntry  = allPhones.find((p) => p.number  === phone);
  const whatsapp    = allPhones.find((p) => p.isWhatsApp)?.number ?? null;

  return {
    email,
    emailType:  emailEntry?.type  ?? null,
    emailConf:  emailEntry?.confidence ?? 0,
    phone:      phone ?? null,
    phoneType:  phoneEntry?.type  ?? null,
    phoneConf:  phoneEntry?.confidence ?? 0,
    whatsapp,
    allEmails,
    allPhones,
    sources,
    fromCache,
  };
}
