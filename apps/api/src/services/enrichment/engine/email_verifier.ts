// Verificação de e-mail via Abstract Email Reputation. O motor gera e-mails por
// padrão MX (nome.sobrenome@domínio) com confiança "baixa" (palpite). Esta camada
// checa se o e-mail é entregável de verdade e sobe a confiança: "valid" → alta,
// "catchall" → media. Sem chave OU erro/limite, retorna null e o motor mantém o
// palpite antigo (degrada com segurança — nunca quebra o fluxo).

import { config } from "../../../config.js";

export type EmailVerdict = "valid" | "invalid" | "disposable" | "catchall" | "unknown";

export function emailVerifierConfigured(): boolean {
  return Boolean(config.ABSTRACT_EMAIL_API_KEY);
}

// Verifica UM e-mail. null = indisponível (sem chave, rate-limit, ou erro).
async function verifyOne(email: string): Promise<EmailVerdict | null> {
  if (!config.ABSTRACT_EMAIL_API_KEY) return null;
  try {
    const url =
      `https://emailreputation.abstractapi.com/v1/` +
      `?api_key=${config.ABSTRACT_EMAIL_API_KEY}&email=${encodeURIComponent(email)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null; // inclui 429 (rate-limit do free tier) → degrada
    const j: any = await res.json();
    const status: string | undefined = j?.email_deliverability?.status;
    const q: any = j?.email_quality ?? {};
    if (!status) return null;
    if (q.is_disposable === true)  return "disposable";
    if (status === "undeliverable") return "invalid";
    if (status === "deliverable")   return q.is_catchall === true ? "catchall" : "valid";
    return "unknown";
  } catch {
    return null;
  }
}

// Verifica candidatos em ordem, para no 1º "valid". Guarda um "catchall" como
// 2ª opção. Teto de chamadas (max) p/ controlar crédito. Retorna o melhor
// entregável, ou null (todos ruins OU verificação indisponível).
export async function pickVerifiedEmail(
  candidates: string[],
  max = 3,
): Promise<{ email: string; verdict: EmailVerdict } | null> {
  let catchall: { email: string; verdict: EmailVerdict } | null = null;
  let tried = 0;
  for (const email of candidates) {
    if (tried >= max) break;
    const verdict = await verifyOne(email);
    tried++;
    if (verdict === null) return null; // indisponível (sem crédito) — nem insiste
    if (verdict === "valid") return { email, verdict };
    if (verdict === "catchall" && !catchall) catchall = { email, verdict };
  }
  return catchall;
}
