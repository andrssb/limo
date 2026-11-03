import type { EnrichmentProvider, PersonQuery, EnrichmentResult, EnrichedPhone, EnrichedEmail } from "./types.js";

// Adapter BigDataCorp (Plataforma BigBoost). Credenciais via env:
//   BIGDATACORP_ACCESS_TOKEN, BIGDATACORP_TOKEN_ID
// Cobra por dataset × entidade retornada — por isso pedimos só os datasets de contato.
//
// ⚠️ Os nomes exatos de datasets/campos da resposta precisam ser confirmados com a
// chave real (a doc é fechada). O parsing abaixo é defensivo e fácil de ajustar.

const BASE_URL  = process.env.BIGDATACORP_BASE_URL ?? "https://plataforma.bigdatacorp.com.br";
const DATASETS  = "basic_data, phones_extended, emails_extended";

function norm(s?: string | null): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

function toPhones(raw: any): EnrichedPhone[] {
  const arr = raw?.Phones ?? raw?.phones ?? [];
  const list = Array.isArray(arr) ? arr : (arr?.Phones ?? []);
  return (list as any[])
    .map((p) => ({
      number:     String(p.Number ?? p.number ?? p.PhoneNumber ?? "").replace(/\D/g, ""),
      kind:       p.Type ?? p.type,
      confidence: typeof p.ContactScore === "number" ? p.ContactScore
                 : typeof p.confidence === "number"  ? p.confidence : undefined,
    }))
    .filter((p) => p.number.length >= 10)
    // melhor confiança primeiro (o ranking de "melhor telefone")
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
}

function toEmails(raw: any): EnrichedEmail[] {
  const arr = raw?.Emails ?? raw?.emails ?? [];
  const list = Array.isArray(arr) ? arr : (arr?.Emails ?? []);
  return (list as any[])
    .map((e) => ({
      address:    String(e.EmailAddress ?? e.Email ?? e.address ?? "").toLowerCase().trim(),
      confidence: typeof e.ContactScore === "number" ? e.ContactScore : undefined,
    }))
    .filter((e) => /.+@.+\..+/.test(e.address))
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
}

export const bigDataCorp: EnrichmentProvider = {
  id: "bdc",

  isConfigured() {
    return Boolean(process.env.BIGDATACORP_ACCESS_TOKEN && process.env.BIGDATACORP_TOKEN_ID);
  },

  async enrichPerson(q: PersonQuery): Promise<EnrichmentResult> {
    const fullName = `${q.firstName} ${q.lastName}`.trim();
    if (!fullName) return { matched: false, phones: [], emails: [] };

    // Busca por nome (sem CPF). Filtros opcionais ajudam a desambiguar.
    let query = `name{${norm(fullName)}}`;
    if (q.state) query += `,state{${norm(q.state)}}`;

    const res = await fetch(`${BASE_URL}/pessoas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        AccessToken: process.env.BIGDATACORP_ACCESS_TOKEN!,
        TokenId:     process.env.BIGDATACORP_TOKEN_ID!,
      },
      body: JSON.stringify({ Datasets: DATASETS, q: query, Limit: 5 }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      throw new Error(`BigDataCorp ${res.status}: ${(await res.text()).slice(0, 160)}`);
    }

    const data: any = await res.json();
    const results: any[] = data?.Result ?? data?.result ?? [];
    if (results.length === 0) return { matched: false, phones: [], emails: [], raw: data };

    // Desambiguação simples: se houver cidade/estado, prefere o match que bate.
    const wantCity = norm(q.city);
    const best = results.find((r) => {
      const addr = r.BasicData?.Addresses?.[0] ?? r.Addresses?.[0];
      return wantCity && norm(addr?.City) === wantCity;
    }) ?? results[0];

    const phones = toPhones(best);
    const emails = toEmails(best);
    const matched = phones.length > 0 || emails.length > 0;

    return {
      matched,
      matchConfidence: best?.MatchKeys ? 80 : 60,  // heurística; refina com a chave real
      phones,
      emails,
      raw: best,
    };
  },
};
