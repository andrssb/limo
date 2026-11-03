import { Worker } from "bullmq";
import { createRedis } from "../lib/redis.js";
import { getDb } from "@limo/db";
import { garimpoRuns, personas, lists, listContacts, listCompanies, contacts, teams } from "@limo/db";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { QUEUES, type GarimpoJob } from "../lib/queue.js";
import { detectTechs, extractDomainFromEmail } from "../services/companies.js";
import { discoverCompanies } from "../services/discovery/company_discovery_engine.js";
import { getTeamPlan, getPlanLimits, getListContactCount } from "../lib/plans.js";
import { ensureQuotaPeriod, summarizeQuota, debitPersonaQuota, allowanceForPlan } from "../lib/quotas.js";
import { resolveCompany }             from "../services/enrichment/engine/company_resolver.js";
import { resolveDomain }              from "../services/enrichment/engine/domain_resolver.js";
import { findPersonas, suggestAlternativePersonas } from "../services/enrichment/engine/persona_finder.js";
import { matchIdentity }              from "../services/enrichment/engine/identity_matcher.js";
import { findContact }                from "../services/enrichment/engine/contact_finder.js";
import { findDecisionMakers }         from "../services/crawler/index.js";
import { enrichPersonPaid }           from "../services/enrichment/paid_enrich.js";

// New modular crawler path for the Garimpo. Reversible: set GARIMPO_USE_CRAWLER=0
// to fall back to the legacy persona_finder + contact_finder flow.
const USE_CRAWLER = process.env.GARIMPO_USE_CRAWLER !== "0";

// Complemento PAGO (Assertiva) no fluxo do Garimpo: fallback quando faltar
// telefone/email da PESSOA depois da base grátis (crawler + telefone público da
// RF). Cache + teto mensal no helper. Reversível: GARIMPO_PAID_ENRICH=0.
const PAID_ENRICH = process.env.GARIMPO_PAID_ENRICH !== "0";

const onlyDigits = (s: unknown): string => String(s ?? "").replace(/\D/g, "");

// ─── Log helper ───────────────────────────────────────────────────────────────

async function log(db: ReturnType<typeof getDb>, runId: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(`[garimpo:${runId.slice(0, 8)}] ${line}`);
  try {
    await db.execute(
      sql`UPDATE garimpo_runs SET log = array_append(log, ${line}) WHERE id = ${runId}`
    );
  } catch (e) {
    console.error(`[garimpo] log DB write failed:`, (e as Error).message);
  }
}

// Check if enrichment engine tables exist (migration may not have run yet)
async function checkEngineAvailable(db: ReturnType<typeof getDb>): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1 FROM enr_companies LIMIT 0`);
    return true;
  } catch {
    return false;
  }
}

// ─── Company search via RF (local base → AI fallback inside discoverCompanies) ─

async function fetchCompanies(persona: any): Promise<any[]> {
  const sector = persona.targetSectors?.[0];
  if (!sector) return [];

  const results = await discoverCompanies({
    sector,
    state: persona.targetStates?.[0],
    limit: 50,
  });

  return results;
}

// Companies the Garimpo will work through. Prefers the companies the user saved
// to this list via "Descobrir"; only falls back to fresh discovery when the
// list has no companies yet.
async function fetchCompaniesForRun(
  db: ReturnType<typeof getDb>,
  listId: string,
  persona: any
): Promise<{ companies: any[]; fromList: boolean }> {
  const saved = await db
    .select()
    .from(listCompanies)
    .where(eq(listCompanies.listId, listId))
    .limit(1000);

  if (saved.length > 0) {
    const companies = saved.map((c) => ({
      legal_name:   c.legalName,
      trade_name:   c.tradeName,
      cnpj:         c.cnpj,
      domain:       c.domain,
      sector:       c.sector,
      public_email: c.publicEmail,
      public_phone: c.publicPhone,
      state:        c.state,
      city:         c.city,
    }));
    return { companies, fromList: true };
  }

  return { companies: await fetchCompanies(persona), fromList: false };
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startGarimpoWorker(): Worker {
  const worker = new Worker<GarimpoJob>(
    QUEUES.GARIMPO,
    async (job) => {
      const { runId, personaId, listId, userId, teamId, maxContacts } = job.data;
      const db = getDb();

      await db.update(garimpoRuns).set({ status: "running" }).where(eq(garimpoRuns.id, runId));
      await log(db, runId, "Garimpo iniciado");

      const [persona] = await db.select().from(personas).where(eq(personas.id, personaId)).limit(1);
      if (!persona) {
        await db.update(garimpoRuns).set({ status: "failed", completedAt: new Date() }).where(eq(garimpoRuns.id, runId));
        return;
      }

      const engineReady   = await checkEngineAvailable(db);
      const teamPlan      = await getTeamPlan(teamId);
      const { contactsPerList } = getPlanLimits(teamPlan);

      // Ensure quota period is valid (bootstraps on first run, resets after 30d)
      // and load the team so we know how many personas we may deliver in this run.
      await ensureQuotaPeriod(db, teams, teamId);
      const [teamRow] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
      const quota = summarizeQuota(teamRow);

      if (quota.totalAvailable <= 0) {
        await log(db, runId, `Saldo de personas esgotado (plano ${teamPlan}: ${quota.monthlyUsed}/${quota.monthlyAllowance} mensais, extra: ${quota.extraBalance}). Compre um pacote adicional pra continuar.`);
        await db.update(garimpoRuns)
          .set({ status: "failed", completedAt: new Date() })
          .where(eq(garimpoRuns.id, runId));
        return;
      }

      let quotaRemaining = quota.totalAvailable;
      await log(db, runId, `Fonte de personas: base própria (enr_people) | Motor de enriquecimento: ${engineReady ? "ativo" : "tabelas pendentes — modo básico"} | Plano: ${teamPlan} (limite: ${contactsPerList} contatos/lista) | Saldo: ${quotaRemaining} (${quota.monthlyRemaining} mensais + ${quota.extraBalance} extras)`);

      // Áreas pela dor (suggestAlternativePersonas) — agora DIRIGEM a busca, não
      // só o log: o Garimpo procura o responsável de CADA área, não um cargo só.
      let altRoleNames: string[] = [];
      if (persona.painPoint || persona.productDescription) {
        const altSuggestions = await suggestAlternativePersonas(
          persona.painPoint,
          persona.productDescription,
          persona.targetSectors?.[0]
        ).catch(() => []);
        if (altSuggestions.length > 0) {
          altRoleNames = altSuggestions.map((s) => s.roleName).filter(Boolean);
          await log(db, runId, `💡 Áreas que o produto também atende (entram na busca):`);
          for (const s of altSuggestions) {
            await log(db, runId, `  → ${s.roleName} (${s.department}): ${s.reasoning}`);
          }
        }
      }

      const { companies, fromList } = await fetchCompaniesForRun(db, listId, persona);
      await log(
        db,
        runId,
        fromList
          ? `${companies.length} empresas da lista (salvas via Descobrir)`
          : `${companies.length} empresas descobertas (lista sem empresas — usando setor da persona)`
      );

      // Conjunto de cargos-alvo: o que o usuário pediu + as áreas derivadas da dor.
      const targetRoles    = [...new Set([...(persona.targetRoles ?? []), ...altRoleNames].filter(Boolean))];
      const targetRole     = targetRoles[0] ?? "Decisor"; // legado (findPersonas) + logs
      let contactsFound    = 0;
      let companiesScanned = 0;
      let companiesSkippedNoSite = 0;
      let limitReached     = false;

      for (const company of companies) {
        companiesScanned++;
        const name   = company.legal_name || company.trade_name || (company as any).name || (company as any).razao_social || "";
        const cnpj   = company.cnpj ?? null;
        const sector = persona.targetSectors?.[0] ?? company.sector ?? undefined;

        try {

        // ── 1. Resolve company + domain via enrichment engine (if ready) ──
        // Prefer RF domain hint (top_domain or derived from RF email)
        let domain: string | undefined = company.domain
          ?? (company.public_email ? extractDomainFromEmail(company.public_email) : undefined)
          ?? undefined;
        let resolved: Awaited<ReturnType<typeof resolveCompany>> = null;

        if (engineReady) {
          resolved = await resolveCompany({
            name, cnpj: cnpj ?? undefined, domain,
            sector,
            state: company.state ?? persona.targetStates?.[0],
            city:  company.city  ?? persona.targetCities?.[0],
          });
          if (resolved) {
            const dr = await resolveDomain({
              companyId:    resolved.id,
              cnpjEmail:    company.public_email ?? undefined,
              companyName:  name,
              knownDomains: domain ? [domain] : [],
              city:         company.city  ?? persona.targetCities?.[0],
              state:        company.state ?? persona.targetStates?.[0],
            });
            domain = dr?.domain ?? domain;
          }
        }

        // ── 2. Filtro de qualificação: SÓ empresa COM SITE ────────────────
        // Empresa sem domínio resolvido = sem presença web. É de onde o crawler
        // extrai celular/WhatsApp + e-mail verificado; sem site sobra só o fixo
        // da RF (lição da base da Lia). Pula: não crawleia, não vira lead. Só
        // aplica quando a resolução REALMENTE rodou (engineReady), pra não
        // descartar tudo se o motor estiver fora.
        if (engineReady && !domain) {
          companiesSkippedNoSite++;
          await log(db, runId, `↷ ${name}: sem site — pulada (não qualifica)`);
          continue;
        }

        // ── 3. Detect tech stack ─────────────────────────────────────────
        const techs = domain ? await detectTechs(domain) : [];

        // ── Crawler path (new modular Garimpo) — reversible via env flag ──
        if (USE_CRAWLER) {
          const result = await findDecisionMakers(
            {
              name,
              tradeName: company.trade_name ?? (company as any).tradeName ?? undefined,
              cnpj:      cnpj ?? undefined,
              domain,
              companyId: resolved?.id,
              city:      company.city  ?? persona.targetCities?.[0],
              state:     company.state ?? persona.targetStates?.[0],
            },
            {
              roleName:           targetRole,
              roleNames:          targetRoles.length ? targetRoles : undefined,
              painPoint:          persona.painPoint,
              productDescription: persona.productDescription,
              sector:             sector ?? undefined,
            }
          );

          if (result.status === "not_found") {
            await log(db, runId, `${name}: ${result.reason}`);
            for (const t of result.trace ?? []) await log(db, runId, `  ↳ ${t}`);
          } else {
            const top = result.decisionMakers[0]!;
            const rfFallback = top.sources.length === 1 && top.sources[0] === "rf_qsa";
            await log(db, runId, `${name}: ${result.decisionMakers.length} decisor(es) via crawler${rfFallback ? " (RF — representante legal, fallback do cargo-alvo)" : ""} — melhor confiança: ${top.confidenceLevel}`);
            // Funil camada por camada (transparência da execução no painel).
            for (const t of result.trace ?? []) await log(db, runId, `  ↳ ${t}`);
            for (const dm of result.decisionMakers.slice(0, 3)) {
              if (maxContacts && contactsFound >= maxContacts) {
                await log(db, runId, `Teto definido pelo gestor atingido (${maxContacts} contatos) — encerrando.`);
                limitReached = true;
                break;
              }
              if (quotaRemaining <= 0) {
                await log(db, runId, `Saldo de personas esgotado durante a run — encerrando. Compre um pacote adicional pra continuar.`);
                limitReached = true;
                break;
              }

              const [existing] = await db
                .select({ id: contacts.id })
                .from(contacts)
                .where(and(eq(contacts.teamId, teamId), eq(contacts.companyName, name), eq(contacts.jobTitle, dm.jobTitle)))
                .limit(1);

              let contactId = existing?.id;
              if (!contactId) {
                const [newContact] = await db
                  .insert(contacts)
                  .values({
                    firstName:     dm.firstName,
                    lastName:      dm.lastName,
                    email:         dm.email ?? null,
                    phone:         dm.phone ?? null,
                    linkedinUrl:   dm.linkedinUrl ?? null,
                    companyName:   name,
                    companyDomain: domain ?? null,
                    jobTitle:      dm.jobTitle,
                    source:        "garimpo",
                    userId,
                    teamId,
                    enrichmentData: {
                      technologies:    techs,
                      cnpj:            cnpj ?? undefined,
                      adherenceScore:  dm.adherenceScore,
                      confidenceScore: dm.confidenceScore,
                      confidenceLevel: dm.confidenceLevel,
                      phoneKind:       dm.phoneKind,
                      emailConfidence: dm.emailConfidence,
                      sources:         dm.sources,
                      evidence:        dm.evidence,
                      companyLinkedin: result.companyLinkedin ?? undefined,
                    },
                  })
                  .returning({ id: contacts.id });
                contactId = newContact.id;
                contactsFound++;
                quotaRemaining--;
              } else if (dm.email || dm.phone) {
                await db
                  .update(contacts)
                  .set({ email: dm.email ?? undefined, phone: dm.phone ?? undefined, updatedAt: new Date() })
                  .where(eq(contacts.id, contactId));
              }

              // ── Enriquecimento de contato: RF (grátis) primeiro, Assertiva (pago)
              // como fallback. Ordem: dado do crawler → Assertiva (telefone/email
              // da PESSOA, se faltar) → telefone público da empresa (RF) como
              // último recurso. Compliance: dado pago vai pro contato + cache,
              // NUNCA pra enr_people (base permanente). Ver paid_enrich.ts.
              if (contactId) {
                let email: string | null = dm.email ?? null;
                let phone: string | null = dm.phone ?? null;
                const companyPhone = company.public_phone ? onlyDigits(company.public_phone) : null;
                let enrichedPhones: string[] = [];
                let enrichedEmails: string[] = [];
                let usedPaid = false;

                // Assertiva só quando ainda falta telefone OU email da pessoa E o
                // time está com o enriquecimento pago LIGADO (toggle na conta —
                // desliga em testes, liga em demo pra trazer o contato real).
                // NUNCA no TRIAL: o pool da Assertiva (R$550 compartilhado) não
                // pode ser drenado por signups grátis — trial usa só fonte grátis.
                const isTrial = teamRow?.plan === "trial";
                if (PAID_ENRICH && teamRow?.assertivaEnabled && !isTrial && (!email || !phone)) {
                  const paid = await enrichPersonPaid(db, {
                    teamId, contactId,
                    firstName: dm.firstName, lastName: dm.lastName,
                    companyName: name, cnpj: cnpj ?? undefined,
                    city:  company.city  ?? persona.targetCities?.[0],
                    state: company.state ?? persona.targetStates?.[0],
                  }).catch(() => null);

                  if (paid?.status === "cap_reached") {
                    await log(db, runId, `  ↳ teto mensal de enriquecimento externo atingido — seguindo com dado da RF`);
                  }
                  enrichedPhones = paid?.phones.map((p) => p.number) ?? [];
                  enrichedEmails = paid?.emails.map((e) => e.address) ?? [];
                  phone = phone ?? enrichedPhones[0] ?? null;
                  email = email ?? enrichedEmails[0] ?? null;
                  usedPaid = enrichedPhones.length > 0 || enrichedEmails.length > 0;
                }

                // Último recurso de telefone: linha pública da empresa (RF), grátis.
                const usedCompanyPhone = !phone && !!companyPhone;
                if (usedCompanyPhone) phone = companyPhone;

                if (phone || email || companyPhone) {
                  const [cur] = await db
                    .select({ enr: contacts.enrichmentData })
                    .from(contacts).where(eq(contacts.id, contactId)).limit(1);
                  await db.update(contacts).set({
                    phone: phone ?? undefined,
                    email: email ?? undefined,
                    updatedAt: new Date(),
                    enrichmentData: {
                      ...((cur?.enr as any) ?? {}),
                      ...(companyPhone ? { companyPhone } : {}),
                      ...(enrichedPhones.length ? { enrichedPhones } : {}),
                      ...(enrichedEmails.length ? { enrichedEmails } : {}),
                      phoneSource: phone
                        ? (dm.phone ? "crawler" : usedPaid && enrichedPhones[0] === phone ? "externa" : usedCompanyPhone ? "rf_empresa" : "externa")
                        : undefined,
                      ...(usedPaid ? { enrichedAt: new Date().toISOString() } : {}),
                    },
                  }).where(eq(contacts.id, contactId));

                  if (usedCompanyPhone) {
                    await log(db, runId, `  ↳ ${dm.firstName} ${dm.lastName}: sem telefone pessoal — usando telefone público da empresa (RF)`);
                  } else if (usedPaid) {
                    await log(db, runId, `  ↳ ${dm.firstName} ${dm.lastName}: telefone/email complementado por fonte externa`);
                  }
                }
              }

              const currentListSize = await getListContactCount(listId);
              if (currentListSize >= contactsPerList) {
                await log(db, runId, `Limite do plano ${teamPlan} atingido (${contactsPerList} contatos/lista) — encerrando`);
                limitReached = true;
                break;
              }
              await db.insert(listContacts).values({ listId, contactId, addedBy: userId }).onConflictDoNothing();
            }
          }

          await db.update(garimpoRuns).set({ contactsFound, companiesScanned }).where(eq(garimpoRuns.id, runId));
          if (limitReached) break;
          continue;
        }

        // ── 4. Find personas at this company ─────────────────────────────
        const candidates = await findPersonas({
          roleName:           targetRole,
          painPoint:          persona.painPoint,
          productDescription: persona.productDescription,
          companyName:        name,
          companyTradeName:   company.trade_name ?? (company as any).tradeName ?? undefined,
          cnpj:               cnpj ?? undefined,
          companyId:          resolved?.id,
          sector:             sector ?? undefined,
          domain:             domain,
        });

        if (candidates.length === 0) {
          await log(db, runId, `${name}: nenhum decisor real encontrado na base — empresa marcada para coleta posterior`);
          await db.update(garimpoRuns).set({ companiesScanned }).where(eq(garimpoRuns.id, runId));
          continue;
        }

        await log(db, runId, `${name}: ${candidates.length} candidato(s) real(is) via ${candidates[0]!.source} — melhor aderência: ${candidates[0]!.adherenceScore}%`);

        // ── 5. For each candidate: match identity + find contacts ────────
        for (const candidate of candidates.slice(0, 3)) {
          if (maxContacts && contactsFound >= maxContacts) {
            await log(db, runId, `Teto definido pelo gestor atingido (${maxContacts} contatos) — encerrando.`);
            limitReached = true;
            break;
          }
          if (quotaRemaining <= 0) {
            await log(db, runId, `Saldo de personas esgotado durante a run — encerrando. Compre um pacote adicional pra continuar.`);
            limitReached = true;
            break;
          }

          // Identity check
          const identity = matchIdentity({
            firstName:          candidate.firstName,
            lastName:           candidate.lastName,
            jobTitle:           candidate.jobTitle,
            companyName:        name,
            companyDomain:      domain || undefined,
            linkedinUrl:        candidate.linkedinUrl,
            escavadorConfirmed: candidate.source === "escavador",
          });

          // Deduplication check
          const [existing] = await db
            .select({ id: contacts.id })
            .from(contacts)
            .where(
              and(
                eq(contacts.teamId, teamId),
                eq(contacts.companyName, name),
                eq(contacts.jobTitle, candidate.jobTitle)
              )
            )
            .limit(1);

          let contactId = existing?.id;

          if (!contactId) {
            // Insert skeleton contact first (we'll update with enriched data)
            const [newContact] = await db
              .insert(contacts)
              .values({
                firstName:     candidate.firstName,
                lastName:      candidate.lastName,
                email:         candidate.email ?? null,
                phone:         candidate.phone ?? null,
                linkedinUrl:   candidate.linkedinUrl ?? null,
                companyName:   name,
                companyDomain: domain ?? null,
                jobTitle:      candidate.jobTitle,
                source:        "garimpo",
                userId,
                teamId,
                enrichmentData: {
                  technologies:     techs,
                  cnpj:             cnpj ?? undefined,
                  identityScore:    identity.score,
                  identitySignals:  identity.signals,
                  adherenceScore:   candidate.adherenceScore,
                  source_detail:    candidate.source,
                },
              })
              .returning({ id: contacts.id });

            contactId = newContact.id;
            contactsFound++;
            quotaRemaining--;
          }

          // ── 6. Find professional contacts ─────────────────────────────────
          const contactData = await findContact({
            firstName:   candidate.firstName,
            lastName:    candidate.lastName,
            jobTitle:    candidate.jobTitle,
            companyName: name,
            companyId:   resolved?.id,
            domain:      domain || undefined,
            cnpj:        cnpj ?? undefined,
            linkedinUrl: candidate.linkedinUrl,
            city:        company.city ?? persona.targetCities?.[0] ?? undefined,
            contactId,
          });

          // Update contact with enriched data
          if (contactData.email || contactData.phone) {
            await db
              .update(contacts)
              .set({
                email: contactData.email ?? candidate.email ?? undefined,
                phone: contactData.phone ?? candidate.phone ?? undefined,
                updatedAt: new Date(),
                enrichmentData: {
                  technologies:     techs,
                  cnpj:             cnpj ?? undefined,
                  identityScore:    identity.score,
                  adherenceScore:   candidate.adherenceScore,
                  source_detail:    candidate.source,
                  emailConfidence:  contactData.emailConf,
                  phoneConfidence:  contactData.phoneConf,
                  whatsapp:         contactData.whatsapp ?? undefined,
                  allEmails:        contactData.allEmails.map((e) => e.address),
                  allPhones:        contactData.allPhones.map((p) => p.number),
                  enrichmentSources: contactData.sources,
                  fromCache:        contactData.fromCache,
                },
              })
              .where(eq(contacts.id, contactId));
          }

          // Add to list — enforce plan limit
          const currentListSize = await getListContactCount(listId);
          if (currentListSize >= contactsPerList) {
            await log(db, runId, `Limite do plano ${teamPlan} atingido (${contactsPerList} contatos/lista) — encerrando`);
            limitReached = true;
            break;
          }
          await db
            .insert(listContacts)
            .values({ listId, contactId, addedBy: userId })
            .onConflictDoNothing();
        }

        // Update run progress
        await db
          .update(garimpoRuns)
          .set({ contactsFound, companiesScanned })
          .where(eq(garimpoRuns.id, runId));

        if (limitReached) break;

        } catch (companyErr) {
          const msg = (companyErr as Error).message?.slice(0, 160) ?? "erro desconhecido";
          console.error(`[garimpo] empresa "${name}":`, companyErr);
          await log(db, runId, `Erro "${name}": ${msg}`);
        }
      }

      // Debit quota for what was actually delivered (drains monthly first, then extra)
      await debitPersonaQuota(db, teams, teamId, contactsFound);

      await log(db, runId, `Concluído: ${contactsFound} contatos encontrados em ${companiesScanned} empresas`
        + (companiesSkippedNoSite ? ` (${companiesSkippedNoSite} puladas por não ter site)` : ""));
      await db
        .update(garimpoRuns)
        .set({ status: "done", contactsFound, companiesScanned, completedAt: new Date() })
        .where(eq(garimpoRuns.id, runId));
    },
    { connection: createRedis(), concurrency: 2 }
  );

  worker.on("failed", async (job, err) => {
    if (job) {
      const db = getDb();
      await db
        .update(garimpoRuns)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(garimpoRuns.id, job.data.runId));
    }
  });

  return worker;
}
