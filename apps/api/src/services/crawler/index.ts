// Garimpo crawler — orchestrates the persona + contact layers over v1 sources:
// the extension-fed base (enr_people) and the company's official site. Returns
// real decision-makers with evidence + confidence, or an honest "not found".
// No data is ever invented: base people are observed, site people are verified
// to literally appear on the page, and company channels are labelled as such.

import {
  expandRoles,
  findPersonas,
  scoreAdherence,
} from "../enrichment/engine/persona_finder.js";
import { canonicalDomain, normalizeName } from "../enrichment/engine/company_resolver.js";
import { extractPhones } from "../enrichment/engine/phone_extractor.js";
import { generateEmailCandidates } from "../enrichment/email.js";
import { pickVerifiedEmail } from "../enrichment/engine/email_verifier.js";
import { classifyConfidence, multiSourceBoost } from "../enrichment/engine/confidence_scorer.js";
import { recordSources } from "../enrichment/engine/source_auditor.js";
import { findPeopleOnSite } from "./company_site.js";
import { findLeadersViaSerp, findCompanyLinkedin, serperConfigured } from "../enrichment/engine/serper.js";
import { findSocios } from "../enrichment/engine/socios_finder.js";
import type { CompanyRef, CrawlResult, DecisionMaker, EvidenceItem, PersonaQuery } from "./types.js";

// Minimum overall confidence to report a person as "found".
const PERSONA_MIN_SCORE = 50;
// Base confidence by where the person came from.
const SOURCE_BASE = { extension: 65, rf_qsa: 60, serp_linkedin: 58, company_site: 55 } as const;

interface WorkingCandidate {
  firstName:   string;
  lastName:    string;
  jobTitle:    string;
  linkedinUrl?: string;
  email?:      string;
  phone?:      string;
  adherence:   number;
  sources:     Set<string>;
  evidence:    EvidenceItem[];
}

function nameKey(first: string, last: string): string {
  return normalizeName(`${first} ${last}`.trim());
}

export async function findDecisionMakers(
  company: CompanyRef,
  persona: PersonaQuery
): Promise<CrawlResult> {
  const domain = canonicalDomain(company.domain) ?? undefined;
  // Multi-área: busca o responsável de CADA área pedida (cargo principal + áreas
  // derivadas da dor). Uma passada, uma query SERP com as áreas em OR.
  const roleNames = persona.roleNames?.length ? persona.roleNames : [persona.roleName];
  const expandedRoles = [...new Set(
    (await Promise.all(roleNames.map((r) => expandRoles(r, persona.painPoint, persona.sector)))).flat()
  )];
  // Termos da SERP: nomes das áreas primeiro (sinal forte), depois as expansões.
  // findLeadersViaSerp corta em 6 — assim as áreas lideram a query.
  const serpRoleTerms = [...new Set([...roleNames, ...expandedRoles])];

  const byKey = new Map<string, WorkingCandidate>();
  // Diário do funil — uma linha por camada, mostrado no log da execução do Garimpo.
  const trace: string[] = [];

  // ── Company page do LinkedIn (nível empresa) ───────────────────────────────
  // Independe de achar decisor: é um sinal da própria empresa, útil pra pesquisa
  // manual e como ponto de partida pra pessoas. 1 crédito Serper, cacheado 30d.
  const companyLinkedin = (await findCompanyLinkedin(company.name, company.tradeName).catch(() => null)) ?? undefined;
  if (serperConfigured()) {
    trace.push(`LinkedIn da empresa: ${companyLinkedin ? companyLinkedin : "não encontrada"}`);
  }
  if (companyLinkedin && company.companyId) {
    await recordSources([{
      entityType:      "company" as const,
      entityId:        company.companyId,
      fieldName:       "company_linkedin",
      fieldValue:      companyLinkedin,
      sourceType:      "serp_linkedin",
      sourceUrl:       companyLinkedin,
      companyId:       company.companyId,
      confidenceScore: 70,
      isValid:         true,
    }]).catch(() => {});
  }

  const upsert = (c: {
    firstName: string; lastName: string; jobTitle: string;
    linkedinUrl?: string; email?: string; phone?: string;
    adherence: number; source: string; evidence: EvidenceItem;
  }) => {
    const key = nameKey(c.firstName, c.lastName);
    if (!key) return;
    const existing = byKey.get(key);
    if (existing) {
      existing.sources.add(c.source);
      existing.adherence = Math.max(existing.adherence, c.adherence);
      existing.linkedinUrl ??= c.linkedinUrl;
      existing.email ??= c.email;
      existing.phone ??= c.phone;
      if (!existing.jobTitle && c.jobTitle) existing.jobTitle = c.jobTitle;
      existing.evidence.push(c.evidence);
    } else {
      byKey.set(key, {
        firstName: c.firstName, lastName: c.lastName, jobTitle: c.jobTitle,
        linkedinUrl: c.linkedinUrl, email: c.email, phone: c.phone,
        adherence: c.adherence, sources: new Set([c.source]), evidence: [c.evidence],
      });
    }
  };

  // ── Source 1: extension-fed base (enr_people) ──────────────────────────────
  // findPersonas already matches by CNPJ→domain→name, expands roles and scores
  // adherence (>=40), returning only real, observed people.
  const baseCandidates = await findPersonas({
    roleName:           persona.roleName,
    painPoint:          persona.painPoint,
    productDescription: persona.productDescription,
    companyName:        company.name,
    companyTradeName:   company.tradeName,
    cnpj:               company.cnpj,
    companyId:          company.companyId,
    sector:             persona.sector,
    domain,
  });

  for (const c of baseCandidates) {
    upsert({
      firstName: c.firstName, lastName: c.lastName, jobTitle: c.jobTitle,
      linkedinUrl: c.linkedinUrl, email: c.email, phone: c.phone,
      adherence: c.adherenceScore, source: "extension",
      evidence: {
        field: "persona", value: `${c.firstName} ${c.lastName} — ${c.jobTitle}`,
        source: "extension", url: c.linkedinUrl, score: c.adherenceScore,
      },
    });
  }
  trace.push(`Base própria (extensão): ${baseCandidates.length} pessoa(s)`);

  // ── Source 2: official site (team / about / leadership pages) ──────────────
  if (domain) {
    const sitePeople = await findPeopleOnSite(domain);
    let siteMatched = 0;
    for (const p of sitePeople) {
      const adherence = scoreAdherence(p.jobTitle, expandedRoles);
      if (adherence < 40) continue; // role doesn't match the persona
      siteMatched++;
      upsert({
        firstName: p.firstName, lastName: p.lastName, jobTitle: p.jobTitle,
        adherence, source: "company_site",
        evidence: {
          field: "persona", value: `${p.firstName} ${p.lastName} — ${p.jobTitle}`,
          source: "company_site", url: p.sourceUrl, snippet: p.snippet, score: adherence,
        },
      });
    }
    trace.push(`Site oficial: ${sitePeople.length} pessoa(s) com cargo, ${siteMatched} no cargo-alvo`);
  }

  // ── Source 3: SERP (Google → LinkedIn) — QUEM lidera o cargo-alvo ──────────
  // Lê o snippet do LinkedIn no Google ("Nome - Cargo - Empresa") sem abrir o
  // LinkedIn. Pega o cargo FUNCIONAL real (Diretor Financeiro/CRO/etc.) — o que
  // a RF QSA não tem. Fonte funcional: quando acha, dispensa o fallback RF.
  const serpPeople = await findLeadersViaSerp(company.name, serpRoleTerms, company.city);
  let serpMatched = 0;
  for (const p of serpPeople) {
    const adherence = scoreAdherence(p.jobTitle, expandedRoles);
    if (adherence < 40) continue; // cargo não bate com a persona
    serpMatched++;
    upsert({
      firstName: p.firstName, lastName: p.lastName, jobTitle: p.jobTitle,
      linkedinUrl: p.linkedinUrl, adherence, source: "serp_linkedin",
      evidence: {
        field: "persona", value: `${p.firstName} ${p.lastName} — ${p.jobTitle}`,
        source: "serp_linkedin", url: p.linkedinUrl, snippet: p.snippet, score: adherence,
      },
    });
  }
  if (serperConfigured()) {
    trace.push(`SERP/LinkedIn: ${serpPeople.length} candidato(s), ${serpMatched} no cargo-alvo`);
  }

  // ── Source 4: RF QSA (rf_socios) — sócios/administradores reais do CNPJ ─────
  // Fonte própria grátis da Receita Federal; substitui o scraping zero-yield do
  // antigo motor passivo.
  //
  // ⚠️ A RF QSA traz só REPRESENTANTES LEGAIS (sócios/administradores) — NUNCA
  // cargos funcionais (ex.: "Diretor Comercial"/"CRO"), que só vêm de LinkedIn/site.
  // Por isso ela entra como FALLBACK: só quando NENHUM cargo-alvo foi encontrado nas
  // fontes funcionais (extensão/site). Quando entra, a aderência é HONESTA (sem piso,
  // logo geralmente baixa — não é o cargo pedido) e o registro é rotulado como
  // representante legal. Em PME costuma ser o decisor real (o dono toca o comercial),
  // mas o usuário vê claramente que NÃO é o cargo que pediu. Decisão do user 2026-06-13.
  let sociosTried = 0;
  const hasFunctionalCandidate = byKey.size > 0; // alguém do cargo-alvo (extensão/site)
  if (company.cnpj && !hasFunctionalCandidate) {
    const socios = await findSocios(company.cnpj);
    sociosTried = socios.length;
    for (const s of socios) {
      // Aderência real (sem piso): reflete honestamente o quanto o cargo societário
      // bate com o cargo-alvo. A confiança da fonte rf_qsa (60) é o que faz o
      // representante legal passar o limiar mesmo com aderência baixa.
      const adherence = scoreAdherence(s.cargo, expandedRoles);
      upsert({
        firstName: s.firstName, lastName: s.lastName, jobTitle: s.cargo,
        adherence, source: "rf_qsa",
        evidence: {
          field: "persona",
          value: `${s.firstName} ${s.lastName} — ${s.cargo} (representante legal RF; cargo-alvo "${persona.roleName}" não localizado)`,
          source: "rf_qsa", score: adherence,
        },
      });
    }
    trace.push(`RF QSA: ${sociosTried} sócio(s)-administrador(es) (fallback — cargo-alvo não achado nas fontes funcionais)`);
  } else if (hasFunctionalCandidate) {
    trace.push(`RF QSA: pulado (cargo-alvo já achado nas fontes funcionais)`);
  }

  // ── Score, threshold, build decision-makers ────────────────────────────────
  const decisionMakers: DecisionMaker[] = [];

  for (const c of byKey.values()) {
    let confidence: number = Math.max(
      c.sources.has("extension")     ? SOURCE_BASE.extension     : 0,
      c.sources.has("rf_qsa")        ? SOURCE_BASE.rf_qsa        : 0,
      c.sources.has("serp_linkedin") ? SOURCE_BASE.serp_linkedin : 0,
      c.sources.has("company_site")  ? SOURCE_BASE.company_site  : 0,
    );
    // Reward strong role match.
    if (c.adherence >= 85) confidence += 10;
    else if (c.adherence >= 70) confidence += 5;
    // Reward independent confirmation across sources.
    confidence = multiSourceBoost(confidence, c.sources.size);

    if (confidence < PERSONA_MIN_SCORE) continue;

    // ── Contact layer ────────────────────────────────────────────────────────
    let phone = c.phone;
    let phoneKind: DecisionMaker["phoneKind"];
    if (!phone && domain && company.companyId) {
      const phones = await extractPhones({
        entityId:    company.companyId,
        entityType:  "company",
        domain,
        cnpj:        company.cnpj,
        companyName: company.name,
        city:        company.city,
      }).catch(() => []);
      if (phones[0]) { phone = phones[0].phone; phoneKind = phones[0].kind; }
    }

    let email = c.email;
    let emailConfidence: DecisionMaker["emailConfidence"];
    if (email) {
      emailConfidence = "alta"; // observed (from the base)
    } else if (domain) {
      const candidates = generateEmailCandidates(c.firstName, c.lastName, domain);
      // Tenta verificar o padrão MX (Abstract). Sobe a confiança quando dá;
      // sem chave/crédito, pickVerifiedEmail devolve null e cai no palpite.
      const verified = await pickVerifiedEmail(candidates).catch(() => null);
      if (verified) {
        email = verified.email;
        emailConfidence = verified.verdict === "valid" ? "alta" : "media"; // catchall = media
      } else {
        email = candidates[0];
        emailConfidence = "baixa"; // padrão inferido — não verificado
      }
    }

    decisionMakers.push({
      firstName: c.firstName,
      lastName:  c.lastName,
      jobTitle:  c.jobTitle,
      companyName: company.name,
      linkedinUrl: c.linkedinUrl,
      email,
      emailConfidence,
      phone,
      phoneKind,
      adherenceScore:  c.adherence,
      confidenceScore: confidence,
      confidenceLevel: classifyConfidence(confidence),
      sources: [...c.sources],
      evidence: c.evidence,
    });

    const emailLabel = !email ? "não encontrado"
      : emailConfidence === "alta"  ? "verificado ✓ entregável"
      : emailConfidence === "media" ? "verificado (catch-all)"
      :                                "padrão não verificado";
    trace.push(`${c.firstName} ${c.lastName}: e-mail ${emailLabel} · telefone ${phone ? "✓ " + (phoneKind ?? "") : "— (cairia no bureau)"}`);

    // Persist persona evidence for audit (only when we can link the company).
    if (company.companyId) {
      await recordSources(
        c.evidence.map((e) => ({
          entityType:      "company" as const,
          entityId:        company.companyId!,
          fieldName:       "persona_candidate",
          fieldValue:      e.value,
          sourceType:      e.source,
          sourceUrl:       e.url,
          snippet:         e.snippet,
          companyId:       company.companyId,
          confidenceScore: e.score,
          isValid:         true,
        }))
      ).catch(() => {});
    }
  }

  decisionMakers.sort((a, b) => b.confidenceScore - a.confidenceScore);

  if (decisionMakers.length === 0) {
    // Motivo informativo p/ diagnosticar o funil do Garimpo no log da run.
    const why = !company.cnpj
      ? "empresa sem CNPJ (sem fallback RF)"
      : sociosTried === 0
        ? "sem sócios na base RF p/ este CNPJ"
        : `${sociosTried} sócio(s) RF, mas cargo abaixo do limiar`;
    return { status: "not_found", reason: `Persona não encontrada (${why}).`, companyLinkedin, trace };
  }
  return { status: "found", decisionMakers, companyLinkedin, trace };
}
