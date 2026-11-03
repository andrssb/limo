import { Worker } from "bullmq";
import { createRedis } from "../lib/redis.js";
import { getDb } from "@limo/db";
import { users, teams, calls, callAnalyses, contacts, weeklyReports, feedbackRecords, memberSkills } from "@limo/db";
import { eq, and, gte, lt, lte, sql } from "drizzle-orm";
import { generateWeeklyReport } from "../services/ai.js";
import { sendWeeklyReportEmail } from "../services/email.js";
import { QUEUES, type WeeklyReportJob } from "../lib/queue.js";

export function startWeeklyReportWorker(): Worker {
  return new Worker<WeeklyReportJob>(
    QUEUES.WEEKLY_REPORT,
    async (job) => {
      const { teamId } = job.data;
      const db = getDb();

      const now = new Date();
      const weekEnd = new Date(now);
      weekEnd.setHours(23, 59, 59, 999);
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - 6);
      weekStart.setHours(0, 0, 0, 0);
      // Semana anterior (p/ tendência de score do desenvolvimento — Fase 5).
      const prevWeekStart = new Date(weekStart);
      prevWeekStart.setDate(weekStart.getDate() - 7);

      const SCORE_CRITERIA = ["opening", "painDiscovery", "solutionClarity", "frameworkUsage", "advanceToDemo"] as const;
      const avgOverallOf = (scores: any[]): number | null =>
        scores.length ? scores.reduce((a, s) => a + (s?.overall ?? 0), 0) / scores.length : null;

      // Fetch team + manager
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
      if (!team) throw new Error(`Team ${teamId} not found`);

      const [manager] = await db.select().from(users).where(eq(users.id, team.managerId)).limit(1);
      if (!manager) throw new Error(`Manager not found for team ${teamId}`);

      // Fetch team members
      const members = await db.select().from(users).where(eq(users.teamId, teamId));

      // Aggregate per-member data
      const memberData = await Promise.all(
        members.map(async (member) => {
          const memberCalls = await db
            .select()
            .from(calls)
            .where(and(eq(calls.userId, member.id), gte(calls.startedAt, weekStart), lte(calls.startedAt, weekEnd)));

          const positiveCalls = memberCalls.filter((c) => c.result === "positive").length;
          const conversionRate = memberCalls.length > 0 ? positiveCalls / memberCalls.length : 0;

          const analyses = await db
            .select()
            .from(callAnalyses)
            .where(sql`${callAnalyses.callId} IN (${memberCalls.map((c) => `'${c.id}'`).join(",") || "''"})`)
            .limit(50);

          const avgTalkRatio =
            analyses.length > 0 ? analyses.reduce((a, b) => a + (b.talkRatio ?? 0), 0) / analyses.length : 0.5;

          const feedbacks = await db
            .select()
            .from(feedbackRecords)
            .where(eq(feedbackRecords.userId, member.id))
            .orderBy(feedbackRecords.createdAt)
            .limit(10);

          // Fase 5 — desenvolvimento: foco de skills + evolução de score.
          const [skillRow] = await db.select().from(memberSkills).where(eq(memberSkills.userId, member.id)).limit(1);

          const thisWeekScores = analyses.map((a) => a.score).filter(Boolean) as any[];
          let avgScore: Record<string, number> | null = null;
          if (thisWeekScores.length) {
            avgScore = { overall: avgOverallOf(thisWeekScores)! };
            for (const c of SCORE_CRITERIA) {
              avgScore[c] = thisWeekScores.reduce((a, s) => a + (s?.[c] ?? 0), 0) / thisWeekScores.length;
            }
          }

          const prevRows = await db
            .select({ score: callAnalyses.score })
            .from(callAnalyses)
            .innerJoin(calls, eq(calls.id, callAnalyses.callId))
            .where(and(eq(calls.userId, member.id), gte(calls.startedAt, prevWeekStart), lt(calls.startedAt, weekStart)));
          const prevAvg = avgOverallOf(prevRows.map((r) => r.score).filter(Boolean) as any[]);
          const scoreTrend = avgScore && prevAvg != null ? avgScore.overall - prevAvg : null;

          return {
            name: member.name,
            callsCount: memberCalls.length,
            conversionRate,
            avgTalkRatio,
            topStrength: analyses[0] ? extractStrength(analyses[0].diagnosis as any) : "Dados insuficientes",
            topWeakness: analyses[0] ? extractWeakness(analyses[0].diagnosis as any) : "Dados insuficientes",
            recentFeedbacks: feedbacks.map((f) => ({
              type: f.feedbackType,
              date: f.createdAt.toISOString().split("T")[0],
              targetMetric: f.targetMetric,
              baselineValue: f.baselineValue,
            })),
            metricsAfterFeedback: [],
            focusHardSkills: (skillRow?.hardSkills as string[]) ?? [],
            focusSoftSkills: (skillRow?.softSkills as string[]) ?? [],
            avgScore,
            scoreTrend,
          };
        })
      );

      const allCalls = memberData.reduce((a, m) => a + m.callsCount, 0);
      const allMeetings = await db
        .select()
        .from(calls)
        .where(
          and(
            eq(calls.result, "positive"),
            gte(calls.startedAt, weekStart),
            lte(calls.startedAt, weekEnd),
            sql`${calls.userId} IN (${members.map((m) => `'${m.id}'`).join(",") || "''"})`
          )
        );

      const allLeads = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.teamId, teamId), gte(contacts.createdAt, weekStart)));

      const reportInput = {
        teamName: team.name,
        weekRange: `${weekStart.toLocaleDateString("pt-BR")} – ${weekEnd.toLocaleDateString("pt-BR")}`,
        metrics: {
          callsTotal: allCalls,
          callsGoal: members.length * 30,
          meetingsBooked: allMeetings.length,
          conversionRate: allCalls > 0 ? allMeetings.length / allCalls : 0,
          leadsEnriched: allLeads.length,
        },
        topObjections: [],
        memberData,
      };

      const aiData = await generateWeeklyReport(reportInput);

      // Fase 5 — anexa o foco de skills (definido pelo gestor) a cada diagnóstico.
      const focusByName = new Map(
        memberData.map((m) => [m.name, [...(m.focusHardSkills ?? []), ...(m.focusSoftSkills ?? [])]])
      );
      aiData.memberDiagnoses = aiData.memberDiagnoses.map((d) => ({
        ...d,
        focusSkills: focusByName.get(d.userName) ?? [],
      }));

      const reportData = {
        ...reportInput.metrics,
        ...aiData,
      };

      const [report] = await db.insert(weeklyReports).values({
        teamId,
        weekStart,
        weekEnd,
        reportData: reportData as any,
      }).returning();

      await sendWeeklyReportEmail({
        managerEmail: manager.email,
        managerName: manager.name,
        teamName: team.name,
        weekRange: reportInput.weekRange,
        report: reportData as any,
      });

      await db.update(weeklyReports).set({ emailSentAt: new Date() }).where(eq(weeklyReports.id, report!.id));

      job.log(`Weekly report sent for team ${teamId}`);
    },
    { connection: createRedis(), concurrency: 2 }
  );
}

function extractStrength(diagnosis: any): string {
  if (!diagnosis?.sections) return "Boa condução";
  const positive = diagnosis.sections.find((s: any) => s.severity === "positive");
  return positive?.title ?? "Boa condução geral";
}

function extractWeakness(diagnosis: any): string {
  if (!diagnosis?.sections) return "Dados insuficientes";
  const critical = diagnosis.sections.find((s: any) => s.severity === "critical");
  const warning = diagnosis.sections.find((s: any) => s.severity === "warning");
  return (critical ?? warning)?.title ?? "Nenhum ponto crítico identificado";
}
