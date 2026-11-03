import { Worker } from "bullmq";
import { createRedis } from "../lib/redis.js";
import { getDb } from "@limo/db";
import { sql, and, isNull, lt, or, gte } from "drizzle-orm";
import { QUEUES, type DailyEnrichmentJob } from "../lib/queue.js";
import { resolveCompany }  from "../services/enrichment/engine/company_resolver.js";
import { resolveDomain }   from "../services/enrichment/engine/domain_resolver.js";
import { extractPhones }   from "../services/enrichment/engine/phone_extractor.js";
import { findContact }     from "../services/enrichment/engine/contact_finder.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── Job handlers ─────────────────────────────────────────────────────────────

// 1. enrich-companies
// Find enr_companies rows with low confidence or old lastEnrichedAt, re-run
// domain resolution + phone extraction, update confidence score.

async function enrichIncompleteCompanies(batchSize: number, offset: number) {
  const db  = getDb();
  const cutoff = daysAgo(3);

  const rows: any[] = await db.execute(sql`
    SELECT id, name, trade_name, legal_name, cnpj, sector, state, city,
           confidence_score, last_enriched_at
    FROM   enr_companies
    WHERE  confidence_score < 60
      AND  last_enriched_at < ${cutoff}
    ORDER  BY confidence_score ASC, last_enriched_at ASC
    LIMIT  ${batchSize} OFFSET ${offset}
  `);

  let updated = 0;

  for (const row of rows) {
    try {
      const dr = await resolveDomain({
        companyId: row.id,
        cnpjEmail: undefined,
        knownDomains: [],
      });

      const phones = dr?.domain
        ? await extractPhones({
            entityId:    row.id,
            entityType:  "company",
            domain:      dr.domain,
            cnpj:        row.cnpj ?? undefined,
            companyName: row.trade_name ?? row.name,
            city:        row.city ?? undefined,
          })
        : [];

      // Recalculate confidence
      const newScore = Math.min(
        (dr ? 25 : 0) + (phones.length > 0 ? 20 : 0) + (row.cnpj ? 35 : 0),
        100
      );

      await db.execute(sql`
        UPDATE enr_companies
        SET    confidence_score = ${newScore},
               last_enriched_at = NOW()
        WHERE  id = ${row.id}
      `);

      updated++;
      await wait(500); // rate-limit between companies
    } catch { /* skip individual failures */ }
  }

  return { processed: rows.length, updated };
}

// 2. complete-contacts
// Find contacts (from garimpo) missing email OR phone, try to fill them.

async function completeIncompleteContacts(batchSize: number, offset: number) {
  const db = getDb();

  const rows: any[] = await db.execute(sql`
    SELECT id, first_name, last_name, job_title, company_name, company_domain,
           linkedin_url, enrichment_data
    FROM   contacts
    WHERE  source = 'garimpo'
      AND  (email IS NULL OR phone IS NULL)
    ORDER  BY created_at ASC
    LIMIT  ${batchSize} OFFSET ${offset}
  `);

  let enriched = 0;

  for (const row of rows) {
    try {
      const result = await findContact({
        firstName:   row.first_name,
        lastName:    row.last_name,
        jobTitle:    row.job_title ?? undefined,
        companyName: row.company_name ?? "",
        domain:      row.company_domain ?? undefined,
        linkedinUrl: row.linkedin_url ?? undefined,
        contactId:   row.id,
      });

      if (result.email || result.phone) {
        await db.execute(sql`
          UPDATE contacts
          SET    email      = COALESCE(email,      ${result.email}),
                 phone      = COALESCE(phone,      ${result.phone}),
                 updated_at = NOW(),
                 enrichment_data = enrichment_data || ${JSON.stringify({
                   emailConfidence:   result.emailConf,
                   phoneConfidence:   result.phoneConf,
                   whatsapp:          result.whatsapp,
                   enrichmentSources: result.sources,
                   lastDailyEnrich:   new Date().toISOString(),
                 })}::jsonb
          WHERE  id = ${row.id}
        `);
        enriched++;
      }

      await wait(800);
    } catch { /* skip */ }
  }

  return { processed: rows.length, enriched };
}

// 3. revalidate-stale
// Contacts not updated in maxAgeDays with email/phone — re-run findContact
// to see if more confident data is available now (pool may have grown).

async function revalidateStaleContacts(maxAgeDays: number, batchSize: number, offset: number) {
  const db  = getDb();
  const cutoff = daysAgo(maxAgeDays);

  const rows: any[] = await db.execute(sql`
    SELECT id, first_name, last_name, job_title, company_name, company_domain,
           linkedin_url, email, phone, enrichment_data
    FROM   contacts
    WHERE  source      = 'garimpo'
      AND  updated_at  < ${cutoff}
      AND  (email IS NOT NULL OR phone IS NOT NULL)
    ORDER  BY updated_at ASC
    LIMIT  ${batchSize} OFFSET ${offset}
  `);

  let revalidated = 0;

  for (const row of rows) {
    try {
      const result = await findContact({
        firstName:   row.first_name,
        lastName:    row.last_name,
        jobTitle:    row.job_title ?? undefined,
        companyName: row.company_name ?? "",
        domain:      row.company_domain ?? undefined,
        linkedinUrl: row.linkedin_url ?? undefined,
        contactId:   row.id,
      });

      const ed = (row.enrichment_data ?? {}) as any;
      const currentEmailConf = ed.emailConfidence ?? 0;
      const currentPhoneConf = ed.phoneConfidence ?? 0;

      // Only update if we found something with higher confidence
      const betterEmail = result.email && result.emailConf > currentEmailConf;
      const betterPhone = result.phone && result.phoneConf > currentPhoneConf;

      if (betterEmail || betterPhone) {
        await db.execute(sql`
          UPDATE contacts
          SET    email      = ${betterEmail ? result.email : row.email},
                 phone      = ${betterPhone ? result.phone : row.phone},
                 updated_at = NOW(),
                 enrichment_data = enrichment_data || ${JSON.stringify({
                   emailConfidence:  result.emailConf,
                   phoneConfidence:  result.phoneConf,
                   whatsapp:         result.whatsapp ?? ed.whatsapp,
                   lastRevalidated:  new Date().toISOString(),
                 })}::jsonb
          WHERE  id = ${row.id}
        `);
        revalidated++;
      } else {
        // Stamp as revalidated even if nothing changed
        await db.execute(sql`
          UPDATE contacts
          SET    enrichment_data = enrichment_data || '{"lastRevalidated":"${new Date().toISOString()}"}'::jsonb
          WHERE  id = ${row.id}
        `);
      }

      await wait(600);
    } catch { /* skip */ }
  }

  return { processed: rows.length, revalidated };
}

// 4. flag-obsolete
// Contacts older than maxAgeDays that still have no email or phone are flagged
// as "needs_manual_review". Source records older than 90 days without validation
// are marked as needing re-check.

async function flagObsoleteData(maxAgeDays: number, batchSize: number) {
  const db  = getDb();
  const cutoff = daysAgo(maxAgeDays);

  // Flag contacts with no contact info after maxAgeDays
  const flagged: any[] = await db.execute(sql`
    UPDATE contacts
    SET    enrichment_data = enrichment_data || '{"status":"needs_manual_review","flaggedAt":"${new Date().toISOString()}"}'::jsonb,
           updated_at = NOW()
    WHERE  source      = 'garimpo'
      AND  created_at  < ${cutoff}
      AND  email IS NULL
      AND  phone IS NULL
      AND  (enrichment_data->>'status' IS DISTINCT FROM 'needs_manual_review')
    RETURNING id
  `);

  // Mark enr_sources older than maxAgeDays with null is_valid as stale
  await db.execute(sql`
    UPDATE enr_sources
    SET    is_valid = FALSE
    WHERE  collected_at < ${cutoff}
      AND  is_valid IS NULL
  `);

  return { flagged: flagged.length };
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startDailyEnrichmentWorker(): Worker {
  return new Worker<DailyEnrichmentJob>(
    QUEUES.ENRICHMENT_DAILY,
    async (job) => {
      const { type, batchSize = 20, maxAgeDays = 30, offset = 0 } = job.data;

      switch (type) {
        case "enrich-companies":
          return enrichIncompleteCompanies(batchSize, offset);

        case "complete-contacts":
          return completeIncompleteContacts(batchSize, offset);

        case "revalidate-stale":
          return revalidateStaleContacts(maxAgeDays, batchSize, offset);

        case "flag-obsolete":
          return flagObsoleteData(maxAgeDays, batchSize);

        default:
          throw new Error(`Unknown daily enrichment job type: ${type}`);
      }
    },
    {
      connection:  createRedis(),
      concurrency: 1, // one at a time — each job is already I/O heavy
    }
  );
}
