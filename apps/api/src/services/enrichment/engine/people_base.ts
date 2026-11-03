// Shared cross-team people base (enr_people).
// Fed primarily by the LinkedIn extension as it scrapes real profiles. This is
// what makes the Garimpo find real decision-makers without any paid API — the
// base grows with every profile a user visits. We only ever store OBSERVED data;
// callers must never pass invented names/emails/phones.

import { getDb } from "@limo/db";
import { enrPeople } from "@limo/db";
import { eq } from "drizzle-orm";
import { canonicalDomain, normalizeName, cnpjDigits } from "./company_resolver.js";

export interface PersonInput {
  firstName?:     string;
  lastName?:      string;
  jobTitle?:      string;
  companyName?:   string;
  companyDomain?: string;
  cnpj?:          string;   // digits-only or formatted — normalized before storing
  linkedinUrl?:   string;
  email?:         string;
  phone?:         string;
  city?:          string;
  state?:         string;
  source?:        string;   // provenance, e.g. "linkedin_extension"
}

// Upserts a real person, deduplicating by LinkedIn URL. Only provided (non-empty)
// fields overwrite existing values — a later visit that lacks a phone won't wipe
// a phone captured earlier.
export async function upsertPersonToBase(p: PersonInput): Promise<void> {
  const fullName = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  if (!fullName && !p.linkedinUrl) return; // nothing identifiable to store

  const db = getDb();
  const source = p.source ?? "linkedin_extension";
  const domain = canonicalDomain(p.companyDomain);
  const nameNorm = p.companyName ? normalizeName(p.companyName) : undefined;
  const cnpj = cnpjDigits(p.cnpj);

  const existing = p.linkedinUrl
    ? await db
        .select({ id: enrPeople.id })
        .from(enrPeople)
        .where(eq(enrPeople.linkedinUrl, p.linkedinUrl))
        .limit(1)
    : [];

  if (existing[0]) {
    // undefined fields are skipped by Drizzle, preserving previously captured data
    await db
      .update(enrPeople)
      .set({
        fullName:      fullName || undefined,
        firstName:     p.firstName,
        lastName:      p.lastName,
        jobTitle:      p.jobTitle,
        companyName:   p.companyName,
        companyNameNorm: nameNorm,
        cnpj:          cnpj ?? undefined,
        companyDomain: domain,
        email:         p.email,
        phone:         p.phone,
        city:          p.city,
        state:         p.state,
        source,
        cachedAt:      new Date(),
      })
      .where(eq(enrPeople.id, existing[0].id));
    return;
  }

  await db.insert(enrPeople).values({
    fullName:      fullName || "(desconhecido)",
    firstName:     p.firstName,
    lastName:      p.lastName,
    jobTitle:      p.jobTitle,
    companyName:   p.companyName,
    companyNameNorm: nameNorm,
    cnpj:          cnpj,
    companyDomain: domain,
    linkedinUrl:   p.linkedinUrl,
    email:         p.email,
    phone:         p.phone,
    city:          p.city,
    state:         p.state,
    source,
  });
}
