import { groq, MODELS } from "../lib/groq.js";
import { config } from "../config.js";

// ── Tech detection ──────────────────────────────────────────────────────────

export const TECH_PATTERNS: Record<string, RegExp> = {
  "Google Analytics": /google-analytics\.com|gtag\(/i,
  "HubSpot":          /hubspot\.com|_hsq\./i,
  "Salesforce":       /salesforce\.com|pardot\.com/i,
  "RD Station":       /rdstation\.com\.br/i,
  "ActiveCampaign":   /activecampaign\.com/i,
  "WordPress":        /wp-content|wp-includes/i,
  "Shopify":          /shopify\.com|cdn\.shopify/i,
  "VTEX":             /vtex\.com|vtexcommercestable/i,
  "Hotjar":           /hotjar\.com/i,
  "Meta Pixel":       /facebook\.net\/tr|fbevents\.js/i,
  "LinkedIn Insight": /snap\.licdn\.com/i,
  "Google Ads":       /googleadservices\.com|google_conversion/i,
  "Zendesk":          /zendesk\.com/i,
  "Intercom":         /intercom\.io/i,
  "AWS":              /amazonaws\.com/i,
  "Stripe":           /stripe\.com\/v3/i,
};

export async function detectTechs(domain: string): Promise<string[]> {
  try {
    const res = await fetch(`https://${domain}`, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LimoBot/1.0)" },
    });
    const html = await res.text();
    return Object.entries(TECH_PATTERNS).filter(([, rx]) => rx.test(html)).map(([n]) => n);
  } catch { return []; }
}

export async function scrapeContacts(domain: string): Promise<{ email?: string; phone?: string }> {
  try {
    const res = await fetch(`https://${domain}`, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LimoBot/1.0)" },
    });
    const html = await res.text();
    const email = html.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
    const phone = html.match(/\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4}/)?.[0];
    return { email, phone };
  } catch { return {}; }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function portePtBR(porte: string): string {
  const map: Record<string, string> = {
    "MEI": "MEI", "MICRO EMPRESA": "ME",
    "EMPRESA DE PEQUENO PORTE": "EPP", "DEMAIS": "Média",
  };
  return map[porte?.toUpperCase()] ?? porte ?? "";
}

function formatPhone(ddd: string, tel: string): string {
  if (!ddd || !tel) return "";
  return `(${ddd}) ${tel}`;
}

export function extractDomainFromEmail(email: string): string {
  if (!email) return "";
  const d = email.split("@")[1];
  if (!d) return "";
  const free = ["gmail.com", "hotmail.com", "yahoo.com", "outlook.com", "bol.com.br", "uol.com.br", "terra.com.br"];
  return free.some((f) => d.includes(f)) ? "" : d;
}

// ── Casa dos Dados — Receita Federal data ───────────────────────────────────
// Free public API, no key required. Returns real active Brazilian companies.

const CASA_DADOS_HEADERS = {
  "Content-Type":  "application/json",
  "User-Agent":    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":        "application/json, text/plain, */*",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "Origin":        "https://casadosdados.com.br",
  "Referer":       "https://casadosdados.com.br/solucao/cnpj",
};

export async function searchCasaDados(params: {
  cnae?: string;
  sector?: string;
  uf?: string;
  municipio?: string;
  page?: number;
  porte?: string[];
}): Promise<any[]> {
  try {
    const body: any = {
      query: { situacao_cadastral: "ATIVA" },
      extras: { excluir_mei: false, somente_matriz: true },
      page: params.page ?? 1,
    };

    if (params.cnae) {
      const code = params.cnae.replace(/[.\-\/]/g, "");
      body.query.atividade_principal = [{ code, text: params.sector ?? "" }];
    }
    if (params.uf) body.query.estado = [params.uf.toUpperCase()];
    if (params.municipio) body.query.municipio = [params.municipio.toUpperCase()];
    if (params.porte?.length) body.query.porte = params.porte;

    const res = await fetch("https://api.casadosdados.com.br/v2/public/cnpj/search", {
      method: "POST",
      headers: CASA_DADOS_HEADERS,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return [];
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return []; // Cloudflare challenge page
    const data = await res.json() as any;
    const raw: any[] = data.data?.cnpj ?? [];

    return raw.map((c) => ({
      name:        c.razao_social ?? "",
      tradeName:   c.nome_fantasia || c.razao_social || "",
      cnpj:        c.cnpj ?? "",
      cnaeDesc:    c.cnae_fiscal_descricao ?? "",
      city:        c.municipio ?? "",
      state:       c.uf ?? "",
      size:        portePtBR(c.porte ?? ""),
      email:       c.email ?? "",
      phone:       formatPhone(c.ddd_telefone_1, c.telefone_1),
      domain:      extractDomainFromEmail(c.email ?? ""),
      description: c.cnae_fiscal_descricao ?? "",
      source:      "receita_federal" as const,
    }));
  } catch {
    return [];
  }
}

// ── BrasilAPI — CNPJ enrichment ─────────────────────────────────────────────

export async function enrichCnpj(cnpj: string): Promise<any> {
  try {
    const clean = cnpj.replace(/\D/g, "");
    const res = await fetch(`https://publica.cnpj.ws/cnpj/${clean}`, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ── AI company search ────────────────────────────────────────────────────────
// In-process cache to avoid repeated Groq calls for the same search within
// the same server lifecycle (TTL: 1h).

const aiCache = new Map<string, { data: any[]; expiresAt: number }>();

export async function searchCompaniesAI(filters: string, count = 40, seed = 0): Promise<any[]> {
  const cacheKey = `${filters}|${count}|${seed}`;
  const cached = aiCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const stateHint = filters.includes("estado:") ? "" : " Inclua empresas de vários estados brasileiros.";
  const prompt = `Você é um especialista em prospecção B2B no Brasil.

Liste ${count} empresas brasileiras REAIS e conhecidas que correspondam a: ${filters || "empresas brasileiras B2B de médio porte"}.${stateHint}

Regras:
- Somente empresas que realmente existem
- Varie porte: inclua pequenas, médias e grandes
- Varie cidade/estado quando não especificado
- "size" deve ser: "Pequena", "Média" ou "Grande"

Responda APENAS em JSON:
{"companies":[{"name":"string","city":"string","state":"UF","size":"Pequena|Média|Grande"}]}`;

  try {
    const msg = await groq.chat.completions.create({
      model:           MODELS.fast,
      max_tokens:      3000,
      messages:        [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(msg.choices[0]?.message?.content ?? "{}");
    const data = (parsed.companies ?? []).map((c: any) => ({ ...c, source: "ai" }));
    aiCache.set(cacheKey, { data, expiresAt: Date.now() + 60 * 60 * 1000 });
    return data;
  } catch { return []; }
}
