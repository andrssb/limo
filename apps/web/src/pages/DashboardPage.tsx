import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch, cachedGet, getStoredUser, setStoredUser } from "../lib/api";
import { AlertTriangle, AlertOctagon, CheckCircle } from "lucide-react";

interface Alert {
  userId: string;
  name: string;
  type: string;
  message: string;
  severity: "warning" | "critical";
}

export function DashboardPage() {
  const [searchParams] = useSearchParams();
  const paymentSuccess = searchParams.get("payment") === "success";
  const [user, setUser] = useState<any>(getStoredUser());
  const [team, setTeam] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [contactTotal, setContactTotal] = useState<number | null>(null);
  const [report, setReport] = useState<any>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [teamRes, contactRes, meRes] = await Promise.all([
          cachedGet<{ team: any; members: any[] }>("/teams/mine"),
          cachedGet<{ total: number }>("/contacts?pageSize=1"),
          cachedGet<{ user: any }>("/auth/me"),
        ]);
        setStoredUser(meRes.user);
        setUser(meRes.user);
        setTeam(teamRes.team);
        setMembers(teamRes.members);
        setContactTotal(contactRes.total);

        const reportRes = await cachedGet<{ report: any }>(
          `/teams/${teamRes.team.id}/report/latest`
        ).catch(() => null);
        if (reportRes) setReport(reportRes.report.reportData);

        if (meRes.user.role === "manager" || meRes.user.role === "admin") {
          cachedGet<{ alerts: Alert[] }>("/analytics/alerts")
            .then((r) => setAlerts(r.alerts))
            .catch(() => {});
        }
      } catch {
        // silencioso se sem time
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="loading">Carregando...</div>;

  const callsTotal = report?.callsTotal ?? 0;
  const meetingsBooked = report?.meetingsBooked ?? 0;
  const conversionRate = report?.conversionRate
    ? `${(report.conversionRate * 100).toFixed(1)}%`
    : "—";

  return (
    <>
      <div className="topbar">
        <div className="page-title">Olá, {user?.name?.split(" ")[0]}!</div>
        <div className="page-subtitle">
          {team ? `Time: ${team.name}` : "Você ainda não pertence a um time"}
        </div>
      </div>

      <div className="content">
        {/* Payment success banner */}
        {paymentSuccess && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "14px 18px", borderRadius: 10, marginBottom: 16,
            background: "rgba(163,230,53,0.12)", border: "1px solid rgba(163,230,53,0.35)",
          }}>
            <CheckCircle size={18} style={{ color: "var(--green)", flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>
                Pagamento confirmado!
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Sua assinatura está ativa. Bem-vindo ao plano {searchParams.get("plan") ?? ""}!
              </div>
            </div>
          </div>
        )}

        {/* Performance Alerts */}
        {alerts.length > 0 && (
          <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.map((alert) => (
              <div key={alert.userId} style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "12px 16px",
                borderRadius: 10,
                background: alert.severity === "critical" ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)",
                border: `1px solid ${alert.severity === "critical" ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.3)"}`,
              }}>
                <span style={{ flexShrink: 0, color: alert.severity === "critical" ? "var(--red)" : "var(--yellow)", display: "flex" }}>
                  {alert.severity === "critical" ? <AlertOctagon size={18} strokeWidth={2} /> : <AlertTriangle size={18} strokeWidth={2} />}
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
                    Alerta de Performance
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
                    {alert.message}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Contatos cadastrados</div>
            <div className="stat-value green">{contactTotal ?? "—"}</div>
            <div className="stat-sub">total do time</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Ligações na semana</div>
            <div className="stat-value">{callsTotal}</div>
            <div className="stat-sub">últimos 7 dias</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Reuniões marcadas</div>
            <div className="stat-value blue">{meetingsBooked}</div>
            <div className="stat-sub">últimos 7 dias</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Conversão</div>
            <div className="stat-value green">{conversionRate}</div>
            <div className="stat-sub">ligação → reunião</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Membros no time</div>
            <div className="stat-value">{members.length}</div>
            <div className="stat-sub">BDRs</div>
          </div>
        </div>

        {/* Members table */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Equipe</div>
          {members.length === 0 ? (
            <div className="empty">Nenhum membro ainda. Crie um convite para adicionar BDRs.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>E-mail</th>
                    <th>Papel</th>
                    <th>Desde</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td style={{ color: "var(--text)", fontWeight: 500 }}>{m.name}</td>
                      <td>{m.email}</td>
                      <td>
                        <span className={`badge ${m.role === "manager" ? "badge-green" : "badge-gray"}`}>
                          {m.role}
                        </span>
                      </td>
                      <td>{new Date(m.createdAt).toLocaleDateString("pt-BR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Latest report summary */}
        {report?.executiveSummary && (
          <div className="card">
            <div className="card-title">Resumo do último relatório semanal</div>
            <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              {report.executiveSummary}
            </p>
            {report.bottlenecks?.length > 0 && (
              <>
                <div className="sep" />
                <div className="card-title">Gargalos identificados</div>
                {report.bottlenecks.map((b: any, i: number) => (
                  <div key={i} style={{
                    background: "var(--bg-surface)", borderRadius: 8, padding: "10px 14px",
                    marginBottom: 8, borderLeft: "3px solid var(--yellow)",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{b.area}</div>
                    <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{b.description}</div>
                    {b.recommendation && (
                      <div style={{ fontSize: 12, color: "var(--green)", marginTop: 4 }}>
                        → {b.recommendation}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {!report && (
          <div className="card">
            <div className="empty">
              Nenhum relatório gerado ainda.<br />
              <span style={{ fontSize: 12 }}>Relatórios são gerados automaticamente toda sexta-feira às 8h.</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
