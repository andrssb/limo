/**
 * PDL pilot — mede hit rate de enriquecimento de decisores BR.
 *
 * Uso:
 *   cd <raiz do repo>
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/pdl-piloto.ts
 *
 * Saída:
 *   - scripts/pdl-piloto-results.csv  (linha por query, com campos encontrados)
 *   - scripts/pdl-piloto-sample.json  (amostra completa dos 5 primeiros matches)
 *   - sumário no stdout (hit rate por campo + por setor)
 */

import fs from "node:fs";
import path from "node:path";

const API_KEY = process.env.PEOPLE_DATA_LABS_API_KEY;
if (!API_KEY) {
  console.error("✗ Faltando PEOPLE_DATA_LABS_API_KEY no .env");
  process.exit(1);
}

const BASE_URL = "https://api.peopledatalabs.com/v5";

// ─── Universo de teste: 25 empresas BR × 2 níveis = 50 queries ────────────────

interface Company {
  name: string;
  domain: string;
  sector: string;
  size: "mid" | "large";
}

const COMPANIES: Company[] = [
  // Fintech
  { name: "Nubank",        domain: "nubank.com.br",         sector: "fintech",     size: "large" },
  { name: "Stone",         domain: "stone.com.br",          sector: "fintech",     size: "large" },
  { name: "PagSeguro",     domain: "pagseguro.com.br",      sector: "fintech",     size: "large" },
  { name: "Asaas",         domain: "asaas.com",             sector: "fintech",     size: "mid"   },
  // Ecommerce / marketplace
  { name: "Mercado Livre", domain: "mercadolivre.com.br",   sector: "ecommerce",   size: "large" },
  { name: "iFood",         domain: "ifood.com.br",          sector: "ecommerce",   size: "large" },
  { name: "Olist",         domain: "olist.com",             sector: "ecommerce",   size: "mid"   },
  // SaaS
  { name: "RD Station",    domain: "rdstation.com",         sector: "saas",        size: "mid"   },
  { name: "Hotmart",       domain: "hotmart.com",           sector: "saas",        size: "mid"   },
  { name: "Pipefy",        domain: "pipefy.com",            sector: "saas",        size: "mid"   },
  { name: "Movidesk",      domain: "movidesk.com",          sector: "saas",        size: "mid"   },
  { name: "ContaAzul",     domain: "contaazul.com",         sector: "saas",        size: "mid"   },
  { name: "Totvs",         domain: "totvs.com",             sector: "saas",        size: "large" },
  { name: "Sankhya",       domain: "sankhya.com.br",        sector: "saas",        size: "mid"   },
  { name: "Cobli",         domain: "cobli.co",              sector: "saas",        size: "mid"   },
  // Varejo
  { name: "Magazine Luiza",domain: "magazineluiza.com.br",  sector: "varejo",      size: "large" },
  { name: "Lojas Renner",  domain: "lojasrenner.com.br",    sector: "varejo",      size: "large" },
  { name: "Centauro",      domain: "centauro.com.br",       sector: "varejo",      size: "mid"   },
  // Real estate
  { name: "Loft",          domain: "loft.com.br",           sector: "real_estate", size: "mid"   },
  { name: "QuintoAndar",   domain: "quintoandar.com.br",    sector: "real_estate", size: "mid"   },
  // Indústria
  { name: "Ambev",         domain: "ambev.com.br",          sector: "industria",   size: "large" },
  { name: "JBS",           domain: "jbs.com.br",            sector: "industria",   size: "large" },
  { name: "Embraer",       domain: "embraer.com.br",        sector: "industria",   size: "large" },
  // Saúde
  { name: "Hapvida",       domain: "hapvida.com.br",        sector: "saude",       size: "large" },
  // Hosting
  { name: "Locaweb",       domain: "locaweb.com.br",        sector: "saas",        size: "mid"   },
];

// Dois níveis hierárquicos por empresa: C-level (decisor máximo) e diretor
const TITLE_LEVELS = ["cxo", "director"] as const;

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PdlPerson {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  job_title_role?: string;
  job_company_name?: string;
  job_company_website?: string;
  work_email?: string | null;
  recommended_personal_email?: string | null;
  personal_emails?: string[];
  emails?: Array<{ address: string; type?: string }>;
  mobile_phone?: string | null;
  phone_numbers?: string[];
  phones?: Array<{ number: string; first_seen?: string; last_seen?: string }>;
  linkedin_url?: string | null;
  location_country?: string | null;
  location_name?: string | null;
}

interface PdlSearchResponse {
  status?: number;
  data?: PdlPerson[];
  total?: number;
  error?: { type?: string; message?: string };
}

interface Result {
  company: string;
  domain: string;
  sector: string;
  size: string;
  title_level: string;
  matched: boolean;
  full_name: string;
  job_title: string;
  work_email: string;
  personal_email: string;
  mobile_phone: string;
  linkedin_url: string;
  location: string;
  pdl_total: number;
  http_status: number;
  error: string;
}

// ─── Cliente PDL ──────────────────────────────────────────────────────────────

async function searchPerson(domain: string, level: string): Promise<{ resp: PdlSearchResponse; status: number }> {
  const sql = `SELECT * FROM person WHERE job_company_website='${domain}' AND job_title_levels='${level}' AND location_country='brazil'`;

  // Tenta até 3x com backoff em 429 (rate limit)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${BASE_URL}/person/search`, {
      method: "POST",
      headers: {
        "X-Api-Key":    API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, size: 1, titlecase: true, pretty: false }),
    });

    const status = res.status;
    let resp: PdlSearchResponse = {};
    try {
      resp = (await res.json()) as PdlSearchResponse;
    } catch {
      resp = { error: { message: `HTTP ${status} (não-JSON)` } };
    }

    if (status === 429 && attempt < 3) {
      const backoff = 60_000 * attempt; // 60s, 120s
      process.stdout.write(`(429, aguardando ${backoff / 1000}s) `);
      await wait(backoff);
      continue;
    }

    return { resp, status };
  }
  return { resp: { error: { message: "Max retries esgotadas" } }, status: 429 };
}

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`PDL pilot — ${COMPANIES.length} empresas × ${TITLE_LEVELS.length} níveis = ${COMPANIES.length * TITLE_LEVELS.length} queries`);
  console.log(`API key: ${API_KEY!.slice(0, 4)}...${API_KEY!.slice(-4)} (apenas primeiros/últimos 4 chars)`);
  console.log();

  const results: Result[] = [];
  const sampleHits: PdlPerson[] = [];
  let queryCount = 0;
  let hitCount = 0;

  for (const co of COMPANIES) {
    for (const level of TITLE_LEVELS) {
      queryCount++;
      const tag = `[${queryCount.toString().padStart(2, "0")}/${COMPANIES.length * TITLE_LEVELS.length}] ${co.name} (${level})`;
      process.stdout.write(`${tag.padEnd(50)} `);

      const { resp, status } = await searchPerson(co.domain, level);

      if (status !== 200 || !resp.data) {
        console.log(`✗ HTTP ${status} ${resp.error?.message ?? ""}`);
        results.push({
          company:      co.name,
          domain:       co.domain,
          sector:       co.sector,
          size:         co.size,
          title_level:  level,
          matched:      false,
          full_name:    "",
          job_title:    "",
          work_email:   "",
          personal_email: "",
          mobile_phone: "",
          linkedin_url: "",
          location:     "",
          pdl_total:    0,
          http_status:  status,
          error:        resp.error?.message ?? "",
        });
        await wait(6_000);
        continue;
      }

      const person = resp.data[0];
      const matched = !!person;
      if (matched) hitCount++;
      if (matched && sampleHits.length < 5) sampleHits.push(person);

      results.push({
        company:        co.name,
        domain:         co.domain,
        sector:         co.sector,
        size:           co.size,
        title_level:    level,
        matched,
        full_name:      person?.full_name ?? "",
        job_title:      person?.job_title ?? "",
        work_email:     person?.work_email ?? "",
        personal_email: person?.recommended_personal_email ?? person?.personal_emails?.[0] ?? "",
        mobile_phone:   person?.mobile_phone ?? person?.phone_numbers?.[0] ?? person?.phones?.[0]?.number ?? "",
        linkedin_url:   person?.linkedin_url ?? "",
        location:       person?.location_name ?? "",
        pdl_total:      resp.total ?? 0,
        http_status:    status,
        error:          "",
      });

      console.log(matched ? `✓ ${person.full_name ?? "?"} — ${person.job_title ?? "?"}` : `✗ sem match (total ${resp.total ?? 0})`);
      await wait(6_000); // free tier: max 10 req/min → 1 req/6s
    }
  }

  // ─── Sumário ─────────────────────────────────────────────────────────────
  console.log();
  console.log("═══════════════════════════════════════════════════════════");
  console.log("SUMÁRIO");
  console.log("═══════════════════════════════════════════════════════════");

  const total = results.length;
  const withWorkEmail     = results.filter((r) => r.matched && r.work_email).length;
  const withPersonalEmail = results.filter((r) => r.matched && r.personal_email).length;
  const withMobile        = results.filter((r) => r.matched && r.mobile_phone).length;
  const withLinkedin      = results.filter((r) => r.matched && r.linkedin_url).length;

  console.log(`Persona encontrada (qualquer dado): ${hitCount}/${total} (${pct(hitCount, total)})`);
  console.log(`  ↳ com email corporativo:           ${withWorkEmail}/${total} (${pct(withWorkEmail, total)})`);
  console.log(`  ↳ com email pessoal:               ${withPersonalEmail}/${total} (${pct(withPersonalEmail, total)})`);
  console.log(`  ↳ com celular:                     ${withMobile}/${total} (${pct(withMobile, total)})`);
  console.log(`  ↳ com LinkedIn URL:                ${withLinkedin}/${total} (${pct(withLinkedin, total)})`);
  console.log();

  console.log("─── HIT RATE POR SETOR ──────────────────────────────────");
  const sectors = [...new Set(results.map((r) => r.sector))];
  for (const sector of sectors) {
    const sub        = results.filter((r) => r.sector === sector);
    const subHits    = sub.filter((r) => r.matched).length;
    const subEmail   = sub.filter((r) => r.matched && r.work_email).length;
    const subMobile  = sub.filter((r) => r.matched && r.mobile_phone).length;
    console.log(`  ${sector.padEnd(14)} ${subHits.toString().padStart(2)}/${sub.length} match | ${subEmail.toString().padStart(2)}/${sub.length} email | ${subMobile.toString().padStart(2)}/${sub.length} mobile`);
  }
  console.log();

  console.log("─── HIT RATE POR PORTE ──────────────────────────────────");
  for (const size of ["large", "mid"]) {
    const sub        = results.filter((r) => r.size === size);
    const subHits    = sub.filter((r) => r.matched).length;
    const subMobile  = sub.filter((r) => r.matched && r.mobile_phone).length;
    console.log(`  ${size.padEnd(6)} ${subHits.toString().padStart(2)}/${sub.length} match | ${subMobile.toString().padStart(2)}/${sub.length} mobile`);
  }
  console.log();

  // ─── Saída CSV + JSON sample ─────────────────────────────────────────────
  const csvPath  = path.join(process.cwd(), "scripts/pdl-piloto-results.csv");
  const jsonPath = path.join(process.cwd(), "scripts/pdl-piloto-sample.json");

  fs.writeFileSync(csvPath,  toCSV(results));
  fs.writeFileSync(jsonPath, JSON.stringify(sampleHits, null, 2));

  console.log(`Resultados:  ${csvPath}`);
  console.log(`Amostra:     ${jsonPath}`);
}

function pct(a: number, b: number): string {
  return b === 0 ? "0%" : `${((a / b) * 100).toFixed(1)}%`;
}

function toCSV(results: Result[]): string {
  const headers = [
    "company","domain","sector","size","title_level","matched",
    "full_name","job_title","work_email","personal_email","mobile_phone","linkedin_url","location",
    "pdl_total","http_status","error",
  ];
  const lines = results.map((r) =>
    headers.map((h) => {
      const v = (r as Record<string, unknown>)[h];
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return `"${s}"`;
    }).join(",")
  );
  return [headers.join(","), ...lines].join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
