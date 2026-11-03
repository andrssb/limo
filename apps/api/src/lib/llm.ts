import { groq, MODELS } from "./groq.js";
import { anthropic, CLAUDE_ENABLED, CLAUDE_MODELS } from "./anthropic.js";

// Roteador de provider único do app Limo. Regra:
// - askClaude     → Claude Sonnet 4.6  : qualidade que o cliente paga
// - askClaudeFast → Claude Haiku 4.5   : client-facing latência-sensível (coach ao vivo)
// - askFast       → Groq Llama instant : descartável (resumos internos)
// Claude sempre cai no Groq se a chave for placeholder ou a chamada falhar.

export const DEFAULT_SYSTEM =
  "Você é um assistente especializado em vendas B2B e coaching de BDRs. Responda sempre em português brasileiro.";

const MAX_TOKENS = 8192;

interface AskOpts {
  maxTokens?: number;
  temperature?: number;
}

// Groq cru — descartável e fallback. `model` default smart (llama-3.3-70b).
export async function askGroq(prompt: string, systemPrompt: string, model: string = MODELS.smart, opts: AskOpts = {}): Promise<string> {
  const response = await groq.chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? MAX_TOKENS,
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: prompt },
    ],
  });
  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("No text response from Groq");
  return text;
}

// Descartável (resumos internos) → nunca vale Claude.
export async function askFast(prompt: string, systemPrompt: string = DEFAULT_SYSTEM, opts: AskOpts = {}): Promise<string> {
  return askGroq(prompt, systemPrompt, MODELS.fast, opts);
}

async function askClaudeTier(
  claudeModel: string,
  groqFallbackModel: string,
  prompt: string,
  systemPrompt: string,
  opts: AskOpts,
): Promise<string> {
  if (CLAUDE_ENABLED) {
    try {
      const response = await anthropic.messages.create({
        model: claudeModel,
        max_tokens: opts.maxTokens ?? MAX_TOKENS,
        system: systemPrompt,
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      if (text.trim()) return text;
      console.error("[llm] Claude retornou vazio, caindo no Groq");
    } catch (err) {
      console.error("[llm] Claude falhou, caindo no Groq:", err);
    }
  }
  return askGroq(prompt, systemPrompt, groqFallbackModel, opts);
}

// Qualidade que o cliente paga (coach pós-call, qualificação, relatórios, conteúdo).
export async function askClaude(prompt: string, systemPrompt?: string, opts: AskOpts = {}): Promise<string> {
  return askClaudeTier(CLAUDE_MODELS.smart, MODELS.smart, prompt, systemPrompt ?? DEFAULT_SYSTEM, opts);
}

// Client-facing latência-sensível (coach AO VIVO durante a ligação).
export async function askClaudeFast(prompt: string, systemPrompt?: string, opts: AskOpts = {}): Promise<string> {
  return askClaudeTier(CLAUDE_MODELS.fast, MODELS.fast, prompt, systemPrompt ?? DEFAULT_SYSTEM, opts);
}
