import React, { useEffect, useState } from "react";
import { apiFetch, cachedGet, getStoredUser } from "../lib/api";
import { Trophy, Target, Plus, Loader2, TrendingUp, Award, Phone, Medal, User, Users } from "lucide-react";

const METRIC_LABELS: Record<string, string> = {
  calls: "Ligações", contacts_added: "Contatos adicionados",
  meetings: "Reuniões", deals: "Negócios fechados",
};
const PERIOD_LABELS: Record<string, string> = { daily: "Diária", weekly: "Semanal", monthly: "Mensal" };
const BADGE_ICON: Record<string, React.ReactNode> = {
  first_call: <Phone size={30} />, calls_10: <Medal size={30} />, calls_50: <TrendingUp size={30} />, calls_100: <Target size={30} />,
  first_contact: <User size={30} />, contacts_25: <Users size={30} />, contacts_100: <Trophy size={30} />,
};

function ProgressBar({ value, max }: { value: number; max: number | null }) {
  if (!max) return null;
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>
        <span>{value} / {max}</span><span>{pct}%</span>
      </div>
      <div style={{ height: 6, background: "var(--bg-surface)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: pct >= 100 ? "var(--green)" : "var(--green)", borderRadius: 4, opacity: pct >= 100 ? 1 : 0.6, transition: "width 0.5s" }} />
      </div>
    </div>
  );
}

export function GoalsPage() {
  const user = getStoredUser();
  const isManager = user?.role === "manager" || user?.role === "admin";

  const [leaderboard, setLeaderboard]   = useState<any[]>([]);
  const [goals, setGoals]               = useState<any[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [members, setMembers]           = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
  const [tab, setTab]                   = useState<"leaderboard" | "goals" | "badges">("leaderboard");
  const [showNew, setShowNew]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [form, setForm] = useState({
    userId: "", metric: "calls", target: "20", period: "monthly",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10),
  });

  async function load() {
    setLoading(true);
    try {
      const [lbRes, gRes, achRes] = await Promise.all([
        cachedGet<{ leaderboard: any[] }>("/goals/leaderboard"),
        cachedGet<{ goals: any[] }>("/goals"),
        cachedGet<{ achievements: any[] }>("/goals/achievements"),
      ]);
      setLeaderboard(lbRes.leaderboard);
      setGoals(gRes.goals);
      setAchievements(achRes.achievements);

      if (isManager) {
        const { members: m } = await cachedGet<{ members: any[] }>("/teams/members");
        setMembers(m.filter((u: any) => u.role !== "manager" && u.role !== "admin"));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createGoal(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/goals", {
        method: "POST",
        body: JSON.stringify({
          userId: form.userId,
          metric: form.metric,
          target: Number(form.target),
          period: form.period,
          startDate: new Date(form.startDate).toISOString(),
          endDate:   new Date(form.endDate).toISOString(),
        }),
      });
      setShowNew(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function deleteGoal(id: string) {
    await apiFetch(`/goals/${id}`, { method: "DELETE" });
    setGoals((prev) => prev.filter((g) => g.id !== id));
  }

  // Check for new achievements when SDR visits
  useEffect(() => {
    if (!isManager) {
      apiFetch("/goals/achievements/check", { method: "POST", body: "{}" }).catch(() => {});
    }
  }, []);

  if (loading) return <div className="loading" style={{ padding: 40 }}>Carregando...</div>;

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div>
            <div className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Trophy size={20} /> Metas & Gamificação
            </div>
            <div className="page-subtitle">Acompanhe metas, pontuações e conquistas do time</div>
          </div>
          {isManager && tab === "goals" && (
            <button className="btn btn-primary" onClick={() => setShowNew(true)}><Plus size={14} /> Nova meta</button>
          )}
        </div>
      </div>

      <div className="content">
        <div className="filter-row" style={{ marginBottom: 16 }}>
          <button className={`filter-btn${tab === "leaderboard" ? " active" : ""}`} onClick={() => setTab("leaderboard")}><span className="filter-btn-inner"><Trophy size={13} /> Ranking</span></button>
          <button className={`filter-btn${tab === "goals" ? " active" : ""}`} onClick={() => setTab("goals")}>
            <span className="filter-btn-inner"><Target size={13} /> {isManager ? "Definir Metas" : "Minhas Metas"}</span>
          </button>
          <button className={`filter-btn${tab === "badges" ? " active" : ""}`} onClick={() => setTab("badges")}><span className="filter-btn-inner"><Award size={13} /> Conquistas</span></button>
        </div>

        {/* Leaderboard */}
        {tab === "leaderboard" && (
          <div className="card">
            {leaderboard.length === 0 ? (
              <div className="empty">Nenhum dado de ranking ainda. Registre ligações e contatos para pontuar.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {leaderboard.map((u, i) => (
                  <div key={u.userId} style={{
                    display: "flex", alignItems: "center", gap: 14,
                    padding: "14px 16px", background: "var(--bg-surface)", borderRadius: 10,
                    border: i === 0 ? "1px solid rgba(163,230,53,0.3)" : "1px solid var(--border)",
                  }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: "50%",
                      background: i === 0 ? "var(--green)" : i === 1 ? "#94a3b8" : i === 2 ? "#cd7f32" : "var(--bg-card)",
                      color: i < 3 ? (i === 0 ? "#1a2332" : "#fff") : "var(--text-muted)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontWeight: 700, fontSize: 14, flexShrink: 0,
                    }}>
                      {i + 1}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{u.name}</div>
                      <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          <Phone size={12} style={{ verticalAlign: "middle" }} /> {u.calls} ligações
                          {u.callsTarget && <span style={{ color: "var(--text-secondary)" }}> / {u.callsTarget}</span>}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          <User size={12} style={{ verticalAlign: "middle" }} /> {u.contactsAdded} contatos
                          {u.contactsTarget && <span style={{ color: "var(--text-secondary)" }}> / {u.contactsTarget}</span>}
                        </div>
                      </div>
                      <ProgressBar value={u.calls} max={u.callsTarget} />
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: i === 0 ? "var(--green)" : "var(--text)" }}>{u.points}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>pts</div>
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 8, padding: "10px 14px", background: "var(--bg-surface)", borderRadius: 8, fontSize: 11, color: "var(--text-muted)" }}>
                  Pontuação: cada ligação = 2 pts · cada contato adicionado = 1 pt · período mensal
                </div>
              </div>
            )}
          </div>
        )}

        {/* Goals */}
        {tab === "goals" && (
          <>
            {isManager && showNew && (
              <div className="card" style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Nova meta</div>
                <form onSubmit={createGoal} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ gridColumn: "span 2" }}>
                    <div className="form-label">BDR *</div>
                    <select className="form-input" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} required>
                      <option value="">Selecione o BDR...</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="form-label">Métrica *</div>
                    <select className="form-input" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })}>
                      {Object.entries(METRIC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="form-label">Meta (número) *</div>
                    <input className="form-input" type="number" min={1} value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} required />
                  </div>
                  <div>
                    <div className="form-label">Período</div>
                    <select className="form-input" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>
                      {Object.entries(PERIOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="form-label">Data início</div>
                    <input className="form-input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                  </div>
                  <div>
                    <div className="form-label">Data fim</div>
                    <input className="form-input" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                  </div>
                  <div style={{ gridColumn: "span 2", display: "flex", gap: 8 }}>
                    <button className="btn btn-primary" type="submit" disabled={saving}>
                      {saving ? <><Loader2 size={13} className="spin" /> Salvando...</> : "Criar meta"}
                    </button>
                    <button className="btn btn-ghost" type="button" onClick={() => setShowNew(false)}>Cancelar</button>
                  </div>
                </form>
              </div>
            )}

            {goals.length === 0 ? (
              <div className="card"><div className="empty">
                {isManager
                  ? "Nenhuma meta definida ainda. Clique em \"Definir Metas\" para começar."
                  : "Nenhuma meta atribuída a você ainda. O manager irá definir suas metas."}
              </div></div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {goals.map((g) => (
                  <div key={g.id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <Target size={14} style={{ color: "var(--green)" }} />
                        <span style={{ fontSize: 14, fontWeight: 600 }}>
                          {METRIC_LABELS[g.metric]} — {g.target} {PERIOD_LABELS[g.period].toLowerCase()}
                          {g.userName && <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>para {g.userName}</span>}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {new Date(g.startDate).toLocaleDateString("pt-BR")} → {new Date(g.endDate).toLocaleDateString("pt-BR")}
                        {" · "}<span className={`badge ${g.status === "active" ? "badge-green" : g.status === "achieved" ? "badge-green" : "badge-gray"}`}>{g.status}</span>
                      </div>
                    </div>
                    {isManager && (
                      <button className="btn btn-ghost btn-sm" onClick={() => deleteGoal(g.id)}>Remover</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Badges */}
        {tab === "badges" && (
          <div className="card">
            {achievements.length === 0 ? (
              <div className="empty">Nenhuma conquista desbloqueada ainda. Continue prospectando!</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                {achievements.map((a) => (
                  <div key={a.id} style={{
                    background: "var(--bg-surface)", borderRadius: 10, padding: "16px 14px",
                    textAlign: "center", border: "1px solid rgba(163,230,53,0.2)",
                  }}>
                    <div style={{ marginBottom: 8, color: "var(--green)" }}>{BADGE_ICON[a.badge] ?? <Award size={30} />}</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{a.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                      {new Date(a.unlockedAt).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
