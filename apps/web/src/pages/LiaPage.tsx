import React, { useEffect, useState } from "react";
import { Bot, MessageSquare, PhoneCall, CalendarClock } from "lucide-react";
import { apiFetch } from "../lib/api";

// Painel da Lia (assistente de SDR do Limo). Espelha o estado que o motor da
// Lia — que roda LOCAL — persiste em lia_leads/lia_events. Manager-only (a API
// gateia; o item de menu também). Read-only: aqui só se acompanha.

interface FunnelStage { etapa: string; total: number; }
interface Kpis {
  totalLeads: number;
  leadsContatados: number;
  toquesEnviados: number;
  respostas: number;
  reunioesMarcadas: number;
  objecoesContornadas: number;
  taxaResposta: number;
}
interface FunnelResp { funnel: FunnelStage[]; kpis: Kpis; }

interface Respondeu { id: number; nome: string; empresa: string; whatsapp: string; etapa: string; objecao: string; }
interface ATocar {
  id: number; nome: string; empresa: string; whatsapp: string;
  origem: string; etapa: string; diaCadencia: number; proximaAcao: string | null;
}
interface BriefingResp { data: string; responderam: Respondeu[]; aTocar: ATocar[]; }

interface Lead {
  id: number; nome: string; empresa: string; cargo: string; email: string; whatsapp: string;
  origem: string; etapa: string; diaCadencia: number; proximaAcao: string | null;
  respondeu: boolean; closer: string; observacoes: string;
}
interface LeadsResp { leads: Lead[]; }

// Cores por etapa do funil (frio -> cliente).
const STAGE_COLOR: Record<string, string> = {
  "Novo": "#94a3b8",
  "Em Cadência": "#6366f1",
  "Engajado": "#3b82f6",
  "Trial Ativo": "#f59e0b",
  "Cliente": "var(--accent-solid, #a3e635)",
  "Perdido": "#ef4444",
};

const fone = (w: string) => (w ? w : "(sem telefone)");
const dataBR = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—";

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 22px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 900, color: "var(--accent)", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function StageBar({ etapa, value, max }: { etapa: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
        <span style={{ fontWeight: 600, color: "var(--text)" }}>{etapa}</span>
        <span style={{ fontWeight: 900, color: "var(--text)" }}>{value}</span>
      </div>
      <div style={{ background: "var(--border)", borderRadius: 4, height: 8 }}>
        <div style={{ height: 8, borderRadius: 4, background: STAGE_COLOR[etapa] ?? "var(--accent)", width: `${pct}%`, transition: "width 0.6s" }} />
      </div>
    </div>
  );
}

function StageBadge({ etapa }: { etapa: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
      color: "#fff", background: STAGE_COLOR[etapa] ?? "#94a3b8", whiteSpace: "nowrap",
    }}>
      {etapa}
    </span>
  );
}

export function LiaPage() {
  const [funnel, setFunnel] = useState<FunnelResp | null>(null);
  const [briefing, setBriefing] = useState<BriefingResp | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<FunnelResp>("/lia/funnel").then(setFunnel).catch(() => {}),
      apiFetch<BriefingResp>("/lia/briefing").then(setBriefing).catch(() => {}),
      apiFetch<LeadsResp>("/lia/leads").then((r) => setLeads(r.leads)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 32 }} className="empty-state">Carregando painel da Lia...</div>;

  const k = funnel?.kpis;
  const maxStage = Math.max(...(funnel?.funnel.map((s) => s.total) ?? [0]), 1);
  const semLeads = leads.length === 0;

  const card = { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, padding: "22px 24px" } as const;
  const cardTitle = { fontSize: 13, fontWeight: 900, color: "var(--text)", marginBottom: 18, display: "flex", alignItems: "center", gap: 8 } as const;

  return (
    <div style={{ padding: "32px 28px", maxWidth: 980 }}>
      <div className="topbar">
        <div className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Bot size={20} style={{ color: "var(--accent)" }} /> Lia
        </div>
        <div className="page-subtitle">
          Assistente de BDR — cadência de e-mail e WhatsApp automática. Aqui você acompanha o funil e assume quem responde.
        </div>
      </div>

      {semLeads ? (
        <div style={{ ...card, textAlign: "center", padding: "40px 24px" }}>
          <Bot size={32} style={{ color: "var(--muted)", marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
            A Lia ainda não tem leads
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", maxWidth: 460, margin: "0 auto", lineHeight: 1.6 }}>
            O combustível vem do Garimpo: rode uma persona, importe os leads pro motor da Lia e eles aparecem aqui
            conforme ela toca a cadência.
          </div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="head-kpis" style={{ marginBottom: 28 }}>
            <Stat label="Leads na base" value={k?.totalLeads ?? 0} sub={`${k?.leadsContatados ?? 0} já contatados`} />
            <Stat label="Toques enviados" value={k?.toquesEnviados ?? 0} sub="E-mail + WhatsApp" />
            <Stat label="Respostas" value={k?.respostas ?? 0} sub={`Taxa: ${((k?.taxaResposta ?? 0) * 100).toFixed(1)}%`} />
            <Stat label="Reuniões marcadas" value={k?.reunioesMarcadas ?? 0} sub={`${k?.objecoesContornadas ?? 0} objeções contornadas`} />
          </div>

          <div className="head-cols" style={{ marginBottom: 28 }}>
            {/* Funil */}
            <div style={card}>
              <div style={cardTitle}>Funil</div>
              {funnel?.funnel.map((s) => <StageBar key={s.etapa} etapa={s.etapa} value={s.total} max={maxStage} />)}
            </div>

            {/* Responderam — assumir primeiro */}
            <div style={card}>
              <div style={cardTitle}><MessageSquare size={15} style={{ color: "var(--accent)" }} /> Responderam — assuma você</div>
              {briefing && briefing.responderam.length > 0 ? (
                briefing.responderam.map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{r.nome}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.empresa} · {fone(r.whatsapp)}</div>
                    </div>
                    <StageBadge etapa={r.etapa} />
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "12px 0" }}>Ninguém novo respondeu.</div>
              )}
            </div>

            {/* A tocar hoje */}
            <div style={card}>
              <div style={cardTitle}><CalendarClock size={15} style={{ color: "var(--accent)" }} /> Toques previstos (hoje/atrasados)</div>
              {briefing && briefing.aTocar.length > 0 ? (
                briefing.aTocar.slice(0, 12).map((a) => (
                  <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{a.nome}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{a.empresa} · dia {a.diaCadencia} · {dataBR(a.proximaAcao)}</div>
                    </div>
                    <StageBadge etapa={a.etapa} />
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "12px 0" }}>Nenhum toque previsto.</div>
              )}
            </div>
          </div>

          {/* Tabela de leads */}
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <div style={{ ...cardTitle, padding: "20px 24px 0", marginBottom: 0 }}>
              <PhoneCall size={15} style={{ color: "var(--accent)" }} /> Todos os leads ({leads.length})
            </div>
            <div style={{ overflowX: "auto", marginTop: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    <th style={{ padding: "8px 24px" }}>Lead</th>
                    <th style={{ padding: "8px 12px" }}>Etapa</th>
                    <th style={{ padding: "8px 12px" }}>Origem</th>
                    <th style={{ padding: "8px 12px" }}>Dia</th>
                    <th style={{ padding: "8px 12px" }}>Próx. ação</th>
                    <th style={{ padding: "8px 24px" }}>WhatsApp</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 24px" }}>
                        <div style={{ fontWeight: 600, color: "var(--text)" }}>{l.nome}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{l.empresa || "—"}</div>
                      </td>
                      <td style={{ padding: "10px 12px" }}><StageBadge etapa={l.etapa} /></td>
                      <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{l.origem || "—"}</td>
                      <td style={{ padding: "10px 12px", color: "var(--text)" }}>{l.diaCadencia}</td>
                      <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{dataBR(l.proximaAcao)}</td>
                      <td style={{ padding: "10px 24px", color: "var(--muted)" }}>{fone(l.whatsapp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
