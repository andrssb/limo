// Company-site persona adapter: fetches the official site's people-bearing pages
// (team / about / leadership / contact), and extracts real {name, role} pairs.
// The LLM only EXTRACTS what literally appears in the fetched text — every name
// is verified as a substring of the page before being accepted, so we never
// invent people. The matching excerpt is kept as evidence.

import { groq, MODELS } from "../../lib/groq.js";
import { config } from "../../config.js";
import { cacheGetJson, cacheSetJson } from "../../lib/cache.js";

const SITE_CACHE_TTL = 14 * 24 * 3600; // 14 dias — evita re-render (crédito Scrapfly)

const FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Pages most likely to list people, in priority order.
const CANDIDATE_PATHS = [
  "", "/sobre", "/sobre-nos", "/quem-somos", "/empresa",
  "/equipe", "/time", "/nosso-time", "/nossa-equipe",
  "/lideranca", "/diretoria", "/gestao", "/conselho",
  "/contato", "/comercial", "/vendas",
];

const MAX_PAGES = 5;
const MAX_TEXT_PER_PAGE = 6000;
// Texto cru abaixo disso = página provavelmente renderizada por JS (Wix/React) →
// escala pro Scrapfly. Teto de chamadas Scrapfly por site = controle de crédito.
const SPA_THIN_THRESHOLD = 300;
const MAX_SCRAPFLY_PER_SITE = 3;

export interface SitePerson {
  firstName: string;
  lastName:  string;
  jobTitle:  string;
  sourceUrl: string;
  snippet:   string;
}

export interface SiteFindings {
  people:       SitePerson[];
  linkedinUrls: string[];
  emails:       string[];
}

const LINKEDIN_IN_RE = /linkedin\.com\/in\/[A-Za-z0-9_\-%]{2,80}/gi;
const EMAIL_RE       = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Limpa HTML → texto: tira script/style, dropa tags, colapsa espaço.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_PER_PAGE);
}

// Busca CRUA (grátis, rápida). Funciona na maioria dos sites server-rendered.
async function fetchTextRaw(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": FETCH_UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return htmlToText(await res.text());
  } catch {
    return null;
  }
}

// Render via Scrapfly (JS + proxy + anti-bot). Só na cascata, quando o cru volta
// magro. Cobra crédito (render ~6, anti-bot ~30). Null se sem chave ou falha.
async function fetchTextScrapfly(url: string): Promise<string | null> {
  if (!config.SCRAPFLY_API_KEY) return null;
  try {
    const api =
      `https://api.scrapfly.io/scrape?key=${config.SCRAPFLY_API_KEY}` +
      `&url=${encodeURIComponent(url)}&render_js=true&country=br&asp=true`;
    const res = await fetch(api, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return null;
    const j: any = await res.json();
    const html = j?.result?.content;
    return typeof html === "string" && html ? htmlToText(html) : null;
  } catch {
    return null;
  }
}

// Builds a short excerpt around the first occurrence of `name` in `text`.
function snippetAround(text: string, name: string): string {
  const idx = text.toLowerCase().indexOf(name.toLowerCase());
  if (idx === -1) return "";
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + name.length + 80);
  return text.slice(start, end).trim();
}

async function extractPeopleFromText(text: string): Promise<{ name: string; role: string }[]> {
  const prompt = `Você recebe o TEXTO de uma página de site institucional de uma empresa brasileira.

Extraia APENAS pessoas (nome completo + cargo) que aparecem LITERALMENTE no texto. NÃO invente nomes nem cargos. Se o texto não trouxer pessoas com cargo, retorne lista vazia.

Texto:
"""
${text}
"""

Responda só com JSON válido:
{"people":[{"name":"Nome Completo","role":"Cargo"}]}`;

  try {
    const res = await groq.chat.completions.create({
      model: MODELS.fast,
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
    return Array.isArray(parsed.people) ? parsed.people : [];
  } catch {
    return [];
  }
}

// Scans the company's official site for people (verified to appear in page text),
// LinkedIn /in/ URLs, and emails. Anti-hallucination on names; raw regex on URLs/emails.
export async function scanSite(domain: string): Promise<SiteFindings> {
  const host = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]!;

  // Cache (Redis): re-scan do mesmo site não re-gasta crédito Scrapfly nem LLM.
  const cacheKey = `site:${host}`;
  const cached = await cacheGetJson<SiteFindings>(cacheKey);
  if (cached) return cached;

  const people: SitePerson[] = [];
  const seenNames = new Set<string>();
  const linkedinSet = new Set<string>();
  const emailSet    = new Set<string>();
  let pagesFetched = 0;
  let scrapflyUsed = 0;

  for (const path of CANDIDATE_PATHS) {
    if (pagesFetched >= MAX_PAGES) break;

    const url = `https://${host}${path}`;
    // Cascata: cru primeiro; se volta magro (SPA), escala pro Scrapfly (com teto).
    let text = await fetchTextRaw(url);
    if ((!text || text.length < SPA_THIN_THRESHOLD) && scrapflyUsed < MAX_SCRAPFLY_PER_SITE) {
      const rendered = await fetchTextScrapfly(url);
      if (rendered && rendered.length > (text?.length ?? 0)) {
        scrapflyUsed++;
        text = rendered;
      }
    }
    if (!text || text.length < 80) continue;
    pagesFetched++;

    // Raw signals — cheap regex, no LLM
    for (const m of text.matchAll(LINKEDIN_IN_RE)) {
      linkedinSet.add(m[0].toLowerCase().replace(/\/+$/, ""));
    }
    for (const m of text.matchAll(EMAIL_RE)) {
      const e = m[0].toLowerCase();
      if (e.endsWith(`@${host}`) || e.endsWith(`.${host}`) || e.includes("@" + host.replace(/^www\./, ""))) {
        emailSet.add(e);
      } else if (!e.endsWith("@example.com") && !e.endsWith("@sentry.io") && !e.endsWith("@wixpress.com")) {
        // Keep generic emails from the site too (might still be useful)
        emailSet.add(e);
      }
    }

    const persons = await extractPeopleFromText(text);
    for (const p of persons) {
      const name = (p.name ?? "").trim();
      const role = (p.role ?? "").trim();
      if (!name || !role) continue;

      // Anti-hallucination: the name must literally appear in the page text.
      if (!text.toLowerCase().includes(name.toLowerCase())) continue;

      const key = name.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);

      const [firstName = "", ...rest] = name.split(/\s+/);
      people.push({
        firstName,
        lastName:  rest.join(" "),
        jobTitle:  role,
        sourceUrl: url,
        snippet:   snippetAround(text, name),
      });
    }
  }

  const findings: SiteFindings = {
    people,
    linkedinUrls: [...linkedinSet],
    emails:       [...emailSet],
  };
  // Só cacheia se fez ao menos 1 página (evita gravar "vazio" de site fora do ar).
  if (pagesFetched > 0) await cacheSetJson(cacheKey, findings, SITE_CACHE_TTL);
  return findings;
}

// Backwards-compatible wrapper used by the active crawler (Garimpo flow).
export async function findPeopleOnSite(domain: string): Promise<SitePerson[]> {
  const { people } = await scanSite(domain);
  return people;
}
