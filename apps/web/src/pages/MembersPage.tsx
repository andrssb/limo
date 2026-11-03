import React, { useEffect, useState } from "react";
import { apiFetch, cachedGet, getStoredUser } from "../lib/api";

const FEEDBACK_TYPES = [
  { value: "talk_ratio",          label: "Talk Ratio" },
  { value: "objection_handling",  label: "Contorno de Objeções" },
  { value: "discovery",           label: "Descoberta" },
  { value: "closing",             label: "Fechamento" },
  { value: "rapport",             label: "Rapport" },
] as const;

type FeedbackType = typeof FEEDBACK_TYPES[number]["value"];

interface FeedbackModal {
  userId: string;
  userName: string;
}

export function MembersPage() {
  const [members, setMembers]   = useState<any[]>([]);
  const [team, setTeam]         = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState<FeedbackModal | null>(null);
  const [devModal, setDevModal] = useState<FeedbackModal | null>(null);
  const currentUser             = getStoredUser();
  const isManager               = currentUser?.role === "manager" || currentUser?.role === "admin";

  useEffect(() => {
    cachedGet<{ team: any; members: any[] }>("/teams/mine")
      .then((r) => { setTeam(r.team); setMembers(r.members); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Carregando...</div>;

  const sdrs     = members.filter((m) => m.role !== "manager");
  const managers = members.filter((m) => m.role === "manager");

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div>
            <div className="page-title">Membros</div>
            <div className="page-subtitle">{team?.name} · {members.length} pessoa{members.length !== 1 ? "s" : ""}</div>
          </div>
        </div>
      </div>

      <div className="content">
        {managers.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Gestores</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nome</th><th>E-mail</th><th>Papel</th><th>Membro desde</th>
                  </tr>
                </thead>
                <tbody>
                  {managers.map((m) => (
                    <tr key={m.id}>
                      <td style={{ color: "var(--text)", fontWeight: 500 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <Avatar name={m.name} green />
                          {m.name}
                        </div>
                      </td>
                      <td>{m.email}</td>
                      <td><span className="badge badge-green">{m.role}</span></td>
                      <td>{new Date(m.createdAt).toLocaleDateString("pt-BR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-title">BDRs ({sdrs.length})</div>
          {sdrs.length === 0 ? (
            <div className="empty">
              Nenhum BDR ainda.<br />
              <span style={{ fontSize: 12 }}>Vá em Convites para gerar um código e convidar sua equipe.</span>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nome</th><th>E-mail</th><th>Papel</th><th>Membro desde</th>
                    {isManager && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {sdrs.map((m) => (
                    <tr key={m.id}>
                      <td style={{ color: "var(--text)", fontWeight: 500 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <Avatar name={m.name} />
                          {m.name}
                        </div>
                      </td>
                      <td>{m.email}</td>
                      <td><span className="badge badge-gray">{m.role}</span></td>
                      <td>{new Date(m.createdAt).toLocaleDateString("pt-BR")}</td>
                      {isManager && (
                        <td>
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setDevModal({ userId: m.id, userName: m.name })}
                            >
                              Desenvolvimento
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setModal({ userId: m.id, userName: m.name })}
                            >
                              + Feedback
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modal && (
        <FeedbackModalDialog
          target={modal}
          onClose={() => setModal(null)}
        />
      )}

      {devModal && (
        <DevelopmentModalDialog
          target={devModal}
          onClose={() => setDevModal(null)}
        />
      )}
    </>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, green }: { name: string; green?: boolean }) {
  const initials = name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%",
      background: green ? "var(--green-bg)" : "var(--bg-hover)",
      color: green ? "var(--green)" : "var(--text-secondary)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 11, fontWeight: 600, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

// ─── Feedback Modal ───────────────────────────────────────────────────────────

function FeedbackModalDialog({ target, onClose }: { target: FeedbackModal; onClose: () => void }) {
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("talk_ratio");
  const [feedbackText, setFeedbackText] = useState("");
  const [targetMetric, setTargetMetric] = useState("");
  const [baselineValue, setBaselineValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiFetch("/feedback", {
        method: "POST",
        body: JSON.stringify({
          userId: target.userId,
          feedbackType,
          feedbackText,
          targetMetric: targetMetric || FEEDBACK_TYPES.find((f) => f.value === feedbackType)!.label,
          baselineValue: parseFloat(baselineValue) || 0,
        }),
      });
      setSuccess(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "var(--bg-card)", border: "1px solid var(--border)",
        borderRadius: 14, padding: 28, width: 420, maxWidth: "90vw",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Dar Feedback</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{target.userName}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        {success ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: "var(--green)", fontSize: 13 }}>
            ✓ Feedback enviado com sucesso!
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Categoria</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {FEEDBACK_TYPES.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFeedbackType(f.value)}
                    className={`filter-btn${feedbackType === f.value ? " active" : ""}`}
                    style={{ fontSize: 11 }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Feedback</label>
              <textarea
                className="form-input"
                placeholder="Descreva o ponto de melhoria ou elogio..."
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                rows={4}
                required
                minLength={10}
                style={{ resize: "vertical" }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Métrica alvo <span style={{ color: "var(--text-muted)" }}>(opcional)</span></label>
                <input
                  className="form-input"
                  placeholder="ex: talk ratio"
                  value={targetMetric}
                  onChange={(e) => setTargetMetric(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Valor atual <span style={{ color: "var(--text-muted)" }}>(opcional)</span></label>
                <input
                  className="form-input"
                  type="number"
                  placeholder="ex: 0.75"
                  step="0.01"
                  value={baselineValue}
                  onChange={(e) => setBaselineValue(e.target.value)}
                />
              </div>
            </div>

            {error && <p className="error-msg" style={{ marginTop: 12 }}>{error}</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1, justifyContent: "center" }}>
                {loading ? "Enviando..." : "Enviar feedback"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Development Modal (Fase 5) ─────────────────────────────────────────────

const DEV_CRITERIA: [string, string][] = [
  ["opening", "Abertura"],
  ["painDiscovery", "Descoberta de dor"],
  ["solutionClarity", "Clareza da solução"],
  ["frameworkUsage", "Uso de framework"],
  ["advanceToDemo", "Condução até demo"],
];
function devColor(v: number): string {
  if (v >= 70) return "var(--green)";
  if (v >= 40) return "var(--yellow)";
  return "var(--red)";
}

function DevelopmentModalDialog({ target, onClose }: { target: FeedbackModal; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hard, setHard] = useState("");
  const [soft, setSoft] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await apiFetch<any>(`/members/${target.userId}/development?days=30`);
      setData(r);
      setHard((r.skills?.hardSkills ?? []).join(", "));
      setSoft((r.skills?.softSkills ?? []).join(", "));
      setNote(r.skills?.note ?? "");
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function saveSkills() {
    setSaving(true);
    try {
      const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
      await apiFetch(`/members/${target.userId}/skills`, {
        method: "PUT",
        body: JSON.stringify({ hardSkills: split(hard), softSkills: split(soft), note }),
      });
      await load(); // re-roda a IA com o novo foco
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  const avg = data?.avgScore;
  const trend = data?.trend;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 28, width: 560, maxWidth: "92vw", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Desenvolvimento</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{target.userName} · últimos 30 dias</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)", fontSize: 13 }}>Carregando...</div>
        ) : (
          <>
            {/* Skills definidas pelo gestor */}
            <div className="form-group">
              <label className="form-label">Hard skills a desenvolver <span style={{ color: "var(--text-muted)" }}>(separe por vírgula)</span></label>
              <input className="form-input" value={hard} onChange={(e) => setHard(e.target.value)} placeholder="ex: qualificação SPIN, uso de CRM" />
            </div>
            <div className="form-group">
              <label className="form-label">Soft skills a desenvolver</label>
              <input className="form-input" value={soft} onChange={(e) => setSoft(e.target.value)} placeholder="ex: escuta ativa, empatia, confiança" />
            </div>
            <div className="form-group">
              <label className="form-label">Observação do gestor <span style={{ color: "var(--text-muted)" }}>(opcional)</span></label>
              <textarea className="form-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} style={{ resize: "vertical" }} />
            </div>
            <button className="btn btn-secondary btn-sm" onClick={saveSkills} disabled={saving} style={{ marginBottom: 18 }}>
              {saving ? "Salvando..." : "Salvar foco de desenvolvimento"}
            </button>

            {/* Evolução pelos scores de ligação */}
            {data?.callCount === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", background: "var(--bg-surface)", borderRadius: 8, padding: "12px 14px" }}>
                Sem ligações analisadas no período. A evolução aparece conforme o profissional acumular ligações com análise (score).
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 26, fontWeight: 900, color: devColor(avg?.overall ?? 0) }}>{Math.round(avg?.overall ?? 0)}<span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>/100</span></div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{data.callCount} ligações</div>
                  {trend != null && (
                    <div style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: trend >= 0 ? "var(--green)" : "var(--red)" }}>
                      {trend >= 0 ? "▲" : "▼"} {trend >= 0 ? "+" : ""}{Math.round(trend)} pts vs período anterior
                    </div>
                  )}
                </div>

                {DEV_CRITERIA.map(([key, label]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", width: 130, flexShrink: 0 }}>{label}</div>
                    <div style={{ flex: 1, height: 6, background: "var(--bg-surface)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${Math.max(0, Math.min(100, avg?.[key] ?? 0))}%`, height: "100%", background: devColor(avg?.[key] ?? 0) }} />
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: devColor(avg?.[key] ?? 0), width: 26, textAlign: "right" }}>{Math.round(avg?.[key] ?? 0)}</div>
                  </div>
                ))}

                {data.ai && (
                  <div style={{ marginTop: 16 }}>
                    {data.ai.developmentNote && (
                      <p style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 12 }}>{data.ai.developmentNote}</p>
                    )}
                    <DevList title="Pontos fortes" items={data.ai.strengths} color="var(--green)" />
                    <DevList title="Oportunidades de melhoria" items={data.ai.improvements} color="var(--yellow)" />
                  </div>
                )}

                {data.history?.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Histórico recente</div>
                    {data.history.map((h: any, i: number) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: "var(--text-muted)", width: 80 }}>{new Date(h.date).toLocaleDateString("pt-BR")}</span>
                        <span style={{ fontWeight: 700, color: devColor(h.overall), width: 32 }}>{h.overall}</span>
                        <span style={{ color: "var(--text-secondary)" }}>{h.result ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DevList({ title, items, color }: { title: string; items?: string[]; color: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{title}</div>
      {items.map((it, i) => (
        <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 3, lineHeight: 1.5, display: "flex", gap: 7 }}>
          <span style={{ color }}>•</span> <span>{it}</span>
        </div>
      ))}
    </div>
  );
}
