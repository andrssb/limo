import { createHash } from "crypto";
import { config } from "../../../config.js";
import { cacheGetJson, cacheSetJson } from "../../../lib/cache.js";
import { scorePhone, classifyPhoneKind } from "./confidence_scorer.js";
import { recordSources } from "./source_auditor.js";
import type { PhoneSourceType, PhoneKind } from "./confidence_scorer.js";

// Celular BR = 11 dígitos locais (DDD + 9 + 8 dígitos). Fixo = 10. Usado pra
// priorizar celular/WhatsApp na frente do fixo (resolve "só fixo").
function isMobilePhone(phone: string): boolean {
  const d = phone.replace(/\D/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  return local.length === 11;
}

// ─── Brazilian phone normalisation ────────────────────────────────────────────

const RAW_PHONE_RE = /(?:\+?55[\s\-.]?)?(?:\(?\d{2}\)?\s*(?:9\s?)?\d{4}[\s\-.]?\d{4})/g;
const WA_LINK_RE   = /(?:wa\.me|api\.whatsapp\.com\/send\?phone=|whatsapp\.com\/send\?phone=|wa\.link\/)[\s"']?(\+?[\d\s\-]+)/gi;

export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return null;
  // Prefix with country code if missing
  const withCC = digits.startsWith("55") ? digits : `55${digits}`;
  return `+${withCC}`;
}

function extractRawPhones(html: string): string[] {
  return [...new Set((html.match(RAW_PHONE_RE) ?? []).map((p) => normalisePhone(p)).filter(Boolean) as string[])];
}

function extractWhatsAppLinks(html: string): string[] {
  const found: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(WA_LINK_RE.source, "gi");
  while ((m = re.exec(html)) !== null) {
    const phone = normalisePhone(m[1] ?? "");
    if (phone) found.push(phone);
  }
  return [...new Set(found)];
}

// ─── Source 1 + 2 + 3: Official site via HTTP fetch ──────────────────────────
// Fetches homepage + contact pages with a real UA and extracts phones + WhatsApp
// links from plain HTML. Works without Chromium/Playwright.

export interface PhoneResult {
  phone:           string;
  sourceType:      PhoneSourceType;
  sourcePriority:  number;
  sourceUrl:       string;
  confidenceScore: number;
  isWhatsApp:      boolean;
  kind:            PhoneKind;
}

const FETCH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": FETCH_UA,
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text;
  } catch { return null; }
}

const SCRAPFLY_HTML_TTL = 14 * 24 * 3600; // 14d — não re-gasta crédito

// Render via Scrapfly (JS + proxy BR + anti-bot ASP). Retorna HTML CRU (preserva
// o href do WhatsApp, que o texto limpo perderia). Cacheado 14d. Só na cascata,
// quando o fetch cru não achou telefone (site SPA Wix/React renderizado por JS).
async function fetchHtmlScrapfly(url: string): Promise<string | null> {
  if (!config.SCRAPFLY_API_KEY) return null;
  const cacheKey = `scrapfly:phone:${createHash("sha1").update(url).digest("hex").slice(0, 32)}`;
  const cached = await cacheGetJson<string>(cacheKey);
  if (cached != null) return cached || null;
  try {
    const api =
      `https://api.scrapfly.io/scrape?key=${config.SCRAPFLY_API_KEY}` +
      `&url=${encodeURIComponent(url)}&render_js=true&country=br&asp=true`;
    const res = await fetch(api, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return null;
    const j: any = await res.json();
    const html = typeof j?.result?.content === "string" ? j.result.content : "";
    await cacheSetJson(cacheKey, html, SCRAPFLY_HTML_TTL);
    return html || null;
  } catch { return null; }
}

export async function extractFromSite(domain: string): Promise<PhoneResult[]> {
  const results: PhoneResult[] = [];

  const urlsToVisit = [
    { url: `https://${domain}`,               label: "homepage" as const },
    { url: `https://${domain}/contato`,        label: "contato"  as const },
    { url: `https://${domain}/contact`,        label: "contato"  as const },
    { url: `https://${domain}/fale-conosco`,   label: "contato"  as const },
    { url: `https://www.${domain}`,            label: "homepage" as const },
    { url: `https://www.${domain}/contato`,    label: "contato"  as const },
  ];

  for (const { url, label } of urlsToVisit) {
    if (results.length >= 6) break;

    const html = await fetchHtml(url);
    if (!html) continue;

    for (const phone of extractWhatsAppLinks(html)) {
      if (!results.find((r) => r.phone === phone)) {
        results.push({
          phone,
          sourceType:      "whatsapp_link",
          sourcePriority:  2,
          sourceUrl:       url,
          confidenceScore: scorePhone({ sourceType: "whatsapp_link", isNormalized: true }),
          isWhatsApp:      true,
          kind:            classifyPhoneKind({ sourceType: "whatsapp_link", isWhatsApp: true }),
        });
      }
    }

    const sourceType: PhoneSourceType = label === "homepage" ? "site_oficial" : "contato_rodape";
    const priority = label === "homepage" ? 1 : 3;

    for (const phone of extractRawPhones(html)) {
      if (!results.find((r) => r.phone === phone)) {
        results.push({
          phone,
          sourceType,
          sourcePriority:  priority,
          sourceUrl:       url,
          confidenceScore: scorePhone({ sourceType, isNormalized: true }),
          isWhatsApp:      false,
          kind:            classifyPhoneKind({ sourceType, isWhatsApp: false }),
        });
      }
    }
  }

  // Cascata: fetch cru não achou telefone (site SPA renderizado por JS) → Scrapfly
  // renderiza e tenta de novo. É onde mora o WhatsApp comercial (= CELULAR), bem
  // melhor que o fixo da RF. Para na 1ª página que rende (máx 3 — controla crédito).
  if (results.length === 0) {
    for (const url of [`https://${domain}`, `https://${domain}/contato`, `https://www.${domain}`]) {
      const html = await fetchHtmlScrapfly(url);
      if (!html) continue;
      for (const phone of extractWhatsAppLinks(html)) {
        if (results.find((r) => r.phone === phone)) continue;
        results.push({
          phone, sourceType: "whatsapp_link", sourcePriority: 2, sourceUrl: url,
          confidenceScore: scorePhone({ sourceType: "whatsapp_link", isNormalized: true }),
          isWhatsApp: true, kind: classifyPhoneKind({ sourceType: "whatsapp_link", isWhatsApp: true }),
        });
      }
      for (const phone of extractRawPhones(html)) {
        if (results.find((r) => r.phone === phone)) continue;
        results.push({
          phone, sourceType: "site_oficial", sourcePriority: 1, sourceUrl: url,
          confidenceScore: scorePhone({ sourceType: "site_oficial", isNormalized: true }),
          isWhatsApp: false, kind: classifyPhoneKind({ sourceType: "site_oficial", isWhatsApp: false }),
        });
      }
      if (results.length > 0) break;
    }
  }

  return results;
}

// ─── Source 4: Google Places API (optional, needs GOOGLE_PLACES_API_KEY) ──────

export async function extractFromGooglePlaces(
  companyName: string,
  city?: string
): Promise<PhoneResult[]> {
  const key = config.GOOGLE_PLACES_API_KEY;
  if (!key) return [];

  try {
    const query = encodeURIComponent(`${companyName}${city ? ` ${city}` : ""}`);
    const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${query}&inputtype=textquery&fields=place_id,name,formatted_phone_number&key=${key}`;

    const res = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as any;
    const phone = data.candidates?.[0]?.formatted_phone_number;
    if (!phone) return [];

    const norm = normalisePhone(phone);
    if (!norm) return [];

    return [{
      phone:           norm,
      sourceType:      "google_places",
      sourcePriority:  4,
      sourceUrl:       `https://maps.google.com/?q=${query}`,
      confidenceScore: scorePhone({ sourceType: "google_places", isNormalized: true }),
      isWhatsApp:      false,
      kind:            classifyPhoneKind({ sourceType: "google_places", isWhatsApp: false }),
    }];
  } catch { return []; }
}

// ─── Source 5: CNPJ cadastral ─────────────────────────────────────────────────

export async function extractFromCnpj(cnpj: string): Promise<PhoneResult[]> {
  try {
    const clean = cnpj.replace(/\D/g, "");
    const res = await fetch(`https://publica.cnpj.ws/cnpj/${clean}`, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return [];
    const data = await res.json() as any;

    const phones: PhoneResult[] = [];
    for (const rawField of [data.ddd_telefone_1, data.ddd_telefone_2].filter(Boolean)) {
      const norm = normalisePhone(rawField.toString());
      if (norm) {
        phones.push({
          phone:           norm,
          sourceType:      "cnpj_cadastral",
          sourcePriority:  5,
          sourceUrl:       `https://publica.cnpj.ws/cnpj/${clean}`,
          confidenceScore: scorePhone({ sourceType: "cnpj_cadastral", isNormalized: true }),
          isWhatsApp:      false,
          kind:            classifyPhoneKind({ sourceType: "cnpj_cadastral", isWhatsApp: false }),
        });
      }
    }
    return phones;
  } catch { return []; }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export interface ExtractedPhone {
  phone:           string;
  sourceType:      PhoneSourceType;
  sourcePriority:  number;
  sourceUrl:       string;
  confidenceScore: number;
  isWhatsApp:      boolean;
  kind:            PhoneKind;
}

export async function extractPhones(params: {
  entityId:    string;
  entityType:  "company" | "contact";
  domain?:     string;
  cnpj?:       string;
  companyName?: string;
  city?:       string;
}): Promise<ExtractedPhone[]> {
  const all: PhoneResult[] = [];

  // Run non-Playwright sources in parallel; Playwright runs separately
  const [siteResults, placesResults, cnpjResults] = await Promise.allSettled([
    params.domain ? extractFromSite(params.domain) : Promise.resolve([]),
    params.companyName ? extractFromGooglePlaces(params.companyName, params.city) : Promise.resolve([]),
    params.cnpj ? extractFromCnpj(params.cnpj) : Promise.resolve([]),
  ]);

  for (const r of [siteResults, placesResults, cnpjResults]) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  // Deduplicate by phone number, keeping highest confidence
  const seen = new Map<string, PhoneResult>();
  for (const item of all) {
    const existing = seen.get(item.phone);
    if (!existing || item.confidenceScore > existing.confidenceScore) {
      seen.set(item.phone, item);
    }
  }

  // Celular/WhatsApp NA FRENTE do fixo (resolve "só fixo": quando há fixo E
  // WhatsApp/celular, o móvel vem primeiro), depois por prioridade da fonte.
  const results = [...seen.values()].sort((a, b) => {
    const am = a.isWhatsApp || isMobilePhone(a.phone) ? 0 : 1;
    const bm = b.isWhatsApp || isMobilePhone(b.phone) ? 0 : 1;
    if (am !== bm) return am - bm;
    return a.sourcePriority - b.sourcePriority;
  });

  // Persist to source audit
  if (results.length > 0) {
    await recordSources(
      results.map((r) => ({
        entityType:      params.entityType,
        entityId:        params.entityId,
        fieldName:       r.isWhatsApp ? "whatsapp" : "phone",
        fieldValue:      r.phone,
        sourceType:      r.sourceType,
        sourcePriority:  r.sourcePriority,
        sourceUrl:       r.sourceUrl,
        phoneKind:       r.kind,
        companyId:       params.entityType === "company" ? params.entityId : undefined,
        confidenceScore: r.confidenceScore,
        isValid:         true,
      }))
    );
  }

  return results;
}
