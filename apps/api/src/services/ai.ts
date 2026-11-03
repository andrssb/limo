import {
  buildCallAnalysisPrompt,
  buildContentPrompt,
  buildWeeklyReportPrompt,
  buildCoachabilityPrompt,
  buildLeadQualificationPrompt,
  buildQualificationInsightsPrompt,
  buildOutboundInsightsPrompt,
  buildMemberDevelopmentPrompt,
} from "../prompts/index.js";
import type {
  TranscriptSegment,
  LeadTemperature,
  ContentType,
  CallAnalysis,
  WeeklyReportData,
  LeadQualification,
} from "@limo/types";
import { askClaude, askFast } from "../lib/llm.js";

function parseJSON<T>(text: string): T {
  const match = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  const raw = match ? (match[1] ?? text) : text;
  return JSON.parse(raw.trim()) as T;
}

// ─── Call Analysis ────────────────────────────────────────────────────────────

export async function analyzeCall(params: {
  segments: TranscriptSegment[];
  contactName: string;
  companyName: string | null;
  jobTitle: string | null;
  durationSeconds: number;
  previousInteractionsSummary?: string;
  teamKnowledge?: string;
}): Promise<Omit<CallAnalysis, "id" | "callId" | "createdAt">> {
  const prompt = buildCallAnalysisPrompt(params);
  const raw = await askClaude(prompt);

  const data = parseJSON<{
    result: string;
    flash_summary: string;
    next_step: string;
    talk_ratio: number;
    sentiment_score: number;
    key_moments: Array<{
      timestamp_ms: number;
      type: string;
      description: string;
      recommendation: string | null;
      sdr_quote: string | null;
      lead_quote: string | null;
    }>;
    diagnosis: {
      headline: string;
      sections: Array<{
        title: string;
        body: string;
        severity: string;
        timestamp_ms: number | null;
        original_quote: string | null;
        recommended_response: string | null;
      }>;
      recommendations: string[];
    };
    score?: {
      overall: number;
      opening: number;
      pain_discovery: number;
      solution_clarity: number;
      framework_usage: number;
      advance_to_demo: number;
      rationale: string;
    };
    frameworks?: Array<{
      name: string;
      detected: boolean;
      completeness: number;
      steps_covered: string[];
      steps_missed: string[];
      note: string;
    }>;
    outcome?: {
      converted: boolean;
      conversion_factors: string[];
      loss_reasons: string[];
      objections: Array<{ objection: string; handled: boolean; note: string }>;
      improvements: string[];
    };
  }>(raw);

  return {
    result: data.result as CallAnalysis["result"],
    flashSummary: data.flash_summary,
    nextStep: data.next_step,
    talkRatio: data.talk_ratio,
    sentimentScore: data.sentiment_score,
    keyMoments: data.key_moments.map((m) => ({
      timestampMs: m.timestamp_ms,
      type: m.type as any,
      description: m.description,
      recommendation: m.recommendation,
      sdrQuote: m.sdr_quote,
      leadQuote: m.lead_quote,
    })),
    diagnosis: {
      headline: data.diagnosis.headline,
      sections: data.diagnosis.sections.map((s) => ({
        title: s.title,
        body: s.body,
        severity: s.severity as any,
        timestampMs: s.timestamp_ms ?? undefined,
        originalQuote: s.original_quote ?? undefined,
        recommendedResponse: s.recommended_response ?? undefined,
      })),
      recommendations: data.diagnosis.recommendations,
    },
    score: data.score
      ? {
          overall: data.score.overall,
          opening: data.score.opening,
          painDiscovery: data.score.pain_discovery,
          solutionClarity: data.score.solution_clarity,
          frameworkUsage: data.score.framework_usage,
          advanceToDemo: data.score.advance_to_demo,
          rationale: data.score.rationale,
        }
      : null,
    frameworks: data.frameworks
      ? data.frameworks.map((f) => ({
          name: f.name,
          detected: f.detected,
          completeness: f.completeness,
          stepsCovered: f.steps_covered ?? [],
          stepsMissed: f.steps_missed ?? [],
          note: f.note,
        }))
      : null,
    outcome: data.outcome
      ? {
          converted: data.outcome.converted,
          conversionFactors: data.outcome.conversion_factors ?? [],
          lossReasons: data.outcome.loss_reasons ?? [],
          objections: data.outcome.objections ?? [],
          improvements: data.outcome.improvements ?? [],
        }
      : null,
  };
}

// ─── Lead Qualification (Fase 4) ────────────────────────────────────────────

export async function qualifyLead(
  params: Parameters<typeof buildLeadQualificationPrompt>[0]
): Promise<Pick<LeadQualification, "origin" | "classification" | "score" | "reasons" | "summary" | "marketingNote">> {
  const prompt = buildLeadQualificationPrompt(params);
  const raw = await askClaude(prompt);

  const data = parseJSON<{
    origin: string;
    classification: string;
    score: {
      overall: number; icp_fit: number; pains: number; buying_moment: number;
      financial_potential: number; decision_maker: number; interest: number; rationale: string;
    };
    reasons: string[];
    summary: string;
    marketing_note: string | null;
  }>(raw);

  return {
    origin: data.origin as LeadQualification["origin"],
    classification: data.classification as LeadQualification["classification"],
    score: {
      overall: data.score.overall,
      icpFit: data.score.icp_fit,
      pains: data.score.pains,
      buyingMoment: data.score.buying_moment,
      financialPotential: data.score.financial_potential,
      decisionMaker: data.score.decision_maker,
      interest: data.score.interest,
      rationale: data.score.rationale,
    },
    reasons: data.reasons ?? [],
    summary: data.summary,
    marketingNote: data.marketing_note ?? null,
  };
}

export async function generateQualificationInsights(
  params: Parameters<typeof buildQualificationInsightsPrompt>[0]
): Promise<{ topDisqualReasons: string[]; marketing: string[]; sales: string[]; summary: string }> {
  const prompt = buildQualificationInsightsPrompt(params);
  const raw = await askClaude(prompt);
  const data = parseJSON<{
    top_disqualification_reasons: string[];
    marketing: string[];
    sales: string[];
    summary: string;
  }>(raw);
  return {
    topDisqualReasons: data.top_disqualification_reasons ?? [],
    marketing: data.marketing ?? [],
    sales: data.sales ?? [],
    summary: data.summary ?? "",
  };
}

export async function generateOutboundInsights(
  params: Parameters<typeof buildOutboundInsightsPrompt>[0]
): Promise<{ successFactors: string[]; lossReasons: string[]; learnings: string[]; summary: string }> {
  const prompt = buildOutboundInsightsPrompt(params);
  const raw = await askClaude(prompt);
  const data = parseJSON<{
    success_factors: string[];
    loss_reasons: string[];
    learnings: string[];
    summary: string;
  }>(raw);
  return {
    successFactors: data.success_factors ?? [],
    lossReasons: data.loss_reasons ?? [],
    learnings: data.learnings ?? [],
    summary: data.summary ?? "",
  };
}

export async function generateMemberDevelopment(
  params: Parameters<typeof buildMemberDevelopmentPrompt>[0]
): Promise<{ strengths: string[]; improvements: string[]; developmentNote: string }> {
  const prompt = buildMemberDevelopmentPrompt(params);
  const raw = await askClaude(prompt);
  const data = parseJSON<{ strengths: string[]; improvements: string[]; development_note: string }>(raw);
  return {
    strengths: data.strengths ?? [],
    improvements: data.improvements ?? [],
    developmentNote: data.development_note ?? "",
  };
}

// ─── Content Generation ───────────────────────────────────────────────────────

export async function generateContent(params: {
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
}): Promise<string> {
  const prompt = buildContentPrompt(params);
  return askClaude(prompt);
}

// ─── Weekly Report ────────────────────────────────────────────────────────────

export async function generateWeeklyReport(
  params: Parameters<typeof buildWeeklyReportPrompt>[0]
): Promise<Pick<WeeklyReportData, "thermometer" | "bottlenecks" | "memberDiagnoses" | "actionItems">> {
  const prompt = buildWeeklyReportPrompt(params);
  const raw = await askClaude(prompt);

  const data = parseJSON<{
    thermometer: number;
    bottlenecks: Array<{
      title: string;
      description: string;
      affected_member_names: string[];
      estimated_revenue_loss: number;
      occurrence_count: number;
    }>;
    member_diagnoses: Array<{
      name: string;
      strengths: string[];
      critical_point: string;
      coachability_score: number;
      coachability_status: string;
      coachability_note: string;
      skill_progress?: string;
      week_goal: string;
    }>;
    action_items: string[];
  }>(raw);

  return {
    thermometer: data.thermometer,
    bottlenecks: data.bottlenecks.map((b) => ({
      title: b.title,
      description: b.description,
      affectedMemberIds: [],
      estimatedRevenueLoss: b.estimated_revenue_loss,
      occurrenceCount: b.occurrence_count,
    })),
    memberDiagnoses: data.member_diagnoses.map((m) => ({
      userId: "",
      userName: m.name,
      strengths: m.strengths,
      criticalPoint: m.critical_point,
      coachabilityScore: m.coachability_score,
      coachabilityStatus: m.coachability_status as any,
      coachabilityNote: m.coachability_note,
      skillProgress: m.skill_progress ?? undefined,
      weekGoal: m.week_goal,
    })),
    actionItems: data.action_items,
  };
}

// ─── Interaction History Summary ──────────────────────────────────────────────

export async function summarizeInteractionHistory(history: string): Promise<string> {
  if (!history.trim()) return "";
  // Resumo interno descartável → Groq/Llama instant, nunca Claude.
  const raw = await askFast(
    `Resuma em 2-3 frases o histórico de interações a seguir, focando nos pontos mais relevantes para o próximo contato:\n\n${history}`
  );
  return raw.trim();
}
