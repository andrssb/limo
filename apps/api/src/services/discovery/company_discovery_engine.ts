import { getDb } from "@limo/db";
import { sql } from "drizzle-orm";
import { getCnaesForSector, selectTopCnaes } from "./sector_cnae_mapper.js";
import { enrichEmployeeCount } from "./employee_count_enricher.js";
import { enrichRevenue }       from "./revenue_enricher.js";
import { canonicalDomain, cnpjDigits } from "../enrichment/engine/company_resolver.js";
import { config } from "../../config.js";
import { findOfficialSite } from "./site_finder.js";

// Resolve a company domain to a Receita Federal CNPJ (digits-only) by looking it
// up in disc_company_domains. Used to tie LinkedIn-scraped people to RF companies.
export async function resolveCnpjByDomain(domain?: string | null): Promise<string | null> {
  const d = canonicalDomain(domain);
  if (!d) return null;
  const db = getDb();
  try {
    const rows: any[] = await db.execute(sql`
      SELECT c.cnpj
      FROM disc_company_domains dd
      JOIN disc_companies c ON c.id = dd.company_id
      WHERE lower(dd.domain) = ${d}
      ORDER BY dd.confidence DESC
      LIMIT 1
    `);
    return cnpjDigits(rows[0]?.cnpj ?? null);
  } catch {
    return null;
  }
}

// ─── Output type ──────────────────────────────────────────────────────────────

export interface DiscoveredCompany {
  id?:     string;
  cnpj:    string | null;
  legal_name: string;
  trade_name: string | null;
  state:   string | null;
  city:    string | null;

  // RF-sourced fields (null for AI-generated results)
  sector:       string | null;
  domain:       string | null;   // just hostname, e.g. "empresa.com.br"
  opening_date: string | null;   // ISO date "YYYY-MM-DD"
  public_phone: string | null;   // RF cadastral phone "(DDD) NUMBER"
  public_email: string | null;   // RF cadastral email

  website:      string | null;
  website_type: string;   // 'confirmed' | 'estimated' | 'unavailable'

  employee_count:       number | null;
  employee_count_range: string | null;
  employee_count_type:  string;
  employee_confidence:  number;

  revenue:              number | null;
  revenue_range:        string | null;
  revenue_type:         string;
  revenue_confidence:   number;

  confidence: {
    cnpj:           number;
    state:          number;
    city:           number;
    website:        number;
    employee_count: number;
    revenue:        number;
  };

  sources: {
    cnpj:           string;
    state:          string;
    city:           string;
    website:        string;
    employee_count: string;
    revenue:        string;
  };

  last_verified_at: string;
}

// ─── Employee range → RF porte sizes ─────────────────────────────────────────
// Maps the UI employeeRange filter to the RF company_size values stored in the DB.
// A base RF classifica porte por FATURAMENTO: MEI/ME (micro), EPP (pequena) e
// DEMAIS (média + grande num bucket só). Não existe MEDIO/GRANDE nos dados — por
// isso o filtro 51+ retornava ZERO. Para 51+ usamos DEMAIS e refinamos por capital
// social (enrichEmployeeCount.capitalToRange) + no pós-filtro abaixo. Mantemos
// MEDIO/GRANDE nos arrays por compatibilidade caso a base passe a tê-los.
function employeeRangeToSizes(range: string): string[] {
  const map: Record<string, string[]> = {
    "1-10":     ["MEI", "ME"],
    "11-50":    ["EPP"],
    "51-100":   ["DEMAIS", "MEDIO"],
    "101-200":  ["DEMAIS", "MEDIO"],
    "201-500":  ["DEMAIS", "GRANDE"],
    "501-1000": ["DEMAIS", "GRANDE"],
    "1000+":    ["DEMAIS", "GRANDE"],
  };
  return map[range] ?? [];
}

// ─── Source from local CNPJ DB ────────────────────────────────────────────────

async function searchLocalBase(params: {
  cnaes:         string[];
  state?:        string;
  companySizes?: string[];
  limit:         number;
}): Promise<DiscoveredCompany[]> {
  const db = getDb();

  try {
    // Cheap "is the RF base populated?" probe. A COUNT(*) here is a full-table
    // scan over ~14.5M rows (~minutes) and was timing out → catch → empty.
    const probe: any[] = await db.execute(sql`SELECT 1 FROM disc_companies LIMIT 1`);
    if (probe.length === 0) return [];

    const rows: any[] = await db.execute(sql`
      SELECT id, cnpj, legal_name, trade_name, state, city,
             company_size, capital_social, main_cnae,
             sector, opening_date, public_phone, public_email,
             top_domain, top_website_url, secondary_cnaes
      FROM companies_search
      WHERE registration_status = 'ATIVA'
        AND left(main_cnae, 4) = ANY(ARRAY[${sql.join(params.cnaes.map((c) => sql`${c}`), sql`, `)}]::text[])
        ${params.state ? sql`AND state = ${params.state}` : sql``}
        ${params.companySizes && params.companySizes.length > 0
          ? sql`AND company_size = ANY(ARRAY[${sql.join(params.companySizes.map((s) => sql`${s}`), sql`, `)}]::text[])`
          : sql``}
      ORDER BY company_size DESC NULLS LAST
      LIMIT ${params.limit}
    `);

    return rows.map((r) => buildFromLocalRow(r));
  } catch (e) {
    // Don't swallow silently — a broken query here was masked for ages by the
    // old AI fallback (the `${array}::text[]` binding cast a record, throwing).
    console.error("[discovery] searchLocalBase failed:", (e as Error).message);
    return [];
  }
}

function buildFromLocalRow(r: any): DiscoveredCompany {
  const employees = enrichEmployeeCount({ companySize: r.company_size, capitalSocial: r.capital_social });
  const revenue   = enrichRevenue({ companySize: r.company_size, employeeRange: employees.employee_count_range, capitalSocial: r.capital_social });

  const topDomain = r.top_domain ?? null;

  return {
    id:         r.id,
    cnpj:       r.cnpj ?? null,
    legal_name: r.legal_name,
    trade_name: r.trade_name ?? null,
    state:      r.state ?? null,
    city:       r.city  ?? null,

    sector:       r.sector       ?? null,
    domain:       topDomain,
    opening_date: r.opening_date ? String(r.opening_date).slice(0, 10) : null,
    public_phone: r.public_phone ?? null,
    public_email: r.public_email ?? null,

    website:      r.top_website_url ?? null,
    website_type: topDomain ? "confirmed" : "unavailable",

    ...employees,
    ...revenue,

    confidence: {
      cnpj:           r.cnpj ? 98 : 0,
      state:          r.state ? 98 : 0,
      city:           r.city  ? 98 : 0,
      website:        topDomain ? 80 : 0,
      employee_count: employees.employee_confidence,
      revenue:        revenue.revenue_confidence,
    },

    sources: {
      cnpj:           "Receita Federal",
      state:          "Receita Federal",
      city:           "Receita Federal",
      website:        topDomain ? "disc_company_domains" : "não disponível",
      employee_count: employees.source_type,
      revenue:        revenue.source_type,
    },

    last_verified_at: new Date().toISOString().split("T")[0]!,
  };
}

// ─── Main orchestrator ────────────────────────────────────────────────────────
// Descobrir uses ONLY the Receita Federal / Brasil.io base (disc_companies). No
// AI invention of companies. Returns [] honestly when nothing matches — e.g.
// when the sector has no CNAE mapping or the RF base is empty in this DB.

export async function discoverCompanies(params: {
  sector:        string;
  state?:        string;
  employeeRange?: string;
  limit?:        number;
  siteBudget?:   number;
}): Promise<DiscoveredCompany[]> {
  // Sem o teto antigo de 1.000. Com o filtro "só com site" o resultado já vem
  // enxuto/qualificado, então liberamos até um guardrail alto (evita runaway de
  // memória/payload numa base de ~14,5M). Default sobe pra 1.000.
  const limit    = Math.min(params.limit ?? 1000, 25000);
  const cnaes    = await getCnaesForSector(params.sector);
  const topCnaes = selectTopCnaes(cnaes, 4, 4);
  if (topCnaes.length === 0) return [];

  // Orçamento de resolução de site = quantas empresas TENTAR por execução (teto de
  // custo/latência). Só as que TÊM site voltam, então não adianta puxar mais que o
  // orçamento da RF (buffer 2x cobre a atrito do filtro fino de porte).
  const budget    = params.siteBudget ?? config.DISCOVERY_SITE_BUDGET;
  const fetchN    = Math.min(limit, Math.max(budget * 2, budget));

  const companySizes = params.employeeRange ? employeeRangeToSizes(params.employeeRange) : [];
  const local = await searchLocalBase({ cnaes: topCnaes, state: params.state, companySizes, limit: fetchN });
  const ranged = filterByEmployeeRange(local, params.employeeRange);

  // Fonte extra: resolve o site PELO NOME e mantém só quem tem (qualifica a lista;
  // a RF sozinha rende só fixo).
  const qualified = await qualifyBySite(ranged, budget);
  return qualified.slice(0, limit);
}

// Roda a resolução de site em N empresas (as primeiras, já ordenadas por porte),
// com concorrência limitada, e devolve SÓ as que têm site — com domain/website
// preenchidos pela fonte web. Empresas sem site somem do resultado do Descobrir.
async function qualifyBySite(
  companies: DiscoveredCompany[],
  budget: number,
  concurrency = 12,
): Promise<DiscoveredCompany[]> {
  const toTry = companies.slice(0, Math.max(0, budget));
  const resolved = await mapLimit(toTry, concurrency, async (c): Promise<DiscoveredCompany | null> => {
    const name = (c.trade_name && c.trade_name.trim()) || c.legal_name;
    const site = await findOfficialSite(name, { city: c.city, state: c.state, cnpj: c.cnpj }).catch(() => null);
    if (!site) return null; // sem site → descartada
    const isPlaces = site.source === "google_places";
    return {
      ...c,
      domain:       site.domain,
      website:      site.website,
      website_type: "confirmed",
      confidence:   { ...c.confidence, website: isPlaces ? 90 : 75 },
      sources:      { ...c.sources, website: isPlaces ? "Google Maps" : "busca web" },
    };
  });
  return resolved.filter((c): c is DiscoveredCompany => c !== null);
}

// Pool de concorrência simples (sem dependência externa). Mantém no máximo
// `limit` promessas em voo; preserva a ordem dos resultados.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

// DEMAIS (média+grande) é estimado por capital social, que é um proxy GROSSEIRO.
// Para 51+ tratamos a faixa escolhida como "porte MÍNIMO" e aceitamos tudo dela
// pra cima — assim uma empresa grande não é derrubada por cair numa faixa acima
// da escolhida (evita falso negativo). Abaixo de 50, mantemos a faixa exata.
const COMPATIBLE_RANGES: Record<string, Set<string>> = {
  "1-10":    new Set(["1-10"]),
  "11-50":   new Set(["11-50"]),
  "51-100":  new Set(["51-100", "101-200", "201-500", "501-1000", "1000+"]),
  "101-200": new Set(["101-200", "201-500", "501-1000", "1000+"]),
  "201-500": new Set(["201-500", "501-1000", "1000+"]),
  "501-1000":new Set(["501-1000", "1000+"]),
  "1000+":   new Set(["1000+"]),
};

function filterByEmployeeRange(companies: DiscoveredCompany[], range?: string): DiscoveredCompany[] {
  if (!range) return companies;
  const accepted = COMPATIBLE_RANGES[range];
  if (!accepted) return companies;
  // If employee_count_range is null (data not available), keep the company — it
  // already passed the SQL company_size filter so it belongs to the right band.
  return companies.filter((c) => !c.employee_count_range || accepted.has(c.employee_count_range));
}
