import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

// Cliente Claude — usado no que o CLIENTE consome/paga (coach, análise de call,
// qualificação, relatórios, conteúdo). O descartável (resumos internos) continua
// no Groq/Llama. Ver o roteador em lib/llm.ts.
export const anthropic = new Anthropic({
  apiKey: config.ANTHROPIC_API_KEY,
});

// Liga a Claude só quando há chave real. Com placeholder, o ai.ts cai no Groq
// automaticamente — dá pra deployar antes de setar a chave sem quebrar nada.
export const CLAUDE_ENABLED = !config.ANTHROPIC_API_KEY.startsWith("sk-ant-placeholder");

export const CLAUDE_MODELS = {
  // Sonnet no que o cliente paga (custo/qualidade calibrado).
  smart: "claude-sonnet-4-6",
  // Latência-sensível e client-facing (coach AO VIVO): Haiku é rápido o bastante
  // pra tempo real e muito acima do Llama. Ver o roteador em lib/llm.ts.
  fast: "claude-haiku-4-5",
} as const;
