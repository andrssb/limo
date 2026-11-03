import React, { useEffect, useState } from "react";
import { apiFetch, cachedGet } from "../lib/api";

const ORIGIN_LABEL: Record<string, string> = {
  inbound: "Inbound", outbound: "Outbound", referral: "Indicação", partner: "Parceiro", other: "Outro",
};

type Tab = "geral" | "outbound";

export function QualificationInsightsPage() {
  const [tab, setTab] = useState<Tab>("geral");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [outbound, setOutbound] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const path = tab === "geral" ? `/qualification/insights?days=${days}` : `/qualification/outbound?days=${days}`;
    cachedGet<any>(path)
      .then((r) => (tab === "geral" ? setData(r) : setOutbound(r)))
      .catch(() => (tab === "geral" ? setData(null) : setOutbound(null)))
      .finally(() => setLoading(false));
  }, [days, tab]);

  const f = data?.funnel;
  const insights = data?.insights;
  const qualRate = f?.total ? Math.round((f.qualified / f.total) * 100) : 0;
  const ob = outbound?.stats;
  const obIns = outbound?.insights;

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div>
            <div className="page-title">Qualificação de leads</div>
            <div className="page-subtitle">Funil de qualificação e insights estratégicos para Marketing e Vendas</div>
          </div>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)", fontSize: 13 }}
          >
            <option value={30}>Últimos 30 dias</option>
            <option value={60}>Últimos 60 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          {([["geral", "Visão geral"], ["outbound", "Inteligência de Outbound"]] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: "7px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                border: `1px solid ${tab === key ? "var(--green)" : "var(--border)"}`,
                background: tab === key ? "var(--green-bg)" : "var(--bg-card)",
                color: tab === key ? "var(--green)" : "var(--text-muted)",
              }}
            >{label}</button>
          ))}
        </div>
      </div>

      <div className="content">
        {loading ? (
          <div className="loading">Carregando...</div>
        ) : tab === "geral" ? (
          !f || f.total === 0 ? (
            <EmptyCard text="Nenhum lead qualificado no período. Qualifique leads na tela de um contato para alimentar os insights." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="card">
                <div className="card-title">Funil do período</div>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  <Stat label="Leads avaliados" value={f.total} />
                  <Stat label="Qualificados" value={f.qualified} color="var(--green)" />
                  <Stat label="Parciais" value={f.partial} color="var(--yellow)" />
                  <Stat label="Desqualificados" value={f.disqualified} color="var(--red)" />
                  <Stat label="Taxa de qualificação" value={`${qualRate}%`} color="var(--green)" />
                  <Stat label="Score médio ICP" value={`${Math.round(f.avgScore)}/100`} />
                </div>
                <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(f.byOrigin as Record<string, number>).filter(([, v]) => v > 0).map(([k, v]) => (
                    <span key={k} style={{ fontSize: 11.5, color: "var(--text-secondary)", background: "var(--bg-surface)", borderRadius: 6, padding: "4px 10px" }}>
                      {ORIGIN_LABEL[k] ?? k}: <strong>{v}</strong>
                    </span>
                  ))}
                </div>
              </div>

              {insights?.summary && (
                <div className="card">
                  <div className="card-title">Leitura geral</div>
                  <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.7 }}>{insights.summary}</p>
                </div>
              )}

              {insights?.topDisqualReasons?.length > 0 && (
                <div className="card">
                  <div className="card-title">Principais motivos de desqualificação</div>
                  {insights.topDisqualReasons.map((r: string, i: number) => (
                    <div key={i} style={{ borderLeft: "3px solid var(--red)", paddingLeft: 12, marginBottom: 10, fontSize: 13, color: "var(--text-secondary)" }}>{r}</div>
                  ))}
                </div>
              )}

              <div className="grid-2" style={{ alignItems: "flex-start" }}>
                <RecoCard title="Recomendações para Marketing" items={insights?.marketing} color="var(--blue)" />
                <RecoCard title="Recomendações para Vendas" items={insights?.sales} color="var(--green)" />
              </div>
            </div>
          )
        ) : (
          /* ── Aba Outbound ── */
          !ob || ob.total === 0 ? (
            <EmptyCard text="Sem prospecção outbound no período. Leads classificados como Outbound aparecem aqui." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="card">
                <div className="card-title">Prospecção outbound do período</div>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  <Stat label="Leads prospectados" value={ob.total} />
                  <Stat label="Viraram oportunidade" value={ob.opportunities} color="var(--green)" />
                  <Stat label="Desqualificados" value={ob.disqualified} color="var(--red)" />
                  <Stat label="Aderência ICP média" value={`${Math.round(ob.avgIcpFit)}/100`} />
                  <Stat label="Tempo médio em tratativa" value={`${Math.round(ob.avgDaysInPipeline)}d`} />
                </div>
                <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11.5, color: "var(--text-secondary)", background: "var(--bg-surface)", borderRadius: 6, padding: "4px 10px" }}>Ligações: <strong>{ob.channels.calls}</strong></span>
                  <span style={{ fontSize: 11.5, color: "var(--text-secondary)", background: "var(--bg-surface)", borderRadius: 6, padding: "4px 10px" }}>WhatsApp: <strong>{ob.channels.whatsapp}</strong></span>
                  <span style={{ fontSize: 11.5, color: "var(--text-secondary)", background: "var(--bg-surface)", borderRadius: 6, padding: "4px 10px" }}>LinkedIn: <strong>{ob.channels.linkedin}</strong></span>
                </div>
              </div>

              {obIns?.summary && (
                <div className="card">
                  <div className="card-title">Saúde da prospecção</div>
                  <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.7 }}>{obIns.summary}</p>
                </div>
              )}

              <div className="grid-2" style={{ alignItems: "flex-start" }}>
                <RecoCard title="Fatores de sucesso" items={obIns?.successFactors} color="var(--green)" />
                <RecoCard title="Motivos de perda" items={obIns?.lossReasons} color="var(--red)" />
              </div>
              <RecoCard title="Aprendizados para as próximas prospecções" items={obIns?.learnings} color="var(--blue)" />
            </div>
          )
        )}
      </div>
    </>
  );
}

function EmptyCard({ text }: { text: string }) {
  return <div className="card" style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>{text}</div>;
}

function Stat({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color ?? "var(--text)" }}>{value}</div>
    </div>
  );
}

function RecoCard({ title, items, color }: { title: string; items?: string[]; color: string }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      {items && items.length > 0 ? (
        items.map((it, i) => (
          <div key={i} style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8, lineHeight: 1.55, display: "flex", gap: 8 }}>
            <span style={{ color }}>→</span> <span>{it}</span>
          </div>
        ))
      ) : (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Sem dados no período.</div>
      )}
    </div>
  );
}
