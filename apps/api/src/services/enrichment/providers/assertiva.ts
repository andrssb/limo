import type { EnrichmentProvider, PersonQuery, EnrichmentResult, EnrichedPhone, EnrichedEmail } from "./types.js";

// Adapter Assertiva Localize V3. Credenciais via env:
//   ASSERTIVA_CLIENT_ID, ASSERTIVA_CLIENT_SECRET  (Basic auth → bearer token OAuth2)
//   ASSERTIVA_BASE_URL    (default https://api.assertivasolucoes.com.br)
//   ASSERTIVA_FINALIDADE  (default "5" = Legítimo interesse — base LGPD pra
//                          prospecção/marketing. NUNCA "2"=ciclo de crédito, que
//                          viola a finalidade contratada. Opções: 1=conf. identidade,
//                          2=ciclo de crédito, 4=execução de contrato, 5=legítimo interesse.)
//
// Fluxo (confirmado por calibração real em 2026-06-09, doc:
//   integracao.assertivasolucoes.com.br/v3/swagger/localize/swagger.json):
//   1) GET /localize/v3/nome-endereco  → resolve nome (+uf/cidade) → CPF da pessoa
//   2) GET /localize/v3/cpf            → telefones (móveis/fixos) + emails
// São DUAS consultas por pessoa (impacta o teto de custo). Por isso o orquestrador
// só chama quando vai usar (contato sem telefone E sem email).

const BASE_URL = process.env.ASSERTIVA_BASE_URL ?? "https://api.assertivasolucoes.com.br";
const ID_FINALIDADE = process.env.ASSERTIVA_FINALIDADE ?? "5"; // Legítimo interesse

// ─── Token OAuth2 (cache em memória até expirar) ─────────────────────────────
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) return cachedToken.value;

  const id = process.env.ASSERTIVA_CLIENT_ID!;
  const secret = process.env.ASSERTIVA_CLIENT_SECRET!;
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");

  const res = await fetch(`${BASE_URL}/oauth2/v3/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Assertiva auth ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }

  const data: any = await res.json();
  const token = data.access_token ?? data.token;
  const ttlMs = (Number(data.expires_in) || 3600) * 1000;
  if (!token) throw new Error("Assertiva auth: sem access_token na resposta");

  cachedToken = { value: token, expiresAt: now + ttlMs };
  return token;
}

function digits(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "");
}

async function get(path: string, params: Record<string, string>, token: string): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE_URL}${path}?${qs}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Assertiva ${path} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  return res.json();
}

// ─── Etapa 1: nome (+uf/cidade) → CPF ────────────────────────────────────────
// Desambiguação: prefere quem bate cidade, depois UF. Sem nenhum filtro batendo
// e com >1 candidato, NÃO escolhe (evita entregar contato da pessoa errada).
function pickCpf(
  pessoas: any[],
  wantCity?: string,
  wantUf?: string,
): { cpf: string; confidence: number } | null {
  if (!Array.isArray(pessoas) || pessoas.length === 0) return null;

  const upr = (s: unknown) => String(s ?? "").toUpperCase().trim();
  const city = upr(wantCity), uf = upr(wantUf);

  if (pessoas.length === 1) {
    const cpf = digits(pessoas[0]?.cpf);
    return cpf ? { cpf, confidence: 85 } : null;
  }

  const byCity = city ? pessoas.filter((p) => upr(p?.cidade) === city) : [];
  if (byCity.length === 1) return { cpf: digits(byCity[0].cpf), confidence: 75 };

  const byUf = uf ? (byCity.length ? byCity : pessoas).filter((p) => upr(p?.uf) === uf) : [];
  if (byUf.length === 1) return { cpf: digits(byUf[0].cpf), confidence: 60 };

  // Ambíguo demais — não arrisca entregar a pessoa errada.
  return null;
}

// ─── Etapa 2: parsing da resposta do /localize/v3/cpf ────────────────────────
function parsePhones(resp: any): EnrichedPhone[] {
  const out: EnrichedPhone[] = [];
  const seen = new Set<string>();
  const push = (arr: any, kind: string) => {
    if (!Array.isArray(arr)) return;
    for (const p of arr) {
      // Respeita "não perturbe" (Procon/bloqueio): não entrega esses números.
      if (p?.naoPerturbe === true) continue;
      const number = digits(p?.numero);
      if (number.length < 10 || seen.has(number)) continue;
      seen.add(number);
      out.push({ number, kind });
    }
  };
  // Celulares primeiro (maior valor pra prospecção), depois fixos.
  push(resp?.telefones?.moveis, "mobile");
  push(resp?.telefones?.fixos, "landline");
  return out;
}

function parseEmails(resp: any): EnrichedEmail[] {
  const out: EnrichedEmail[] = [];
  const seen = new Set<string>();
  for (const e of [...(resp?.emails ?? []), ...(resp?.emailsAdicionados ?? [])]) {
    const address = String(e?.email ?? "").toLowerCase().trim();
    if (/.+@.+\..+/.test(address) && !seen.has(address)) {
      seen.add(address);
      out.push({ address });
    }
  }
  return out;
}

export const assertiva: EnrichmentProvider = {
  id: "assertiva",

  isConfigured() {
    return Boolean(process.env.ASSERTIVA_CLIENT_ID && process.env.ASSERTIVA_CLIENT_SECRET);
  },

  async enrichPerson(q: PersonQuery): Promise<EnrichmentResult> {
    const fullName = `${q.firstName} ${q.lastName}`.trim();
    if (!fullName) return { matched: false, phones: [], emails: [] };

    const token = await getToken();

    // ── Etapa 1: nome → CPF ──────────────────────────────────────────────────
    const nameParams: Record<string, string> = {
      buscarPor: "pessoas",
      nomeOuRazaoSocial: fullName,
      idFinalidade: ID_FINALIDADE,
    };
    if (q.state) nameParams.uf = q.state;
    if (q.city) nameParams.cidade = q.city;

    const nameData = await get("/localize/v3/nome-endereco", nameParams, token);
    const pessoas: any[] = nameData?.resposta?.pessoaFisica ?? [];
    const match = pickCpf(pessoas, q.city, q.state);
    if (!match) return { matched: false, phones: [], emails: [], raw: nameData };

    // ── Etapa 2: CPF → telefones + emails ────────────────────────────────────
    const cpfData = await get(
      "/localize/v3/cpf",
      { cpf: match.cpf, idFinalidade: ID_FINALIDADE },
      token,
    );
    const resp = cpfData?.resposta ?? {};
    const phones = parsePhones(resp);
    const emails = parseEmails(resp);

    return {
      matched: phones.length > 0 || emails.length > 0,
      matchConfidence: match.confidence,
      phones,
      emails,
      raw: resp,
    };
  },
};
