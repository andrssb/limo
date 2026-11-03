import { getDb } from "@limo/db";
import { productMaterials, salesInsights, coachingKnowledge } from "@limo/db";
import { eq, desc } from "drizzle-orm";
import { askClaude, askClaudeFast } from "../lib/llm.js";

export interface CoachingTip {
  type: "question" | "technique" | "objection" | "mirror" | "close";
  label: string;
  content: string;
  urgency: "high" | "medium" | "low";
}

export async function getTeamKnowledgeContext(teamId: string): Promise<string> {
  const db = getDb();

  const materials = await db.select({ aiSummary: productMaterials.aiSummary, title: productMaterials.title })
    .from(productMaterials)
    .where(eq(productMaterials.teamId, teamId))
    .limit(10);

  const insights = await db.select({ category: salesInsights.category, title: salesInsights.title, insight: salesInsights.insight })
    .from(salesInsights)
    .where(eq(salesInsights.teamId, teamId))
    .orderBy(desc(salesInsights.createdAt))
    .limit(30);

  // Parse product JSON summaries into readable format
  const productParts: string[] = [];
  for (const m of materials.filter((m) => m.aiSummary)) {
    try {
      const parsed = JSON.parse(m.aiSummary!);
      const parts = [
        `Produto: ${parsed.produto ?? m.title ?? "—"}`,
        `Descrição: ${parsed.descricao ?? "—"}`,
        `Proposta de valor: ${parsed.proposta_valor ?? "—"}`,
        parsed.dores_resolvidas?.length ? `Dores que resolve: ${(parsed.dores_resolvidas as string[]).join("; ")}` : "",
        parsed.diferenciais?.length ? `Diferenciais: ${(parsed.diferenciais as string[]).join("; ")}` : "",
        parsed.publico_alvo ? `Público-alvo: ${parsed.publico_alvo}` : "",
        parsed.objecoes_comuns?.length
          ? `Objeções comuns e respostas:\n${(parsed.objecoes_comuns as string[]).map((o: string) => `  - ${o}`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n");
      productParts.push(parts);
    } catch {
      productParts.push(`[${m.title ?? "Produto"}]: ${m.aiSummary}`);
    }
  }

  // Group playbook insights by category
  const byCategory: Record<string, string[]> = {};
  for (const i of insights) {
    const cat = i.category ?? "geral";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(`• ${i.title}: ${i.insight}`);
  }
  const playbookParts = Object.entries(byCategory)
    .map(([cat, items]) => `[${cat.toUpperCase()}]\n${items.join("\n")}`)
    .join("\n\n");

  const productContext = productParts.join("\n\n---\n\n");
  const playbookContext = playbookParts;

  // Coaching knowledge enrichment
  const knowledgeRows = await db.select({ aiSummary: coachingKnowledge.aiSummary, title: coachingKnowledge.title })
    .from(coachingKnowledge)
    .where(eq(coachingKnowledge.teamId, teamId))
    .orderBy(desc(coachingKnowledge.createdAt))
    .limit(15);

  const knowledgeContext = knowledgeRows
    .filter((k) => k.aiSummary)
    .map((k) => `[${k.title ?? "Material"}]: ${k.aiSummary}`)
    .join("\n\n");

  return [
    "=== PRODUTO / SERVIÇO QUE ESTÁ SENDO VENDIDO ===",
    productContext || "Nenhum material de produto cadastrado. Use conhecimento geral de vendas.",
    "\n=== PLAYBOOK DE VENDAS DO TIME ===",
    playbookContext || "Nenhum insight de playbook cadastrado ainda.",
    "\n=== CONHECIMENTO DE VENDAS (materiais de enriquecimento) ===",
    knowledgeContext || "Nenhum material de enriquecimento ainda.",
  ].join("\n");
}

const SPIN_AIDA = `
=== FRAMEWORKS DE VENDAS OBRIGATÓRIOS ===

SPIN SELLING (use para qualificação e descoberta):
- S - SITUAÇÃO: Perguntas para entender o contexto atual do lead ("Qual ferramenta você usa hoje?")
- P - PROBLEMA: Perguntas para revelar dores ("O que mais te frustra no processo atual?")
- I - IMPLICAÇÃO: Perguntas que ampliam a dor ("O que acontece quando essa falha ocorre?")
- N - NECESSIDADE DE SOLUÇÃO: Perguntas que fazem o lead querer resolver ("Quanto valeria resolver isso?")

AIDA (use para estruturar a abordagem):
- A - ATENÇÃO: Abra com um insight ou dado que chame atenção ("Empresas como a sua perdem X por mês com...")
- I - INTERESSE: Conecte com a dor específica do lead ("Vi que vocês estão em expansão e...")
- D - DESEJO: Mostre o resultado que o lead pode ter ("Com nossos clientes, o resultado foi...")
- A - AÇÃO: Peça o próximo passo de forma direta ("Faz sentido marcar 20 minutos para te mostrar?")

GESTÃO DE OBJEÇÕES (sempre use):
- "Muito caro": "Comparado ao que você gasta hoje com [problema], qual seria o custo de continuar assim?"
- "Não é o momento": "O que precisa mudar para que seja o momento? O que está travando?"
- "Já temos solução": "O que sua solução atual ainda não resolve bem?"
- "Preciso pensar": "O que falta para você tomar uma decisão? O que eu ainda não esclareci?"
`;

// Export SPIN_AIDA for use in prompt
export { SPIN_AIDA };

export async function generateCoachingTips(
  recentTranscript: string,
  fullTranscript: string,
  teamKnowledge: string
): Promise<CoachingTip[]> {
  if (!recentTranscript.trim()) return [];

  const prompt = `Você é um coach de vendas em tempo real para um BDR brasileiro. Sua missão é gerar 2-3 sugestões IMEDIATAS e ESPECÍFICAS para o que está acontecendo AGORA na ligação.

${SPIN_AIDA}

${teamKnowledge}

=== HISTÓRICO COMPLETO DA LIGAÇÃO ===
${fullTranscript.slice(-3000)}

=== O QUE FOI DITO AGORA (últimos 10 segundos) ===
${recentTranscript}

REGRAS PARA AS SUGESTÕES:
1. Use o conhecimento do PRODUTO acima para responder objeções com argumentos específicos do produto/serviço
2. Use as técnicas do PLAYBOOK cadastrado para o time
3. Seja CIRÚRGICO: a sugestão deve servir exatamente para este momento da ligação
4. Use linguagem DIRETA — o BDR vai ler e agir em segundos
5. Se o lead mencionou uma dor ou desafio, use a proposta de valor e diferenciais do produto para conectar
6. Se houver objeção de preço/tempo/concorrente → responda com o diferencial específico do produto

PRIORIDADE DE ANÁLISE:
- Objeção detectada → técnica de contorno COM argumento específico do produto
- Qualificando lead → próxima pergunta BANT/SPIN relevante para o produto
- Lead demonstrou interesse → como avançar para o próximo passo
- Silêncio ou hesitação → espelhamento ou pergunta aberta
- Início da ligação → como abrir valor e gerar curiosidade

Responda SOMENTE em JSON válido:
{
  "tips": [
    {
      "type": "question|technique|objection|mirror|close",
      "label": "título curto (máx 5 palavras)",
      "content": "o que o BDR deve dizer ou fazer agora — seja específico e direto (máx 2-3 frases)",
      "urgency": "high|medium|low"
    }
  ]
}`;

  try {
    // Coach AO VIVO → Haiku (latência-sensível, roda a cada ~10s na ligação).
    const raw = await askClaudeFast(
      prompt,
      "Você é um coach de vendas experiente especializado em BDR B2B brasileiro. Suas sugestões são sempre específicas, práticas e baseadas no contexto do produto e do playbook do time. Responda apenas em JSON.",
      { maxTokens: 768, temperature: 0.4 },
    );
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    return parsed.tips ?? [];
  } catch {
    return [];
  }
}

export async function processProductMaterial(
  title: string | null,
  sourceUrl: string | null,
  rawContent: string | null
): Promise<string> {
  const content = rawContent ?? (sourceUrl ? `URL: ${sourceUrl}` : "");

  const prompt = `Analise o material sobre o produto/empresa abaixo e extraia um resumo estruturado para usar no coaching de vendas.

Título: ${title ?? "Material de produto"}
Conteúdo: ${content.slice(0, 4000)}

Responda em JSON:
{
  "produto": "nome do produto/empresa",
  "descricao": "o que faz em 1-2 frases",
  "proposta_valor": "proposta de valor principal",
  "dores_resolvidas": ["dor 1", "dor 2", "dor 3"],
  "diferenciais": ["diferencial 1", "diferencial 2"],
  "publico_alvo": "quem compra e por quê",
  "objecoes_comuns": ["objeção 1 e como responder", "objeção 2 e como responder"]
}`;

  return askClaude(prompt);
}

export async function processCoachingMaterial(
  title: string | null,
  rawContent: string | null
): Promise<string> {
  const content = rawContent ?? "";
  if (!content.trim()) return "";

  const prompt = `Analise o material de vendas abaixo e extraia técnicas, frameworks e insights que um BDR pode usar no coaching ao vivo.

Título: ${title ?? "Material de coaching"}
Conteúdo: ${content.slice(0, 6000)}

Extraia:
1. Técnicas específicas de vendas (cold call, rapport, qualificação, fechamento)
2. Frameworks mencionados (SPIN, AIDA, BANT, Challenger, etc.)
3. Scripts ou frases-chave que o BDR pode usar
4. Estratégias para lidar com objeções específicas
5. Princípios de psicologia de vendas relevantes

Responda em JSON:
{
  "tecnicas": ["técnica 1 explicada brevemente", "técnica 2..."],
  "frameworks": ["framework e como aplicar..."],
  "scripts": ["frase ou script que o BDR pode usar..."],
  "objecoes": ["objeção → como responder segundo este material"],
  "principios": ["princípio de psicologia/vendas relevante"]
}`;

  const raw = await askClaude(
    prompt,
    "Você é especialista em metodologias de vendas consultivas B2B. Extraia insights práticos e acionáveis para BDRs brasileiros.",
  );
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return raw;

  try {
    const parsed = JSON.parse(match[0]);
    const sections: string[] = [];
    if (parsed.tecnicas?.length) sections.push(`Técnicas: ${(parsed.tecnicas as string[]).join(" | ")}`);
    if (parsed.frameworks?.length) sections.push(`Frameworks: ${(parsed.frameworks as string[]).join(" | ")}`);
    if (parsed.scripts?.length) sections.push(`Scripts: ${(parsed.scripts as string[]).join(" | ")}`);
    if (parsed.objecoes?.length) sections.push(`Objeções: ${(parsed.objecoes as string[]).join(" | ")}`);
    if (parsed.principios?.length) sections.push(`Princípios: ${(parsed.principios as string[]).join(" | ")}`);
    return sections.join("\n");
  } catch {
    return raw.slice(0, 2000);
  }
}

export async function generatePlaybookInsights(
  creatorName: string,
  specialty: string | null,
  recentContent: string
): Promise<{ category: string; title: string; insight: string }[]> {
  const prompt = `Você é especialista em metodologias de vendas. Com base nas informações abaixo sobre ${creatorName}, extraia 5-8 insights práticos e acionáveis para um BDR brasileiro.

Especialidade: ${specialty ?? "Vendas B2B, cold call, prospecção"}

Conteúdo recente / metodologia conhecida:
${recentContent}

Categorias possíveis: cold_call, objection_handling, mirroring, qualification, rapport, closing, mindset

Responda em JSON:
{
  "insights": [
    {
      "category": "cold_call",
      "title": "título curto e memorável",
      "insight": "técnica ou princípio explicado de forma prática com exemplo (2-4 frases)"
    }
  ]
}`;

  try {
    const raw = await askClaude(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    return parsed.insights ?? [];
  } catch {
    return [];
  }
}
