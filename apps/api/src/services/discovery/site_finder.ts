// Fonte EXTRA do Descobrir: acha o site oficial da empresa PELO NOME (a base RF
// não tem domínio). Sem isso o Descobrir devolve só CNPJ/telefone fixo da RF —
// qualidade péssima. Aqui resolvemos o domínio e é isso que qualifica a lista:
// empresa com site é de onde o crawler tira celular/WhatsApp + e-mail verificado.
//
// Cascata de fontes (barato→caro, melhor sinal primeiro quando configurado):
//   1. Google Places (Google Maps) — devolve o campo `website` do negócio real.
//      Melhor sinal de "existe e tem site", mas precisa de GOOGLE_PLACES_API_KEY.
//   2. Serper (busca no Google) — 1º orgânico não-social. Já pago, ~US$0,001.
// Confirma que o domínio está VIVO (DNS) antes de aceitar. Cache por CNPJ.

import { promises as dns } from "dns";
import { createHash } from "crypto";
import { config } from "../../config.js";
import { cacheGetJson, cacheSetJson } from "../../lib/cache.js";
import { findDomainViaGooglePlaces } from "../enrichment/engine/web_search_enricher.js";

const TTL = 60 * 24 * 3600; // 60 dias — empresa não troca de site toda hora

// Domínios que NÃO são o site oficial (redes sociais, marketplaces, diretórios,
// agregadores de CNPJ). Se o resultado cai num desses, não conta como "tem site".
const NON_OFFICIAL = new Set([
  "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com",
  "youtube.com", "tiktok.com", "wa.me", "whatsapp.com", "google.com",
  "mercadolivre.com.br", "olx.com.br", "reclameaqui.com.br", "wikipedia.org",
  "guiamais.com.br", "apontador.com.br", "econodata.com.br", "cnpj.biz",
  "cnpja.com", "consultacnpj.com", "empresascnpj.com", "solutudo.com.br",
  "telelistas.net", "encontraempresa.com.br", "informecadastral.com.br",
]);

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch { return null; }
}

function isOfficialDomain(domain: string): boolean {
  if (!domain || !domain.includes(".")) return false;
  if (NON_OFFICIAL.has(domain)) return false;
  // registro.br de órgão público / genéricos que não são empresa
  if (domain.endsWith(".gov.br") || domain.endsWith(".jus.br")) return false;
  return true;
}

// DNS não tem timeout nativo — um resolvedor pendurado seguraria o Descobrir.
// Corta em `ms` e trata como "não resolveu".
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);
}

// Domínio "vivo": tem MX (e-mail) OU registro A. Barra domínio parkeado/inexistente.
async function domainIsLive(domain: string): Promise<boolean> {
  const mx = await withTimeout(dns.resolveMx(domain).catch(() => []), 4000, []);
  if (mx.length > 0) return true;
  const a = await withTimeout(dns.resolve4(domain).catch(() => []), 4000, []);
  return a.length > 0;
}

// Serper: "<nome fantasia>" <cidade> site oficial, tirando redes sociais.
async function findViaSerper(companyName: string, city?: string): Promise<string | null> {
  if (!config.SERPER_API_KEY) return null;
  try {
    const q = `"${companyName}"${city ? ` ${city}` : ""} site oficial -linkedin -facebook -instagram`;
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": config.SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q, gl: "br", hl: "pt", num: 5 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const organic: any[] = Array.isArray(data?.organic) ? data.organic : [];
    for (const r of organic) {
      const d = extractDomain(String(r?.link ?? ""));
      if (d && isOfficialDomain(d)) return d;
    }
    return null;
  } catch { return null; }
}

export interface SiteResult {
  domain:  string;
  website: string;
  source:  "google_places" | "serper";
}

// Acha o site oficial pelo nome. Devolve null quando a empresa não tem site
// (ou não deu pra confirmar) — é o que faz ela ser descartada do Descobrir.
export async function findOfficialSite(
  companyName: string,
  opts: { city?: string | null; state?: string | null; cnpj?: string | null } = {},
): Promise<SiteResult | null> {
  const name = (companyName || "").trim();
  if (!name) return null;

  // Cache por CNPJ (estável); sem CNPJ, cai no hash do nome. Guarda { v } pra
  // distinguir "não cacheado" de "cacheado como sem-site" (null).
  const keySeed = opts.cnpj ? `cnpj:${opts.cnpj.replace(/\D/g, "")}` : `name:${name.toLowerCase()}`;
  const cacheKey = `site:${createHash("sha1").update(keySeed).digest("hex").slice(0, 32)}`;
  const cached = await cacheGetJson<{ v: SiteResult | null }>(cacheKey);
  if (cached) return cached.v;

  const city = opts.city ?? undefined;

  // 1) Google Places (melhor sinal; só quando há chave)
  let domain = await findDomainViaGooglePlaces(name, city).catch(() => null);
  let source: SiteResult["source"] = "google_places";

  // 2) Serper (fallback / fonte atual)
  if (!domain || !isOfficialDomain(domain)) {
    domain = await findViaSerper(name, city);
    source = "serper";
  }

  let result: SiteResult | null = null;
  if (domain && isOfficialDomain(domain) && (await domainIsLive(domain))) {
    result = { domain, website: `https://${domain}`, source };
  }

  await cacheSetJson(cacheKey, { v: result }, TTL);
  return result;
}
