import React, { useEffect, useState } from "react";
import { AlertTriangle, Gauge } from "lucide-react";
import { apiFetch } from "../lib/api";

// ─── Pool da Assertiva (consumo) — visível só pro dono ───────────────────────
interface AssertivaUsage {
  source: "estimated" | "official";
  queries: number;
  matchedQueries: number;
  costPerQueryBrl: number;
  poolBrl: number;
  estCostBrl: number;
  pctUsed: number;
  remainingQueries: number;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function AssertivaPoolCard() {
  const [usage, setUsage] = useState<AssertivaUsage | null>(null);

  useEffect(() => {
    // Endpoint é owner-only: se não for o dono, retorna 403 e o card some.
    apiFetch<AssertivaUsage>("/admin/assertiva/usage").then(setUsage).catch(() => {});
  }, []);

  if (!usage) return null;

  const pct = Math.min(100, usage.pctUsed);
  const barColor = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "var(--accent, #a3e635)";

  return (
    <div style={{
      background: "var(--card-bg)", border: "1px solid var(--border)",
      borderRadius: 12, padding: "20px 22px", marginBottom: 28,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Gauge size={16} style={{ color: "var(--accent)" }} />
        <span style={{ fontSize: 13, fontWeight: 900, color: "var(--text)" }}>Pool de enriquecimento</span>
        <span className="badge badge-gray" style={{ fontSize: 10, fontWeight: 700, marginLeft: "auto" }}>
          {usage.source === "official" ? "Saldo oficial" : "Estimado"}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
        Consumo do mês corrente · {usage.queries} consulta(s) · {brl(usage.estCostBrl)} de {brl(usage.poolBrl)}
      </div>

      <div style={{ background: "var(--border)", borderRadius: 5, height: 10, marginBottom: 8 }}>
        <div style={{ height: 10, borderRadius: 5, background: barColor, width: `${pct}%`, transition: "width 0.6s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
        <span><strong style={{ color: "var(--text)" }}>{usage.pctUsed}%</strong> usado</span>
        <span>~<strong style={{ color: "var(--text)" }}>{usage.remainingQueries}</strong> consultas restantes</span>
      </div>
      {usage.source === "estimated" && (
        <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
          Estimativa: {usage.queries} consulta(s) × {brl(usage.costPerQueryBrl)} (lote). Saldo oficial quando disponível.
        </div>
      )}
    </div>
  );
}

interface HeadData {
  teamSize: number;
  callsThisMonth: number;
  forecastCalls: number;
  totalTarget: number;
  goalsProgress: number;
  totalContacts: number;
  listsCount: number;
  sources: { source: string; count: number }[];
  funnel: { totalCalls: number; connected: number; interested: number; meetings: number };
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{
      background: "var(--card-bg)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: "20px 22px",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 900, color: "var(--accent)", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
        <span style={{ fontWeight: 600, color: "var(--text)" }}>{label}</span>
        <span style={{ fontWeight: 900, color: "var(--text)" }}>{value} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({pct}%)</span></span>
      </div>
      <div style={{ background: "var(--border)", borderRadius: 4, height: 8 }}>
        <div style={{ height: 8, borderRadius: 4, background: color, width: `${pct}%`, transition: "width 0.6s" }} />
      </div>
    </div>
  );
}

// Dados ilustrativos exibidos quando o time ainda não tem métricas reais —
// pra o painel não nascer vazio. Sinalizados com o selo "Dados de exemplo".
const DEMO_HEAD: HeadData = {
  teamSize: 6,
  callsThisMonth: 342,
  forecastCalls: 410,
  totalTarget: 400,
  goalsProgress: 78,
  totalContacts: 1240,
  listsCount: 8,
  sources: [
    { source: "Garimpo IA", count: 540 },
    { source: "Extensão LinkedIn", count: 388 },
    { source: "Importação manual", count: 212 },
    { source: "Descobrir", count: 100 },
  ],
  funnel: { totalCalls: 980, connected: 612, interested: 264, meetings: 87 },
};

export function HeadPanelPage() {
  const [data, setData] = useState<HeadData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<HeadData>("/analytics/head")
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 32 }} className="empty-state">Carregando painel estratégico...</div>;

  // Sem métricas reais ainda → mostra dados ilustrativos com selo de exemplo.
  const isDemo = !data || (data.callsThisMonth === 0 && data.totalContacts === 0);
  const view = isDemo ? DEMO_HEAD : data;

  const maxSource = Math.max(...(view.sources.map((s) => s.count)), 1);

  return (
    <div style={{ padding: "32px 28px", maxWidth: 900 }}>
      <div className="topbar">
        <div className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          Painel Head
          {isDemo && (
            <span className="badge badge-gray" style={{ fontSize: 10, fontWeight: 700 }}>Dados de exemplo</span>
          )}
        </div>
        <div className="page-subtitle">
          {isDemo
            ? "Prévia ilustrativa — os números reais aparecem assim que o time registrar ligações e contatos"
            : "Visão estratégica do processo comercial"}
        </div>
      </div>

      {/* Pool da Assertiva — renderiza só pro dono */}
      <AssertivaPoolCard />

      {/* KPIs */}
      <div className="head-kpis" style={{ marginBottom: 28 }}>
        <Stat label="Membros no time" value={view.teamSize} />
        <Stat label="Ligações este mês" value={view.callsThisMonth} sub={`Meta: ${view.totalTarget}`} />
        <Stat label="Previsão do mês" value={view.forecastCalls} sub="Baseada no ritmo atual" />
        <Stat label="Progresso das metas" value={`${view.goalsProgress}%`} sub={`${view.listsCount} listas ativas`} />
      </div>

      <div className="head-cols">
        {/* Funil de prospecção */}
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, padding: "22px 24px" }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", marginBottom: 18 }}>
            Funil de Prospecção (últimos 3 meses)
          </div>
          <FunnelBar label="Total de ligações" value={view.funnel.totalCalls} max={view.funnel.totalCalls} color="#6366f1" />
          <FunnelBar label="Conectadas" value={view.funnel.connected} max={view.funnel.totalCalls} color="#3b82f6" />
          <FunnelBar label="Interessados" value={view.funnel.interested} max={view.funnel.totalCalls} color="#f59e0b" />
          <FunnelBar label="Reuniões agendadas" value={view.funnel.meetings} max={view.funnel.totalCalls} color="var(--accent-solid, #a3e635)" />
          {view.funnel.totalCalls === 0 && (
            <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", marginTop: 16 }}>
              Nenhuma ligação registrada ainda.
            </div>
          )}
        </div>

        {/* Fontes de lead */}
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, padding: "22px 24px" }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", marginBottom: 18 }}>
            Fontes de Lead
          </div>
          {view.sources.map((s) => (
            <FunnelBar key={s.source} label={s.source} value={s.count} max={maxSource} color="var(--accent)" />
          ))}
          <div style={{ marginTop: 16, padding: "12px 14px", background: "rgba(163,230,53,0.08)", borderRadius: 8, fontSize: 12, color: "var(--muted)" }}>
            Total de contatos em todas as listas: <strong style={{ color: "var(--text)" }}>{view.totalContacts}</strong>
          </div>
        </div>

        {/* Análise de ICP */}
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, padding: "22px 24px" }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", marginBottom: 8 }}>
            Análise de ICP
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
            Perfil ideal de cliente baseado nas conversões do time
          </div>
          {view.funnel.meetings > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {["Empresas de 50–500 funcionários", "Setor de tecnologia e serviços", "Decisores: CEO, Diretor Comercial", "Ciclo de venda: 15–45 dias"].map((item) => (
                <div key={item} style={{ display: "flex", gap: 8, fontSize: 13, color: "var(--text)" }}>
                  <span style={{ color: "var(--accent)", fontWeight: 900, flexShrink: 0 }}>✓</span>
                  {item}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "16px 0" }}>
              Registre ligações e reuniões para gerar análise de ICP.
            </div>
          )}
        </div>

        {/* Forecast e burn rate */}
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, padding: "22px 24px" }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", marginBottom: 16 }}>
            Forecast & Burn Rate
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--bg, #f4f7fb)", borderRadius: 8 }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Projeção de ligações no mês</span>
              <span style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{view.forecastCalls}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--bg, #f4f7fb)", borderRadius: 8 }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Meta total do time</span>
              <span style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{view.totalTarget}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--bg, #f4f7fb)", borderRadius: 8 }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Listas ativas (burn rate)</span>
              <span style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{view.listsCount} listas · {view.totalContacts} contatos</span>
            </div>
            <div style={{
              padding: "10px 14px",
              background: view.forecastCalls >= view.totalTarget ? "rgba(163,230,53,0.1)" : "rgba(239,68,68,0.08)",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              color: view.forecastCalls >= view.totalTarget ? "#4a7c00" : "#ef4444",
            }}>
              {view.forecastCalls >= view.totalTarget
                ? "✓ O time está no caminho certo para bater a meta"
                : <><AlertTriangle size={13} style={{ verticalAlign: "middle" }} /> Ritmo atual não atinge a meta do mês</>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
