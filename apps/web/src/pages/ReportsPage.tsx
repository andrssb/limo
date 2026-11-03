import React, { useEffect, useState } from "react";
import { apiFetch, cachedGet } from "../lib/api";

// Relatórios ilustrativos exibidos quando o time ainda não gerou nenhum —
// pra a seção não nascer vazia. Sinalizados com o selo "Dados de exemplo".
// O botão "Gerar agora" segue criando o relatório real normalmente.
const DEMO_REPORTS: any[] = [
  {
    id: "demo-1",
    weekStart: "2026-06-01T00:00:00.000Z",
    weekEnd: "2026-06-05T00:00:00.000Z",
    emailSentAt: "2026-06-05T20:00:00.000Z",
    reportData: {
      callsTotal: 312,
      callsGoal: 300,
      meetingsBooked: 24,
      conversionRate: 0.077,
      leadsEnriched: 148,
      executiveSummary:
        "Semana acima da meta de ligações (104%) e o melhor volume de reuniões do mês (24). " +
        "A taxa de conversão subiu de 6,6% para 7,7%, puxada pela Camila e pelo Rafael. " +
        "O principal ponto de atenção segue sendo a qualificação no topo: muitas ligações " +
        "boas se perdem por falta de um próximo passo claro ao fim da call.",
      bottlenecks: [
        {
          area: "Qualificação (descoberta)",
          description:
            "Em 38% das ligações conectadas não houve agendamento de próximo passo. O time avança pra pitch antes de mapear dor e orçamento.",
          recommendation: "Reforçar o roteiro de descoberta e travar a call só com próximo passo definido.",
        },
        {
          area: "Talk ratio elevado",
          description:
            "Média do time em 64% — acima do ideal (40–45%). BDRs falando demais reduzem a qualidade da descoberta.",
          recommendation: "Coaching focado em perguntas abertas e escuta ativa para Bruno e Larissa.",
        },
      ],
      memberDiagnoses: [
        { name: "Camila Souza",   callsCount: 92, conversionRate: 0.108, avgTalkRatio: 0.46, focusSkills: ["descoberta de dor", "escuta ativa"], skillProgress: "Score de descoberta subiu de 71 para 84 na semana — referência do time. Manter o ritmo e começar a mentorar os colegas." },
        { name: "Rafael Lima",    callsCount: 84, conversionRate: 0.083, avgTalkRatio: 0.52, focusSkills: ["fechamento", "condução até demo"], skillProgress: "Condução até demo em 58 (+6 pts). Evoluindo, mas ainda hesita ao pedir o próximo passo — treinar fechamento direto." },
        { name: "Bruno Alves",    callsCount: 71, conversionRate: 0.056, avgTalkRatio: 0.68, focusSkills: ["escuta ativa", "talk ratio"], skillProgress: "Talk ratio segue alto (68%); score de descoberta em 44, estável. Sem evolução na skill de foco — priorizar coaching de escuta." },
        { name: "Larissa Castro", callsCount: 65, conversionRate: 0.046, avgTalkRatio: 0.71, focusSkills: ["descoberta de dor", "uso de framework SPIN"], skillProgress: "Uso de framework subiu de 32 para 41. Começando a estruturar as perguntas, mas ainda parte pro pitch cedo demais." },
      ],
    },
  },
  {
    id: "demo-2",
    weekStart: "2026-05-25T00:00:00.000Z",
    weekEnd: "2026-05-29T00:00:00.000Z",
    emailSentAt: "2026-05-29T20:00:00.000Z",
    reportData: {
      callsTotal: 287,
      callsGoal: 300,
      meetingsBooked: 19,
      conversionRate: 0.066,
      leadsEnriched: 132,
      executiveSummary:
        "Semana ligeiramente abaixo da meta (96%). Volume de reuniões caiu em relação à semana anterior, " +
        "refletindo dois dias de feriado. Conversão estável; destaque para o crescimento da Larissa.",
      bottlenecks: [
        {
          area: "Volume nas segundas",
          description: "Segundas-feiras concentram só 12% das ligações da semana — começo lento puxa a média pra baixo.",
          recommendation: "Bloco de prospecção logo no início da segunda, antes das reuniões internas.",
        },
      ],
      memberDiagnoses: [
        { name: "Camila Souza",   callsCount: 88, conversionRate: 0.091, avgTalkRatio: 0.47, coachingFocus: "Manter ritmo" },
        { name: "Rafael Lima",    callsCount: 79, conversionRate: 0.076, avgTalkRatio: 0.55, coachingFocus: "Fechamento" },
        { name: "Bruno Alves",    callsCount: 68, conversionRate: 0.044, avgTalkRatio: 0.70, coachingFocus: "Talk ratio" },
        { name: "Larissa Castro", callsCount: 52, conversionRate: 0.058, avgTalkRatio: 0.66, coachingFocus: "Evoluindo — seguir no foco de descoberta" },
      ],
    },
  },
  {
    id: "demo-3",
    weekStart: "2026-05-18T00:00:00.000Z",
    weekEnd: "2026-05-22T00:00:00.000Z",
    emailSentAt: "2026-05-22T20:00:00.000Z",
    reportData: {
      callsTotal: 268,
      callsGoal: 280,
      meetingsBooked: 17,
      conversionRate: 0.063,
      leadsEnriched: 119,
      executiveSummary:
        "Primeira semana do ciclo de metas mensal. Base sólida de volume; conversão dentro do esperado " +
        "para o início do mês. Foco da próxima semana: aumentar a taxa de conexão no período da tarde.",
      bottlenecks: [
        {
          area: "Taxa de conexão à tarde",
          description: "Ligações após as 16h têm 22% menos taxa de conexão — janela menos produtiva.",
          recommendation: "Concentrar prospecção ativa entre 9h–11h e 14h–16h.",
        },
      ],
      memberDiagnoses: [
        { name: "Camila Souza",   callsCount: 81, conversionRate: 0.086, avgTalkRatio: 0.48, coachingFocus: "Manter" },
        { name: "Rafael Lima",    callsCount: 76, conversionRate: 0.066, avgTalkRatio: 0.57, coachingFocus: "Fechamento" },
        { name: "Bruno Alves",    callsCount: 64, conversionRate: 0.047, avgTalkRatio: 0.69, coachingFocus: "Talk ratio" },
        { name: "Larissa Castro", callsCount: 47, conversionRate: 0.043, avgTalkRatio: 0.69, coachingFocus: "Descoberta" },
      ],
    },
  },
];

export function ReportsPage() {
  const [team, setTeam] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const teamRes = await cachedGet<{ team: any }>("/teams/mine");
        setTeam(teamRes.team);
        const reportRes = await cachedGet<{ reports: any[] }>(`/teams/${teamRes.team.id}/report/weekly`);
        setReports(reportRes.reports);
        if (reportRes.reports.length > 0) setSelected(reportRes.reports[0]);
      } catch {
        // sem time ou sem relatórios
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function triggerReport() {
    if (!team) return;
    setTriggering(true);
    try {
      await apiFetch(`/teams/${team.id}/report/trigger`, { method: "POST", body: "{}" });
      alert("Relatório sendo gerado! Pode levar alguns minutos.");
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setTriggering(false);
    }
  }

  if (loading) return <div className="loading">Carregando...</div>;

  // Sem relatórios reais ainda → cai nos dados de exemplo (selo "Dados de exemplo").
  const isDemo = reports.length === 0;
  const list: any[] = isDemo ? DEMO_REPORTS : reports;
  const current = selected ?? list[0];
  const rd = current?.reportData;

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div>
            <div className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              Relatórios semanais
              {isDemo && (
                <span className="badge badge-gray" style={{ fontSize: 10, fontWeight: 700 }}>Dados de exemplo</span>
              )}
            </div>
            <div className="page-subtitle">
              {isDemo
                ? "Prévia ilustrativa — os relatórios reais aparecem aqui assim que o time registrar ligações"
                : "Gerados automaticamente toda sexta-feira"}
            </div>
          </div>
          <button className="btn btn-primary" onClick={triggerReport} disabled={triggering || !team}>
            {triggering ? "Gerando..." : "↻ Gerar agora"}
          </button>
        </div>
      </div>

      <div className="content">
        <div className="grid-2" style={{ alignItems: "flex-start" }}>
            {/* Report list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {list.map((r) => (
                <div
                  key={r.id}
                  onClick={() => setSelected(r)}
                  style={{
                    background: current?.id === r.id ? "var(--bg-hover)" : "var(--bg-card)",
                    border: `1px solid ${current?.id === r.id ? "var(--green)" : "var(--border)"}`,
                    borderRadius: 10, padding: "14px 16px", cursor: "pointer", transition: "all 0.15s",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    Semana de {new Date(r.weekStart).toLocaleDateString("pt-BR")}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    até {new Date(r.weekEnd).toLocaleDateString("pt-BR")}
                    {r.emailSentAt && <span style={{ color: "var(--green)", marginLeft: 8 }}>✓ e-mail enviado</span>}
                  </div>
                  {r.reportData?.callsTotal !== undefined && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>
                      {r.reportData.callsTotal} ligações · {r.reportData.meetingsBooked} reuniões
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Report detail */}
            {rd && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Metrics */}
                <div className="card">
                  <div className="card-title">Métricas da semana</div>
                  <div className="metric-row">
                    <span className="metric-name">Total de ligações</span>
                    <span className="metric-val">{rd.callsTotal ?? "—"}</span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-name">Meta ({rd.callsGoal ?? "—"})</span>
                    <span className="metric-val" style={{ color: (rd.callsTotal ?? 0) >= (rd.callsGoal ?? 0) ? "var(--green)" : "var(--red)" }}>
                      {rd.callsGoal ? `${Math.round(((rd.callsTotal ?? 0) / rd.callsGoal) * 100)}%` : "—"}
                    </span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-name">Reuniões marcadas</span>
                    <span className="metric-val" style={{ color: "var(--blue)" }}>{rd.meetingsBooked ?? "—"}</span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-name">Taxa de conversão</span>
                    <span className="metric-val" style={{ color: "var(--green)" }}>
                      {rd.conversionRate != null ? `${(rd.conversionRate * 100).toFixed(1)}%` : "—"}
                    </span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-name">Leads enriquecidos</span>
                    <span className="metric-val">{rd.leadsEnriched ?? "—"}</span>
                  </div>
                </div>

                {/* Executive summary */}
                {rd.executiveSummary && (
                  <div className="card">
                    <div className="card-title">Resumo executivo</div>
                    <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.75 }}>
                      {rd.executiveSummary}
                    </p>
                  </div>
                )}

                {/* Bottlenecks */}
                {rd.bottlenecks?.length > 0 && (
                  <div className="card">
                    <div className="card-title">Gargalos</div>
                    {rd.bottlenecks.map((b: any, i: number) => (
                      <div key={i} style={{
                        borderLeft: "3px solid var(--yellow)",
                        paddingLeft: 12, marginBottom: 14,
                      }}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{b.area}</div>
                        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 4 }}>{b.description}</div>
                        {b.recommendation && (
                          <div style={{ fontSize: 12, color: "var(--green)" }}>→ {b.recommendation}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Member diagnoses */}
                {rd.memberDiagnoses?.length > 0 && (
                  <div className="card">
                    <div className="card-title">Diagnóstico por membro</div>
                    {rd.memberDiagnoses.map((m: any, i: number) => (
                      <div key={i} style={{
                        background: "var(--bg-surface)", borderRadius: 8,
                        padding: "12px 14px", marginBottom: 10,
                      }}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{m.userName ?? m.name}</div>
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--text-secondary)" }}>
                          {m.callsCount != null && <span>{m.callsCount} ligações</span>}
                          {m.conversionRate != null && (
                            <span style={{ color: "var(--green)" }}>{(m.conversionRate * 100).toFixed(0)}% conversão</span>
                          )}
                          {m.avgTalkRatio != null && <span>Talk ratio: {(m.avgTalkRatio * 100).toFixed(0)}%</span>}
                        </div>
                        {/* Fase 5 — foco de desenvolvimento + progresso nas skills */}
                        {m.focusSkills?.length > 0 && (
                          <div style={{ fontSize: 12, color: "var(--blue)", marginTop: 6 }}>
                            Foco de desenvolvimento: {m.focusSkills.join(", ")}
                          </div>
                        )}
                        {m.skillProgress && (
                          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.5 }}>
                            <strong style={{ color: "var(--yellow)" }}>Evolução:</strong> {m.skillProgress}
                          </div>
                        )}
                        {m.coachingFocus && !m.skillProgress && (
                          <div style={{ fontSize: 12, color: "var(--yellow)", marginTop: 6 }}>
                            Foco: {m.coachingFocus}
                          </div>
                        )}
                        {m.weekGoal && (
                          <div style={{ fontSize: 12, color: "var(--green)", marginTop: 4 }}>
                            → Meta da semana: {m.weekGoal}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
      </div>
    </>
  );
}
