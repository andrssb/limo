import { Worker } from "bullmq";
import { createRedis } from "../lib/redis.js";
import { getDb } from "@limo/db";
import { enrRuns, enrPeople } from "@limo/db";
import { sql, eq, and } from "drizzle-orm";
import { QUEUES, type PassiveEngineJob } from "../lib/queue.js";
import { resolveDomain } from "../services/enrichment/engine/domain_resolver.js";
import { extractPhones } from "../services/enrichment/engine/phone_extractor.js";
import { scanSite } from "../services/crawler/company_site.js";

// Default cap = 12h. Loop processes companies in batches until time runs out
// or there are no more candidates with low confidence / stale enrichment.

const DEFAULT_MAX_MINUTES = 720;
const BATCH_SIZE          = 90;       // empresas buscadas por query
const CONCURRENCY         = 10;       // empresas processadas em paralelo (sites diferentes)
const COMPANY_TIMEOUT_MS  = 25_000;   // teto por empresa — site lento não trava o lote

// One UF per day. Volume-priority ordering — first 7 cover ~75% of all companies.
// Cycle is deterministic by days since 2026-01-01 so the painel can predict.
export const UFS_ROTATION = [
  "SP","MG","RJ","RS","PR","SC","BA",        // top by volume
  "GO","ES","PE","CE","DF","PA","MT",
  "MS","MA","PB","RN","AL","PI","SE",
  "TO","AM","RO","AC","AP","RR",
] as const;
const ROTATION_EPOCH = new Date("2026-01-01T00:00:00Z").getTime();

export function stateOfDay(d: Date = new Date()): string {
  const days = Math.floor((d.getTime() - ROTATION_EPOCH) / 86_400_000);
  const idx = ((days % UFS_ROTATION.length) + UFS_ROTATION.length) % UFS_ROTATION.length;
  return UFS_ROTATION[idx]!;
}

interface Counters {
  companiesProcessed:  number;
  peopleFound:         number;
  jobTitlesIdentified: number;
  linkedinUrlsFound:   number;
  emailsInferred:      number;
  phonesFound:         number;
  recordsSaved:        number;
  errorsCount:         number;
  log:                 string[];
}

function newCounters(): Counters {
  return {
    companiesProcessed:  0,
    peopleFound:         0,
    jobTitlesIdentified: 0,
    linkedinUrlsFound:   0,
    emailsInferred:      0,
    phonesFound:         0,
    recordsSaved:        0,
    errorsCount:         0,
    log:                 [],
  };
}

function pushLog(c: Counters, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  c.log.push(`[${ts}] ${msg}`);
  if (c.log.length > 200) c.log.shift();
}

async function flush(db: any, runId: string, c: Counters) {
  await db.update(enrRuns)
    .set({
      companiesProcessed:  c.companiesProcessed,
      peopleFound:         c.peopleFound,
      jobTitlesIdentified: c.jobTitlesIdentified,
      linkedinUrlsFound:   c.linkedinUrlsFound,
      emailsInferred:      c.emailsInferred,
      phonesFound:         c.phonesFound,
      recordsSaved:        c.recordsSaved,
      errorsCount:         c.errorsCount,
      log:                 c.log.slice(),
    })
    .where(eq(enrRuns.id, runId));
}

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// Roda tarefas async com um pool de concorrência limitada.
async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

// Teto de tempo: se a empresa demorar demais, libera o slot (a promise continua em bg).
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "__timeout__"> {
  return Promise.race([p, new Promise<"__timeout__">((res) => setTimeout(() => res("__timeout__"), ms))]);
}

// Enriquece UMA empresa (resolve domínio, telefones, pessoas/LinkedIn/emails).
async function processCompany(db: any, c: Counters, row: any): Promise<void> {
  const dr = await resolveDomain({ companyId: row.id, cnpjEmail: undefined, knownDomains: [] });

  let phonesCount = 0;
  if (dr?.domain) {
    const phones = await extractPhones({
      entityId: row.id, entityType: "company", domain: dr.domain,
      cnpj: row.cnpj ?? undefined, companyName: row.trade_name ?? row.legal_name, city: row.city ?? undefined,
    });
    phonesCount = phones.length;
    c.phonesFound += phones.length;

    const findings = await scanSite(dr.domain).catch(() => null);
    if (findings) {
      c.linkedinUrlsFound += findings.linkedinUrls.length;
      c.emailsInferred    += findings.emails.length;

      for (const person of findings.people) {
        const fullName = `${person.firstName} ${person.lastName}`.trim();
        if (!fullName) continue;

        const [existing] = await db.select({ id: enrPeople.id }).from(enrPeople)
          .where(and(eq(enrPeople.companyDomain, dr.domain), eq(enrPeople.fullName, fullName)))
          .limit(1);

        if (existing) {
          await db.update(enrPeople)
            .set({ jobTitle: person.jobTitle, cachedAt: new Date() })
            .where(eq(enrPeople.id, existing.id));
        } else {
          await db.insert(enrPeople).values({
            fullName,
            firstName:     person.firstName,
            lastName:      person.lastName,
            jobTitle:      person.jobTitle,
            companyName:   row.trade_name ?? row.legal_name,
            cnpj:          row.cnpj?.replace(/\D/g, "").slice(0, 14) ?? null,
            companyDomain: dr.domain,
            state:         row.state ?? null,
            city:          row.city ?? null,
            source:        "passive-engine",
            rawData:       { sourceUrl: person.sourceUrl, snippet: person.snippet },
            expiresAt:     new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90d
          });
          c.recordsSaved++;
        }

        c.peopleFound++;
        if (person.jobTitle) c.jobTitlesIdentified++;
      }
    }
  }

  // Marca a varredura (confidence_score da disc_companies é da descoberta — não tocar).
  void phonesCount;
  await db.execute(sql`
    UPDATE disc_companies
    SET    last_engine_pass = NOW()
    WHERE  id = ${row.id}
  `);
  c.companiesProcessed++;
}

// Process one batch of companies filtered by UF — em paralelo. Retorna quantas foram consideradas.
async function processBatch(db: any, c: Counters, state: string): Promise<number> {
  const rows: any[] = await db.execute(sql`
    SELECT id, legal_name, trade_name, cnpj, main_cnae AS sector, state, city
    FROM   disc_companies
    WHERE  state = ${state}
       AND last_engine_pass IS NULL
    LIMIT  ${BATCH_SIZE}
  `);

  await runPool(rows, CONCURRENCY, async (row) => {
    const res = await withTimeout(processCompany(db, c, row), COMPANY_TIMEOUT_MS).catch((e: any) => {
      c.errorsCount++;
      pushLog(c, `Erro em ${(row.trade_name ?? row.legal_name ?? row.id).slice(0, 40)}: ${e?.message?.slice(0, 80) ?? "?"}`);
      return undefined;
    });
    if (res === "__timeout__") {
      c.errorsCount++;
      pushLog(c, `Timeout em ${(row.trade_name ?? row.legal_name ?? row.id).slice(0, 40)}`);
    }
  });

  return rows.length;
}

export function startPassiveEngineWorker(): Worker {
  return new Worker<PassiveEngineJob>(
    QUEUES.PASSIVE_ENGINE,
    async (job) => {
      const db = getDb();
      const { runId, triggeredBy, maxDurationMinutes, state } = job.data;
      const capMin    = maxDurationMinutes ?? DEFAULT_MAX_MINUTES;
      const targetUF  = state ?? stateOfDay();
      const deadline  = Date.now() + capMin * 60 * 1000;
      const start     = Date.now();
      const c = newCounters();

      pushLog(c, `Motor iniciado (${triggeredBy}, UF=${targetUF}, cap ${capMin}min)`);
      await flush(db, runId, c);

      try {
        let batches = 0;
        while (Date.now() < deadline) {
          const processed = await processBatch(db, c, targetUF);
          batches++;
          await flush(db, runId, c);

          if (processed === 0) {
            pushLog(c, `Sem mais candidatos em ${targetUF} — encerrando`);
            break;
          }
          if (batches % 5 === 0) {
            pushLog(c, `Progresso ${targetUF}: ${c.companiesProcessed} empresas, ${c.peopleFound} pessoas, ${c.phonesFound} fones, ${c.errorsCount} erros`);
          }
        }

        if (Date.now() >= deadline) {
          pushLog(c, `Tempo máximo (${capMin}min) atingido — encerrando`);
        }

        const duration = Math.floor((Date.now() - start) / 1000);
        pushLog(c, `Concluído: ${c.companiesProcessed} empresas em ${duration}s`);
        await db.update(enrRuns)
          .set({
            status:              "done",
            completedAt:         new Date(),
            durationSeconds:     duration,
            companiesProcessed:  c.companiesProcessed,
            peopleFound:         c.peopleFound,
            jobTitlesIdentified: c.jobTitlesIdentified,
            linkedinUrlsFound:   c.linkedinUrlsFound,
            emailsInferred:      c.emailsInferred,
            phonesFound:         c.phonesFound,
            recordsSaved:        c.recordsSaved,
            errorsCount:         c.errorsCount,
            log:                 c.log,
          })
          .where(eq(enrRuns.id, runId));
      } catch (e: any) {
        const duration = Math.floor((Date.now() - start) / 1000);
        pushLog(c, `Falha fatal: ${e?.message?.slice(0, 200) ?? "?"}`);
        await db.update(enrRuns)
          .set({
            status:              "failed",
            completedAt:         new Date(),
            durationSeconds:     duration,
            companiesProcessed:  c.companiesProcessed,
            recordsSaved:        c.recordsSaved,
            errorsCount:         c.errorsCount,
            log:                 c.log,
          })
          .where(eq(enrRuns.id, runId));
        throw e;
      }
    },
    { connection: createRedis(), concurrency: 1 }
  );
}
