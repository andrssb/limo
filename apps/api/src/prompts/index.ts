import type { TranscriptSegment, LeadTemperature, ContentType } from "@limo/types";

// ─── Call Analysis ────────────────────────────────────────────────────────────

export function buildCallAnalysisPrompt(params: {
  segments: TranscriptSegment[];
  contactName: string;
  companyName: string | null;
  jobTitle: string | null;
  durationSeconds: number;
  previousInteractionsSummary?: string;
  teamKnowledge?: string;
}): string {
  const { segments, contactName, companyName, jobTitle, durationSeconds, previousInteractionsSummary, teamKnowledge } = params;

  const transcript = segments
    .map((s) => {
      const time = formatMs(s.startMs);
      const speaker = s.speaker === "sdr" ? "BDR" : "LEAD";
      return `[${time}] ${speaker}: ${s.text}`;
    })
    .join("\n");

  const sdrMs = segments.filter((s) => s.speaker === "sdr").reduce((a, s) => a + (s.endMs - s.startMs), 0);
  const totalMs = durationSeconds * 1000;
  const talkRatio = totalMs > 0 ? sdrMs / totalMs : 0;

  return `Você é o motor de inteligência de vendas do Limo. Analise a transcrição de ligação abaixo e gere um diagnóstico estruturado em JSON.

CONTEXTO DO LEAD
- Nome: ${contactName}
- Empresa: ${companyName ?? "Não identificada"}
- Cargo: ${jobTitle ?? "Não identificado"}
- Duração da chamada: ${Math.round(durationSeconds / 60)} minutos
- Taxa de fala do BDR (pré-calculada): ${Math.round(talkRatio * 100)}% do tempo total
${previousInteractionsSummary ? `- Histórico: ${previousInteractionsSummary}` : ""}

TRANSCRIÇÃO (formato [MM:SS] SPEAKER: texto)
${transcript}
${teamKnowledge ? `\nCONHECIMENTO DO TIME (produto vendido + playbook de vendas)\n${teamKnowledge}\n` : ""}
INSTRUÇÕES DE ANÁLISE
Analise criticamente a condução do BDR. Seja preciso, útil e direto. Não elogie sem motivo.
Quando houver CONHECIMENTO DO TIME acima, avalie se o BDR usou a proposta de valor, os diferenciais e o tratamento de objeções do produto/playbook — e aponte, com timestamp, onde ele deixou de usar um argumento que o produto/playbook ofereciam.

Avalie:
1. RESULTADO DA CHAMADA (positive/negative/neutral/inconclusive)
   - positive: agendamento confirmado, pedido de proposta, avanço claro no funil
   - negative: recusa explícita, desligamento, sem abertura
   - neutral: conversa iniciada mas sem definição clara de próximo passo
   - inconclusive: chamada muito curta ou sem dados suficientes

2. MOMENTOS-CHAVE — para cada momento relevante identifique:
   - timestamp exato em milliseconds
   - tipo: objection | buying_signal | mistake | win | silence | rapport
   - descrição do que ocorreu
   - recomendação específica (o que o BDR deveria ter feito/dito)
   - citação exata do BDR (se houver)
   - citação exata do lead (se houver)

3. DIAGNÓSTICO COMPLETO com seções:
   - Para resultado NEGATIVO: mapeie cada erro com timestamp, o que foi dito, e o que deveria ter sido dito
   - Para resultado POSITIVO: mapeie os gatilhos, argumentos vencedores e técnicas eficazes
   - Inclua análise de: taxa de fala, perguntas abertas vs fechadas, tratamento de objeções, criação de urgência

4. PRÓXIMO PASSO concreto e específico

5. FLASH SUMMARY em 2-3 frases máximo (para notificação imediata ao BDR)

6. SCORE DETALHADO (0–100 por critério) avaliando a condução do BDR:
   - opening: qualidade da abertura (gerou contexto/curiosidade? quebrou o gelo?)
   - pain_discovery: capacidade de identificar e aprofundar as dores do lead
   - solution_clarity: clareza ao explicar a solução (conectada à dor, sem jargão)
   - framework_usage: uso de frameworks de vendas (perguntas estruturadas, qualificação)
   - advance_to_demo: efetividade em conduzir o lead até agendar uma demo/reunião
   - overall: nota composta (0–100) e uma justificativa curta (rationale)
   Seja rigoroso e calibrado: 90+ é excepcional, 50 é mediano, <30 é fraco.

7. FRAMEWORKS DE VENDAS — identifique quais frameworks o BDR usou (mesmo que parcialmente):
   SPIN (Situação/Problema/Implicação/Necessidade), BANT (Budget/Authority/Need/Timeline),
   GPCT (Goals/Plans/Challenges/Timeline), MEDDIC, AIDA, Challenger ou "outro".
   Para cada framework relevante: se foi detectado, % de completude, etapas executadas
   corretamente (steps_covered) e etapas ignoradas/mal feitas (steps_missed). Não invente
   frameworks que não apareceram — só liste os realmente usados ou claramente esperados.

8. ANÁLISE DE CONVERSÃO/PERDA:
   - Se converteu (reunião/demo agendada): liste os fatores que contribuíram (conversion_factors).
   - Se NÃO converteu: liste os motivos da perda (loss_reasons), as objeções identificadas
     (objections, com handled=foi bem contornada? e nota) e melhorias de abordagem (improvements).

Responda EXCLUSIVAMENTE com JSON válido neste formato:
{
  "result": "positive" | "negative" | "neutral" | "inconclusive",
  "flash_summary": "string de 2-3 frases resumindo o resultado e o principal próximo passo",
  "next_step": "ação específica a tomar, com contexto temporal se possível",
  "talk_ratio": número entre 0 e 1,
  "sentiment_score": número entre -1 (muito negativo) e 1 (muito positivo),
  "key_moments": [
    {
      "timestamp_ms": number,
      "type": "objection" | "buying_signal" | "mistake" | "win" | "silence" | "rapport",
      "description": "string",
      "recommendation": "string ou null",
      "sdr_quote": "string ou null",
      "lead_quote": "string ou null"
    }
  ],
  "diagnosis": {
    "headline": "frase de impacto resumindo o principal problema ou sucesso",
    "sections": [
      {
        "title": "string",
        "body": "string detalhado",
        "severity": "info" | "warning" | "critical" | "positive",
        "timestamp_ms": number ou null,
        "original_quote": "string ou null",
        "recommended_response": "string ou null"
      }
    ],
    "recommendations": ["array de recomendações práticas para as próximas ligações"]
  },
  "score": {
    "overall": number (0-100),
    "opening": number (0-100),
    "pain_discovery": number (0-100),
    "solution_clarity": number (0-100),
    "framework_usage": number (0-100),
    "advance_to_demo": number (0-100),
    "rationale": "justificativa curta da nota geral"
  },
  "frameworks": [
    {
      "name": "SPIN" | "BANT" | "GPCT" | "MEDDIC" | "AIDA" | "Challenger" | "outro",
      "detected": boolean,
      "completeness": number (0-100),
      "steps_covered": ["etapas executadas corretamente"],
      "steps_missed": ["etapas ignoradas ou mal executadas"],
      "note": "observação curta"
    }
  ],
  "outcome": {
    "converted": boolean,
    "conversion_factors": ["fatores que contribuíram para o sucesso (se converteu)"],
    "loss_reasons": ["motivos da não-conversão (se não converteu)"],
    "objections": [ { "objection": "string", "handled": boolean, "note": "string" } ],
    "improvements": ["melhorias de abordagem para as próximas calls"]
  }
}`;
}

// ─── Qualificador de Garantia do Lead (Fase 4) ──────────────────────────────

export function buildLeadQualificationPrompt(params: {
  contactName: string;
  companyName: string | null;
  jobTitle: string | null;
  location: string | null;
  technicalSource: string;      // contacts.source (linkedin/website/crm/garimpo...)
  enrichment: string | null;    // dados de enriquecimento (texto)
  interactionHistory: string;
  teamKnowledge: string;        // Educação de Produto: ICP/personas/playbook
}): string {
  const { contactName, companyName, jobTitle, location, technicalSource, enrichment, interactionHistory, teamKnowledge } = params;
  return `Você é o Qualificador de Garantia do Lead do Limo. Avalie se este lead tem ADERÊNCIA REAL à solução que o time vende, usando EXCLUSIVAMENTE o conhecimento do time (ICP, personas, playbook, critérios de qualificação) e as interações registradas. Seja rigoroso e honesto — desqualificar um lead ruim é tão valioso quanto qualificar um bom.

LEAD
- Nome: ${contactName}
- Empresa: ${companyName ?? "Não identificada"}
- Cargo: ${jobTitle ?? "Não identificado"}
- Localização: ${location ?? "Não identificada"}
- Origem técnica de captura: ${technicalSource}
${enrichment ? `- Enriquecimento: ${enrichment}` : ""}

HISTÓRICO DE INTERAÇÕES
${interactionHistory || "Sem interações registradas ainda."}

CONHECIMENTO DO TIME (Educação de Produto — ICP, personas, playbook)
${teamKnowledge || "Nenhum material cadastrado. Use critérios gerais de qualificação B2B e seja conservador."}

INSTRUÇÕES
1. ORIGEM COMERCIAL: classifique como inbound, outbound, referral (indicação), partner (parceiro) ou other. Infira pela origem técnica + histórico (ex.: garimpo/linkedin sem inbound prévio = outbound; pediu contato/preencheu form = inbound).
2. SCORE (0–100) por critério: icp_fit (aderência ao ICP), pains (dores que a solução resolve), buying_moment (momento de compra), financial_potential (potencial/ticket), decision_maker (perfil decisor), interest (interesse demonstrado). overall = aderência geral.
3. CLASSIFICAÇÃO: "qualified" (forte aderência), "partial" (aderência parcial, precisa nutrir/validar) ou "disqualified" (sem aderência). Explique os motivos.
4. MARKETING_NOTE: se houver um sinal estratégico pro Marketing (problema de segmentação, ICP, cargo, ticket ou dor mapeada errada), aponte em 1 frase. Senão, null.

Responda EXCLUSIVAMENTE com JSON válido:
{
  "origin": "inbound" | "outbound" | "referral" | "partner" | "other",
  "classification": "qualified" | "partial" | "disqualified",
  "score": {
    "overall": number, "icp_fit": number, "pains": number, "buying_moment": number,
    "financial_potential": number, "decision_maker": number, "interest": number,
    "rationale": "justificativa curta da aderência geral"
  },
  "reasons": ["motivo 1 da classificação", "motivo 2"],
  "summary": "veredito em 1-2 frases",
  "marketing_note": "sinal pro marketing ou null"
}`;
}

// Insights estratégicos do funil de qualificação (Fase 4b — Marketing/Vendas).
export function buildQualificationInsightsPrompt(params: {
  periodDays: number;
  total: number;
  qualified: number;
  partial: number;
  disqualified: number;
  byOrigin: Record<string, number>;
  avgScore: number;
  sampleReasons: string[];
  marketingNotes: string[];
  teamKnowledge: string;
}): string {
  const { periodDays, total, qualified, partial, disqualified, byOrigin, avgScore, sampleReasons, marketingNotes, teamKnowledge } = params;
  const originLine = Object.entries(byOrigin).map(([k, v]) => `${k}: ${v}`).join(" | ");
  return `Você é o analista de RevOps do Limo. Com base no funil de QUALIFICAÇÃO DE LEADS do período, gere insights estratégicos acionáveis para Marketing e Vendas. Seja específico e direto — nada genérico.

FUNIL (últimos ${periodDays} dias)
- Total de leads avaliados: ${total}
- Qualificados: ${qualified} | Parcialmente qualificados: ${partial} | Desqualificados: ${disqualified}
- Por origem: ${originLine || "n/d"}
- Score médio de aderência ao ICP: ${Math.round(avgScore)}/100

MOTIVOS DE DESQUALIFICAÇÃO/PARCIAL (amostra real)
${sampleReasons.length ? sampleReasons.map((r) => `- ${r}`).join("\n") : "- (sem motivos registrados)"}

SINAIS JÁ APONTADOS PRO MARKETING (amostra)
${marketingNotes.length ? marketingNotes.map((m) => `- ${m}`).join("\n") : "- (nenhum)"}

CONHECIMENTO DO TIME (ICP / produto / playbook)
${teamKnowledge || "(não cadastrado)"}

Gere:
1. top_disqualification_reasons: 3-5 principais motivos AGRUPADOS de desqualificação (consolide os parecidos).
2. marketing: 3-5 recomendações pro Marketing — foque em segmentação, ICP, perfil de cargo, ticket e dores mapeadas. Se a maioria dos leads desqualifica por um mesmo motivo, aponte o ajuste de geração de demanda.
3. sales: 3-5 recomendações pro time comercial — abordagem, qualificação e condução das oportunidades.
4. summary: 1-2 frases com a leitura geral do funil.

Responda EXCLUSIVAMENTE com JSON válido:
{
  "top_disqualification_reasons": ["..."],
  "marketing": ["..."],
  "sales": ["..."],
  "summary": "..."
}`;
}

// Inteligência de prospecção outbound (Fase 4c).
export function buildOutboundInsightsPrompt(params: {
  periodDays: number;
  total: number;
  opportunities: number;   // outbound qualificados
  disqualified: number;
  avgIcpFit: number;
  avgDaysInPipeline: number;
  channels: { calls: number; whatsapp: number; linkedin: number };
  successSamples: string[]; // resumos de outbound que viraram oportunidade
  lossSamples: string[];    // motivos de outbound desqualificados
  teamKnowledge: string;
}): string {
  const { periodDays, total, opportunities, disqualified, avgIcpFit, avgDaysInPipeline, channels, successSamples, lossSamples, teamKnowledge } = params;
  return `Você é o analista de prospecção outbound do Limo. Avalie a QUALIDADE da prospecção do time (BDR) no período e gere aprendizados acionáveis. Seja específico.

PROSPECÇÃO OUTBOUND (últimos ${periodDays} dias)
- Leads outbound prospectados: ${total}
- Viraram oportunidade (qualificados): ${opportunities}
- Desqualificados: ${disqualified}
- Aderência média ao ICP dos perfis buscados: ${Math.round(avgIcpFit)}/100
- Tempo médio em tratativa: ${Math.round(avgDaysInPipeline)} dias
- Canais usados: ligações em ${channels.calls} leads, WhatsApp em ${channels.whatsapp}, LinkedIn em ${channels.linkedin}

OUTBOUND QUE VIRARAM OPORTUNIDADE (amostra)
${successSamples.length ? successSamples.map((s) => `- ${s}`).join("\n") : "- (nenhum no período)"}

OUTBOUND PERDIDOS/DESQUALIFICADOS (motivos, amostra)
${lossSamples.length ? lossSamples.map((s) => `- ${s}`).join("\n") : "- (nenhum)"}

CONHECIMENTO DO TIME (ICP / produto / playbook)
${teamKnowledge || "(não cadastrado)"}

Gere:
1. success_factors: o que está fazendo as prospecções outbound darem certo (3-5).
2. loss_reasons: principais motivos de perda/desqualificação no outbound (3-5).
3. learnings: aprendizados acionáveis pras próximas prospecções — quem buscar (perfil/cargo/segmento), canais e abordagem (3-5).
4. summary: 1-2 frases sobre a saúde da prospecção outbound (aderência ao ICP, eficiência, gargalos).

Responda EXCLUSIVAMENTE com JSON válido:
{ "success_factors": ["..."], "loss_reasons": ["..."], "learnings": ["..."], "summary": "..." }`;
}

// Desenvolvimento individual do BDR (Fase 5).
export function buildMemberDevelopmentPrompt(params: {
  memberName: string;
  periodDays: number;
  callCount: number;
  avgScore: Record<string, number>;
  trend: number | null;
  hardSkills: string[];
  softSkills: string[];
  recentSummaries: string[];
  teamKnowledge: string;
}): string {
  const { memberName, periodDays, callCount, avgScore, trend, hardSkills, softSkills, recentSummaries, teamKnowledge } = params;
  const scoreLine = Object.entries(avgScore).map(([k, v]) => `${k}: ${Math.round(v)}`).join(" | ");
  return `Você é o coach de desenvolvimento do time de vendas do Limo. Avalie a evolução do profissional abaixo com base nos scores reais das ligações dele e no foco de skills definido pelo gestor. Seja específico, justo e acionável.

PROFISSIONAL: ${memberName}
PERÍODO: últimos ${periodDays} dias · ${callCount} ligações analisadas
SCORES MÉDIOS (0–100, da Fase 3): ${scoreLine || "sem dados"}
${trend != null ? `TENDÊNCIA do score geral vs período anterior: ${trend >= 0 ? "+" : ""}${Math.round(trend)} pontos` : ""}

FOCO DE DESENVOLVIMENTO DEFINIDO PELO GESTOR
- Hard skills: ${hardSkills.length ? hardSkills.join(", ") : "(não definidas)"}
- Soft skills: ${softSkills.length ? softSkills.join(", ") : "(não definidas)"}

RESUMOS RECENTES DAS LIGAÇÕES (amostra)
${recentSummaries.length ? recentSummaries.map((s) => `- ${s}`).join("\n") : "- (sem resumos)"}

CONHECIMENTO DO TIME (produto/playbook)
${teamKnowledge || "(não cadastrado)"}

Gere uma leitura de desenvolvimento que CONECTE os scores e os resumos ao foco de skills do gestor (se definido). Aponte pontos fortes reais e oportunidades de melhoria concretas, com o que treinar.

Responda EXCLUSIVAMENTE com JSON válido:
{
  "strengths": ["ponto forte concreto", "..."],
  "improvements": ["oportunidade de melhoria + o que treinar", "..."],
  "development_note": "1-2 frases sobre a evolução e o foco recomendado pro próximo período"
}`;
}

// ─── Content Generation ───────────────────────────────────────────────────────

export function buildContentPrompt(params: {
  type: ContentType;
  temperature: LeadTemperature;
  contactName: string;
  contactFirstName: string;
  jobTitle: string | null;
  companyName: string | null;
  companyIndustry: string | null;
  interactionHistory: string;
  customContext?: string;
  knowledgeContext?: string;
}): string {
  const {
    type,
    temperature,
    contactName,
    contactFirstName,
    jobTitle,
    companyName,
    companyIndustry,
    interactionHistory,
    customContext,
    knowledgeContext,
  } = params;

  const typeLabel: Record<ContentType, string> = {
    call_script: "script de ligação",
    email: "e-mail de prospecção",
    whatsapp: "mensagem de WhatsApp",
  };

  const temperatureGuidelines: Record<LeadTemperature, string> = {
    cold: `Lead FRIO — nenhuma interação prévia ou interesse demonstrado.
Diretrizes:
- Tom: direto, sem pressão, proposta de valor em 1 frase
- Objetivo: despertar curiosidade, não vender
- Para script: abertura de 15-20 segundos, 1 pergunta qualificadora simples, sem pitch longo
- Para e-mail: assunto curto e provocativo, corpo com máximo 4 linhas, CTA de resposta simples ("Faz sentido conversarmos 15 minutos?")
- Para WhatsApp: 1-2 frases, informal, sem pitch — abrir conversa apenas`,

    warm: `Lead MORNO — houve interação (abriu e-mail, respondeu brevemente, já foi prospectado antes).
Diretrizes:
- Tom: consultivo, referência ao contexto anterior, urgência leve
- Objetivo: reengajar com nova perspectiva ou dado relevante
- Para script: recapitular contexto em 10 segundos, apresentar insight novo, fazer 2-3 perguntas abertas
- Para e-mail: personalizado com nome + empresa + referência ao último contato, corpo com até 6 linhas, CTA com opção de horário específico
- Para WhatsApp: mensagem que referencia o último contato, tom casual mas direcionado`,

    hot: `Lead QUENTE — demonstrou interesse claro, pediu proposta, está em avaliação ativa.
Diretrizes:
- Tom: orientado a decisão, parceiro, remove últimas objeções
- Objetivo: confirmar reunião/fechar ou avançar para próxima etapa
- Para script: foco em confirmar alinhamento, antecipar objeções finais, propor próximo passo concreto
- Para e-mail: recapitula o que foi discutido, lista os próximos passos, deadline natural, CTA de calendário
- Para WhatsApp: direto ao ponto, propõe 2 opções de horário específicas, link de calendário`,
  };

  return `Você é o motor de geração de conteúdo de vendas do Limo. Crie um ${typeLabel[type]} altamente personalizado em português brasileiro.
${knowledgeContext ? `
BASE DE CONHECIMENTO DO TIME (produto + playbook de vendas) — é a FONTE DA VERDADE sobre o que a empresa vende, diferenciais e abordagens que funcionam. Baseie o conteúdo nisto; NÃO invente recursos ou benefícios fora daqui:
${knowledgeContext}
` : ""}
PERFIL DO LEAD
- Nome completo: ${contactName}
- Primeiro nome: ${contactFirstName}
- Cargo: ${jobTitle ?? "Não identificado"}
- Empresa: ${companyName ?? "Não identificada"}
- Setor: ${companyIndustry ?? "Não identificado"}

TEMPERATURA DO LEAD: ${temperature.toUpperCase()}
${temperatureGuidelines[temperature]}

HISTÓRICO DE INTERAÇÕES
${interactionHistory || "Nenhuma interação registrada."}

${customContext ? `CONTEXTO ADICIONAL DO BDR\n${customContext}\n` : ""}

REQUISITOS DO CONTEÚDO
- Idioma: português brasileiro natural, sem gírias excessivas
- Tom profissional mas humano (não robotizado)
- Personalizar usando o nome da empresa e cargo do lead
- Sem bullet points genéricos ou frases clichê de vendas
- Não use "Espero que esteja bem" ou "Gostaria de apresentar nossa solução"
- Seja específico e concreto

${
  type === "call_script"
    ? `ESTRUTURA DO SCRIPT
[ABERTURA] (15-20 segundos)
[PERGUNTA QUALIFICADORA]
[PITCH CONTEXTUALIZADO] (se lead morno/quente)
[TRATAMENTO DE OBJEÇÕES PROVÁVEIS]
[FECHAMENTO / PRÓXIMO PASSO]`
    : type === "email"
    ? `ESTRUTURA DO E-MAIL
Assunto:
Corpo:
CTA:`
    : `ESTRUTURA DA MENSAGEM WHATSAPP
(mensagem única, informal, sem formatação markdown)`
}

Responda APENAS com o conteúdo solicitado, sem explicações adicionais.`;
}

// ─── Weekly Report ────────────────────────────────────────────────────────────

export function buildWeeklyReportPrompt(params: {
  teamName: string;
  weekRange: string;
  metrics: {
    callsTotal: number;
    callsGoal: number;
    meetingsBooked: number;
    conversionRate: number;
    leadsEnriched: number;
  };
  topObjections: Array<{ text: string; count: number }>;
  memberData: Array<{
    name: string;
    callsCount: number;
    conversionRate: number;
    avgTalkRatio: number;
    topWeakness: string;
    topStrength: string;
    recentFeedbacks: Array<{ type: string; date: string; targetMetric: string; baselineValue: number }>;
    metricsAfterFeedback: Array<{ metric: string; valueBefore: number; valueAfter: number; weeksAgo: number }>;
    // Fase 5 — desenvolvimento individual
    focusHardSkills?: string[];
    focusSoftSkills?: string[];
    avgScore?: Record<string, number> | null;
    scoreTrend?: number | null;
  }>;
}): string {
  return `Você é o motor de diagnóstico gerencial do Limo. Gere o e-mail semanal de diagnóstico para o gestor.

EQUIPE: ${params.teamName}
PERÍODO: ${params.weekRange}

MÉTRICAS DA SEMANA
- Ligações realizadas: ${params.metrics.callsTotal} (meta: ${params.metrics.callsGoal})
- Reuniões agendadas: ${params.metrics.meetingsBooked}
- Taxa de conversão: ${(params.metrics.conversionRate * 100).toFixed(1)}%
- Leads enriquecidos: ${params.metrics.leadsEnriched}

PRINCIPAIS OBJEÇÕES ENCONTRADAS
${params.topObjections.map((o) => `- "${o.text}" (${o.count}x)`).join("\n")}

DADOS POR MEMBRO
${params.memberData
  .map(
    (m) => `
## ${m.name}
- Ligações: ${m.callsCount}
- Taxa de conversão: ${(m.conversionRate * 100).toFixed(1)}%
- Taxa de fala média: ${(m.avgTalkRatio * 100).toFixed(0)}%
- Principal ponto forte: ${m.topStrength}
- Principal fraqueza: ${m.topWeakness}
- Foco de desenvolvimento (definido pelo gestor): hard=[${(m.focusHardSkills ?? []).join(", ") || "—"}] soft=[${(m.focusSoftSkills ?? []).join(", ") || "—"}]
- Scores médios das ligações (0–100): ${m.avgScore ? Object.entries(m.avgScore).map(([k, v]) => `${k}=${Math.round(v)}`).join(", ") : "sem dados"}${m.scoreTrend != null ? ` | tendência do geral: ${m.scoreTrend >= 0 ? "+" : ""}${Math.round(m.scoreTrend)} pts vs semana anterior` : ""}
- Feedbacks recentes: ${m.recentFeedbacks.map((f) => `${f.type} em ${f.date} (baseline: ${f.baselineValue})`).join("; ")}
- Evolução pós-feedback: ${m.metricsAfterFeedback.map((mf) => `${mf.metric}: ${mf.valueBefore} → ${mf.valueAfter} (${mf.weeksAgo} semanas atrás)`).join("; ")}`
  )
  .join("\n")}

INSTRUÇÕES
1. Calcule o termômetro da operação (0-100) com base nas métricas vs meta
2. Identifique os 3 maiores gargalos onde o time está perdendo dinheiro, com estimativa de impacto em receita (use ticket médio hipotético de R$2.000/mês se não houver dado real)
3. Para cada membro, calcule o score de coachability baseado em:
   - excellent (4): absorveu feedback e melhorou em até 2 semanas, manteve por 2+ semanas
   - positive (3): melhora identificada mas ainda inconsistente
   - alert (2): sem melhora após 3+ semanas com mesmo feedback
   - critical (1): regressão após melhora inicial
4. Para cada membro, avalie o PROGRESSO no foco de desenvolvimento definido pelo gestor (hard/soft skills), cruzando com os scores médios das ligações e a tendência. Gere um campo "skill_progress" dizendo se evoluiu nas skills de foco e o que treinar. Quando houver foco definido, a "week_goal" deve mirar exatamente essas skills.
5. Gere ações recomendadas para a semana (máximo 4, muito específicas)

Responda EXCLUSIVAMENTE com JSON válido:
{
  "thermometer": number (0-100),
  "bottlenecks": [
    {
      "title": "string",
      "description": "string detalhado com o problema e impacto",
      "affected_member_names": ["string"],
      "estimated_revenue_loss": number (em R$),
      "occurrence_count": number
    }
  ],
  "member_diagnoses": [
    {
      "name": "string",
      "strengths": ["string"],
      "critical_point": "string",
      "coachability_score": 1|2|3|4,
      "coachability_status": "excellent"|"positive"|"alert"|"critical",
      "coachability_note": "string explicando o diagnóstico de coachability com evidências",
      "skill_progress": "string sobre a evolução nas skills de foco definidas pelo gestor (use os scores e a tendência); se não houver foco definido, diga o foco sugerido",
      "week_goal": "string com meta específica e mensurável para a próxima semana"
    }
  ],
  "action_items": ["string com ação específica"]
}`;
}

// ─── Coachability Analysis ────────────────────────────────────────────────────

export function buildCoachabilityPrompt(params: {
  memberName: string;
  feedbacks: Array<{
    type: string;
    text: string;
    givenAt: string;
    targetMetric: string;
    baselineValue: number;
  }>;
  callMetricsTimeline: Array<{
    callDate: string;
    talkRatio: number;
    objectionHandlingScore: number | null;
    discoveryScore: number | null;
    result: string;
  }>;
}): string {
  return `Analise o padrão de coachability de ${params.memberName}.

FEEDBACKS RECEBIDOS
${params.feedbacks.map((f) => `- ${f.givenAt}: [${f.type}] ${f.text} (baseline: ${f.targetMetric}=${f.baselineValue})`).join("\n")}

MÉTRICAS AO LONGO DO TEMPO
${params.callMetricsTimeline.map((c) => `- ${c.callDate}: fala=${(c.talkRatio * 100).toFixed(0)}%, resultado=${c.result}`).join("\n")}

Determine se cada feedback foi absorvido (melhorou o indicador-alvo nas semanas seguintes), se a melhora foi mantida, e calcule um score de coachability geral de 1 a 4.

Responda em JSON:
{
  "score": 1|2|3|4,
  "status": "excellent"|"positive"|"alert"|"critical",
  "evidence": "string com evidências específicas da análise",
  "trend": "improving"|"stable"|"declining",
  "specific_feedbacks_absorbed": ["string"],
  "specific_feedbacks_ignored": ["string"]
}`;
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const sec = (totalSec % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}
