// Núcleo compartilhado do enriquecimento PAGO (telefone/email de pessoa via
// fonte externa). Usado tanto pelo botão "Enriquecer Contato" sob demanda
// (routes/contacts.ts) quanto pelo Garimpo em lote (workers/garimpo.ts).
//
// Garantias deste helper:
//   • Cache por cacheKey (TTL 90d) — não cobra 2x. O cacheKey é o MESMO usado
//     pelo enriquecimento sob demanda, então as duas frentes compartilham cache.
//   • Teto mensal por time (ENRICH_MONTHLY_CAP) — proteção de custo (pool R$550).
//   • A fonte (provedor) nunca é exposta ao chamador além do que ele decidir.
//
// ⚠️ COMPLIANCE Assertiva (cláusulas 7.5/7.6/7.9): o dado retornado só pode
// viver em cache operacional com TTL (tabela paid_enrichments) e no registro do
// contato do cliente. NUNCA persistir na base permanente compartilhada
// (enr_people) — por isso este helper só grava no cache; quem chama decide o que
// fazer com o resultado, mas não deve alimentar a enr_people com ele.

import { createHash } from "crypto";
import { getDb, paidEnrichments } from "@limo/db";
import { and, count, desc, eq, gt } from "drizzle-orm";
import { getEnrichmentProvider } from "./providers/index.js";
import type { EnrichedEmail, EnrichedPhone } from "./providers/types.js";

export type PaidEnrichStatus =
  | "ok"             // consultou (ou achou no cache) sem erro
  | "no_provider"    // nenhum provedor configurado (sem credenciais)
  | "cap_reached"    // teto mensal do time atingido
  | "provider_error" // o provedor falhou
  | "no_name";       // sem nome suficiente pra consultar

export interface PaidEnrichInput {
  teamId:       string;
  contactId?:   string | null;
  firstName:    string;
  lastName:     string;
  companyName?: string | null;
  cnpj?:        string | null;
  city?:        string | null;
  state?:       string | null;
}

export interface PaidEnrichOutput {
  status:           PaidEnrichStatus;
  matched:          boolean;
  phones:           EnrichedPhone[];
  emails:           EnrichedEmail[];
  matchConfidence?: number;
  fromCache:        boolean;
}

const empty = (status: PaidEnrichStatus): PaidEnrichOutput => ({
  status, matched: false, phones: [], emails: [], fromCache: false,
});

function nrm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

// Chave de cache estável: nome normalizado + CNPJ (ou empresa, na falta de CNPJ).
// Idêntica à usada no enriquecimento sob demanda — garante cache compartilhado.
export function paidEnrichCacheKey(
  firstName: string,
  lastName: string,
  cnpj?: string | null,
  companyName?: string | null,
): string {
  return createHash("sha1")
    .update([nrm(firstName), nrm(lastName), cnpj ?? nrm(companyName ?? "")].join("|"))
    .digest("hex")
    .slice(0, 40);
}

export async function enrichPersonPaid(
  db: ReturnType<typeof getDb>,
  input: PaidEnrichInput,
): Promise<PaidEnrichOutput> {
  const firstName = (input.firstName ?? "").trim();
  const lastName  = (input.lastName ?? "").trim();
  if (!firstName && !lastName) return empty("no_name");

  const enricher = getEnrichmentProvider();
  if (!enricher) return empty("no_provider");

  const cnpj = input.cnpj ?? undefined;
  const cacheKey = paidEnrichCacheKey(firstName, lastName, cnpj, input.companyName);

  // 1) Cache (TTL 90d) — não cobra 2x dentro da janela.
  const [cached] = await db.select().from(paidEnrichments)
    .where(and(eq(paidEnrichments.cacheKey, cacheKey), gt(paidEnrichments.expiresAt, new Date())))
    .orderBy(desc(paidEnrichments.createdAt))
    .limit(1);

  if (cached) {
    const r = (cached.result ?? {}) as any;
    return {
      status: "ok",
      matched: Boolean(cached.matched),
      phones: r.phones ?? [],
      emails: r.emails ?? [],
      matchConfidence: r.matchConfidence,
      fromCache: true,
    };
  }

  // 2) Teto mensal por time (proteção de custo). Cache hits não contam; toda
  // consulta nova conta (inclusive sem match), evitando martelar nomes ruins.
  const cap = Number(process.env.ENRICH_MONTHLY_CAP ?? 1000);
  const since = new Date(); since.setDate(1); since.setHours(0, 0, 0, 0);
  const [{ n }] = await db.select({ n: count() }).from(paidEnrichments)
    .where(and(eq(paidEnrichments.teamId, input.teamId), gt(paidEnrichments.createdAt, since)));
  if (Number(n) >= cap) return empty("cap_reached");

  // 3) Consulta o provedor.
  let r;
  try {
    r = await enricher.enrichPerson({
      firstName, lastName,
      companyName: input.companyName ?? undefined,
      cnpj,
      city:  input.city  ?? undefined,
      state: input.state ?? undefined,
    });
  } catch {
    return empty("provider_error");
  }

  const result = { phones: r.phones, emails: r.emails, matchConfidence: r.matchConfidence, matched: r.matched };
  await db.insert(paidEnrichments).values({
    teamId:    input.teamId,
    contactId: input.contactId ?? null,
    cacheKey,
    provider:  enricher.id,
    matched:   r.matched,
    result,
    expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000),
  });

  return {
    status: "ok",
    matched: r.matched,
    phones: r.phones,
    emails: r.emails,
    matchConfidence: r.matchConfidence,
    fromCache: false,
  };
}
