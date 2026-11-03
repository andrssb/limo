// SERP people-discovery (Serper.dev → Google). Descobre QUEM lidera um setor de
// uma empresa lendo o resultado do LinkedIn no Google: o título de um resultado
// `linkedin.com/in/...` já vem como "Nome - Cargo - Empresa | LinkedIn", então
// extraímos nome+cargo do snippet sem precisar abrir (nem scrapear) o LinkedIn.
//
// Custo: 1 crédito Serper por busca (~US$0,001). É a camada que mais economiza
// no bureau pago — resolve o "passo 1" (líder do setor) de graça/barato.

import { createHash } from "crypto";
import { config } from "../../../config.js";
import { cacheGetJson, cacheSetJson } from "../../../lib/cache.js";

const SERP_CACHE_TTL = 14 * 24 * 3600; // 14 dias — pessoas trocam de cargo

export interface SerpPerson {
  firstName:    string;
  lastName:     string;
  jobTitle:     string;
  linkedinUrl?: string;
  snippet:      string;
}

const SERPER_URL = "https://google.serper.dev/search";

// Tokens genéricos de razão social — NÃO servem pra confirmar que o resultado é
// da empresa certa (senão "Hospital X" casa com qualquer hospital). A confirmação
// exige bater um token DISTINTIVO (ex.: "Mater", "Localiza").
const GENERIC_COMPANY_TOKENS = new Set([
  "hospital", "grupo", "clinica", "clínica", "ltda", "eireli", "mei", "epp",
  "empresa", "empresas", "comercio", "comércio", "industria", "indústria",
  "servicos", "serviços", "rede", "centro", "instituto", "associacao", "associação",
  "cooperativa", "distribuidora", "transportes", "transportadora", "construtora",
  "tecnologia", "sistemas", "solucoes", "soluções", "consultoria", "assessoria",
  "brasil", "nacional", "comercial", "ltd", "company", "corp", "holding",
  "participacoes", "participações", "agro", "agropecuaria", "agropecuária",
]);

// Tokens distintivos da razão social (sem genéricos e sem palavras curtas).
function distinctiveTokens(companyName: string): string[] {
  return companyName
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3 && !GENERIC_COMPANY_TOKENS.has(t));
}

export function serperConfigured(): boolean {
  return Boolean(config.SERPER_API_KEY);
}

// Low-level: roda uma busca no Google via Serper. Retorna os orgânicos, ou
// `null` em erro (pra NÃO cachear falha como "vazio" e permitir retry).
async function serper(q: string, num = 10): Promise<any[] | null> {
  if (!config.SERPER_API_KEY) return null;
  try {
    const res = await fetch(SERPER_URL, {
      method: "POST",
      headers: {
        "X-API-KEY":    config.SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q, gl: "br", hl: "pt", num }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return Array.isArray(data?.organic) ? data.organic : [];
  } catch {
    return null;
  }
}

// Parseia UM resultado orgânico do LinkedIn (`/in/`) em pessoa {nome, cargo}.
// Formato típico do título: "Fulano de Tal - Diretor Financeiro - Empresa | LinkedIn".
function parseLinkedInResult(r: any, companyName: string): SerpPerson | null {
  const link = String(r?.link ?? "");
  if (!/linkedin\.com\/in\//i.test(link)) return null;

  let title = String(r?.title ?? "").trim();
  // Tira o sufixo "... | LinkedIn" / "... - LinkedIn".
  title = title.replace(/\s*[-–|]\s*LinkedIn\s*$/i, "").trim();

  // LinkedIn separa nome/cargo/empresa por hífen ou en-dash.
  const parts = title.split(/\s+[–-]\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const name = parts[0]!;
  const role = parts[1]!;
  const nameTokens = name.split(/\s+/).filter(Boolean);
  // Nome plausível: 2+ palavras, só letras (evita "Perfis", "Veja", etc.).
  if (nameTokens.length < 2) return null;
  if (!/^[A-Za-zÀ-ÿ'.\- ]+$/.test(name)) return null;

  // Anti-falso-positivo: o resultado tem que mencionar um token DISTINTIVO da
  // empresa (título+snippet) — não basta um genérico ("hospital"), senão entra
  // gente de cargo igual em OUTRA empresa. Sem token distintivo, exige o 1º token.
  const snippet = String(r?.snippet ?? "");
  const hay = `${title} ${snippet}`.toLowerCase();
  const distinctive = distinctiveTokens(companyName);
  const compMatch = distinctive.length
    ? distinctive.some((t) => hay.includes(t))
    : hay.includes(companyName.toLowerCase().split(/\s+/)[0] ?? "");
  if (!compMatch) return null;

  const [firstName = "", ...rest] = nameTokens;
  return {
    firstName,
    lastName:    rest.join(" "),
    jobTitle:    role,
    linkedinUrl: link.split("?")[0],
    snippet:     snippet || title,
  };
}

// Descobre líderes de um setor de uma empresa via SERP. `roleTerms` são as
// variações do cargo-alvo (saída do expandRoles). Retorna pessoas reais
// (do índice do Google sobre o LinkedIn), deduplicadas por nome.
export async function findLeadersViaSerp(
  companyName: string,
  roleTerms: string[],
  _city?: string,
): Promise<SerpPerson[]> {
  if (!config.SERPER_API_KEY || !companyName) return [];

  const roles = roleTerms.slice(0, 6).map((r) => `"${r}"`).join(" OR ");
  const q = `"${companyName}" (${roles}) site:linkedin.com/in`;

  // Cache (Redis): re-crawl da mesma empresa/cargo não re-gasta crédito Serper.
  const cacheKey = `serp:${createHash("sha1").update(q).digest("hex").slice(0, 32)}`;
  const cached = await cacheGetJson<SerpPerson[]>(cacheKey);
  if (cached) return cached;

  const organic = await serper(q, 10);
  if (organic === null) return []; // erro de API → não cacheia (permite retry)
  const out: SerpPerson[] = [];
  const seen = new Set<string>();

  for (const r of organic) {
    const p = parseLinkedInResult(r, companyName);
    if (!p) continue;
    const key = `${p.firstName} ${p.lastName}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  // Cacheia mesmo vazio (empresa sem gente no LinkedIn é resultado válido).
  await cacheSetJson(cacheKey, out, SERP_CACHE_TTL);
  return out;
}

// TTL da company page: muda pouco (empresa não troca de página), cache longo.
const COMPANY_PAGE_TTL = 30 * 24 * 3600; // 30 dias

// Descobre a COMPANY PAGE da empresa no LinkedIn (linkedin.com/company/...).
// Lê o índice do Google via Serper e confirma pela razão social (token distintivo)
// pra não casar com a página de outra empresa homônima. Retorna a URL canônica
// (sem querystring) ou null. 1 crédito Serper, cacheado 30d.
export async function findCompanyLinkedin(
  companyName: string,
  tradeName?: string,
): Promise<string | null> {
  if (!config.SERPER_API_KEY || !companyName) return null;

  const nameForQuery = (tradeName && tradeName.trim()) || companyName;
  const q = `"${nameForQuery}" site:linkedin.com/company`;

  const cacheKey = `serp:company:${createHash("sha1").update(q).digest("hex").slice(0, 32)}`;
  const cached = await cacheGetJson<{ url: string | null }>(cacheKey);
  if (cached) return cached.url;

  const organic = await serper(q, 10);
  if (organic === null) return null; // erro de API → não cacheia (permite retry)

  // Tokens distintivos da razão social E do nome fantasia (o que confirma a empresa).
  const distinctive = [
    ...new Set([...distinctiveTokens(companyName), ...distinctiveTokens(tradeName ?? "")]),
  ];

  let found: string | null = null;
  for (const r of organic) {
    const link = String(r?.link ?? "");
    const m = link.match(/https?:\/\/[a-z]{0,3}\.?linkedin\.com\/company\/[^/?#]+/i);
    if (!m) continue;
    const hay = `${String(r?.title ?? "")} ${String(r?.snippet ?? "")}`.toLowerCase();
    // Confirma pela razão social: exige token distintivo; sem distintivos, cai no 1º token.
    const compMatch = distinctive.length
      ? distinctive.some((t) => hay.includes(t))
      : hay.includes(nameForQuery.toLowerCase().split(/\s+/)[0] ?? "");
    if (!compMatch) continue;
    found = m[0].replace(/\/$/, "");
    break;
  }

  await cacheSetJson(cacheKey, { url: found }, COMPANY_PAGE_TTL);
  return found;
}
