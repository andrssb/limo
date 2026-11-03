import React, { useEffect, useState, useRef } from "react";
import { apiFetch } from "../lib/api";
import {
  Activity, Play, Loader2, CheckCircle, XCircle, Clock, AlertTriangle,
  Building2, Users, Briefcase, Link2, Mail, Phone, Database,
} from "lucide-react";

interface Aggregate {
  runs:                  number;
  companies_processed:   number;
  people_found:          number;
  job_titles_identified?: number;
  linkedin_urls_found?:  number;
  emails_inferred?:      number;
  phones_found?:         number;
  records_saved:         number;
  errors:                number;
}

interface Run {
  id:                   string;
  triggeredBy:          string;
  triggeredByUserId:    string | null;
  status:               string;
  startedAt:            string;
  completedAt:          string | null;
  durationSeconds:      number | null;
  companiesProcessed:   number;
  peopleFound:          number;
  jobTitlesIdentified:  number;
  linkedinUrlsFound:    number;
  emailsInferred:       number;
  phonesFound:          number;
  recordsSaved:         number;
  errorsCount:          number;
  log:                  string[];
}

interface Stats {
  last24h:  Aggregate;
  last7d:   Aggregate;
  lastDone: Run | null;
  current:  Run | null;
  ufs?:     string[];
  targetUF?: string;
}

interface Coverage {
  state:     string;
  total:     number;
  processed: number;
  pct:       number;
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("pt-BR");
}

function StatusBadge({ status }: { status: string }) {
  const base = { display: "flex", alignItems: "center", gap: 4, fontSize: 12 } as const;
  if (status === "done")    return <span style={{ ...base, color: "var(--green)" }}><CheckCircle size={13} /> Concluído</span>;
  if (status === "running") return <span style={{ ...base, color: "var(--yellow)" }}><Loader2 size={13} className="spin" /> Rodando</span>;
  if (status === "failed")  return <span style={{ ...base, color: "var(--red)" }}><XCircle size={13} /> Falhou</span>;
  if (status === "aborted") return <span style={{ ...base, color: "var(--text-muted)" }}><AlertTriangle size={13} /> Abortado</span>;
  return <span style={{ ...base, color: "var(--text-muted)" }}><Clock size={13} /> {status}</span>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ color: "var(--text-muted)" }}>{icon}</div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{value.toLocaleString("pt-BR")}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
      </div>
    </div>
  );
}

export function AdminPassiveEnginePage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [runs, setRuns]   = useState<Run[]>([]);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [selectedState, setSelectedState] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const lastCovRef = useRef(0);

  async function load() {
    try {
      const [s, r] = await Promise.all([
        apiFetch<Stats>("/admin/passive-engine/stats"),
        apiFetch<{ runs: Run[] }>("/admin/passive-engine/runs?limit=30"),
      ]);
      setStats(s);
      setRuns(r.runs);
      // Default do seletor = UF do dia (só na primeira carga)
      setSelectedState((cur) => cur || s.targetUF || "");
      // Durante uma execução, atualiza a cobertura ao vivo (throttle ~20s; é query pesada)
      if (s.current && Date.now() - lastCovRef.current > 20000) loadCoverage();
    } finally {
      setLoading(false);
    }
  }

  // Cobertura é uma query pesada (GROUP BY na base toda) — busca à parte, sem polling.
  async function loadCoverage() {
    lastCovRef.current = Date.now();
    try {
      const c = await apiFetch<{ coverage: Coverage[] }>("/admin/passive-engine/coverage");
      setCoverage(c.coverage);
    } catch { /* silencioso */ }
  }

  useEffect(() => {
    load();
    loadCoverage();
    pollRef.current = setInterval(load, 8000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function trigger() {
    setTriggering(true);
    try {
      await apiFetch("/admin/passive-engine/trigger", {
        method: "POST",
        body: JSON.stringify({ state: selectedState || undefined }),
      });
      await load();
    } catch (e: any) {
      alert(e?.message ?? "Não foi possível iniciar o motor.");
    } finally {
      setTriggering(false);
    }
  }

  const covByState = (uf: string) => coverage.find((c) => c.state === uf);
  const ufList = stats?.ufs ?? [];

  if (loading) return <div className="loading" style={{ padding: 40 }}>Carregando...</div>;

  const isRunning = stats?.current != null;

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div>
            <div className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Activity size={20} /> Motor Passivo de Enriquecimento
            </div>
            <div className="page-subtitle">
              Visível apenas para gestores. O motor roda em background, sem afetar o usuário final.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <select
                value={selectedState}
                onChange={(e) => setSelectedState(e.target.value)}
                disabled={isRunning || triggering}
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.15))", fontSize: 13 }}
                title="Estado (UF) que o motor vai varrer"
              >
                {ufList.map((uf) => {
                  const cov = covByState(uf);
                  return (
                    <option key={uf} value={uf}>
                      {uf}{cov ? ` — ${cov.pct}% varrido` : ""}{uf === stats?.targetUF ? " (hoje)" : ""}
                    </option>
                  );
                })}
              </select>
              {(() => {
                const cov = covByState(selectedState);
                return cov ? (
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {cov.processed.toLocaleString("pt-BR")} / {cov.total.toLocaleString("pt-BR")} empresas
                  </span>
                ) : null;
              })()}
            </div>
            <button
              className="btn btn-primary"
              disabled={isRunning || triggering}
              onClick={trigger}
              title={isRunning ? "Já está rodando" : `Iniciar varredura de ${selectedState}`}
            >
              {triggering
                ? <><Loader2 size={14} className="spin" /> Iniciando...</>
                : isRunning
                  ? <><Loader2 size={14} className="spin" /> Rodando</>
                  : <><Play size={14} /> Iniciar {selectedState}</>}
            </button>
          </div>
        </div>
      </div>

      <div className="content">
        {/* Current run banner */}
        {stats?.current && (
          <div className="card" style={{ padding: 14, marginBottom: 16, borderLeft: "3px solid var(--yellow)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                <Loader2 size={14} className="spin" style={{ verticalAlign: "middle", marginRight: 6 }} />
                Execução em andamento
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Iniciado em {fmtDate(stats.current.startedAt)}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, fontSize: 12 }}>
              <div><strong>{stats.current.companiesProcessed}</strong> empresas</div>
              <div><strong>{stats.current.peopleFound}</strong> pessoas</div>
              <div><strong>{stats.current.recordsSaved}</strong> salvos</div>
              <div><strong>{stats.current.errorsCount}</strong> erros</div>
            </div>
            {(() => {
              const cov = covByState(selectedState);
              return cov ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span>Cobertura de <strong>{selectedState}</strong> (ao vivo)</span>
                    <strong>{cov.pct}% · {cov.processed.toLocaleString("pt-BR")} / {cov.total.toLocaleString("pt-BR")}</strong>
                  </div>
                  <div style={{ height: 10, background: "var(--bg-muted, rgba(0,0,0,0.08))", borderRadius: 5, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(cov.pct, 100)}%`, height: "100%", background: "var(--yellow)", transition: "width .6s ease" }} />
                  </div>
                </div>
              ) : null;
            })()}
          </div>
        )}

        {/* 24h aggregate */}
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, marginBottom: 8 }}>ÚLTIMAS 24H</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 20 }}>
          <Metric icon={<Building2 size={20} />} label="Empresas processadas" value={stats?.last24h.companies_processed ?? 0} />
          <Metric icon={<Users size={20} />}      label="Pessoas encontradas" value={stats?.last24h.people_found ?? 0} />
          <Metric icon={<Briefcase size={20} />}  label="Cargos identificados" value={stats?.last24h.job_titles_identified ?? 0} />
          <Metric icon={<Link2 size={20} />}      label="LinkedIns candidatos" value={stats?.last24h.linkedin_urls_found ?? 0} />
          <Metric icon={<Mail size={20} />}       label="E-mails inferidos" value={stats?.last24h.emails_inferred ?? 0} />
          <Metric icon={<Phone size={20} />}      label="Telefones comerciais" value={stats?.last24h.phones_found ?? 0} />
          <Metric icon={<Database size={20} />}   label="Registros salvos" value={stats?.last24h.records_saved ?? 0} />
          <Metric icon={<AlertTriangle size={20} />} label="Erros" value={stats?.last24h.errors ?? 0} />
        </div>

        {/* 7-day summary */}
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, marginBottom: 8 }}>ÚLTIMOS 7 DIAS</div>
        <div className="card" style={{ padding: 14, marginBottom: 20, display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13 }}>
          <span><strong>{stats?.last7d.runs ?? 0}</strong> execuções</span>
          <span><strong>{(stats?.last7d.companies_processed ?? 0).toLocaleString("pt-BR")}</strong> empresas</span>
          <span><strong>{(stats?.last7d.people_found ?? 0).toLocaleString("pt-BR")}</strong> pessoas</span>
          <span><strong>{(stats?.last7d.records_saved ?? 0).toLocaleString("pt-BR")}</strong> registros salvos</span>
          <span style={{ color: (stats?.last7d.errors ?? 0) > 0 ? "var(--red)" : undefined }}>
            <strong>{stats?.last7d.errors ?? 0}</strong> erros
          </span>
        </div>

        {/* Last completed run */}
        {stats?.lastDone && (
          <>
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, marginBottom: 8 }}>
              ÚLTIMA EXECUÇÃO CONCLUÍDA — {fmtDate(stats.lastDone.completedAt)} ({fmtDuration(stats.lastDone.durationSeconds)})
            </div>
            <div className="card" style={{ padding: 14, marginBottom: 20, display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12 }}>
              <span><strong>{stats.lastDone.companiesProcessed}</strong> empresas</span>
              <span><strong>{stats.lastDone.peopleFound}</strong> pessoas</span>
              <span><strong>{stats.lastDone.recordsSaved}</strong> salvos</span>
              <span><strong>{stats.lastDone.errorsCount}</strong> erros</span>
            </div>
          </>
        )}

        {/* Cobertura por estado */}
        {coverage.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, marginBottom: 8 }}>
              COBERTURA POR ESTADO <span style={{ fontWeight: 400 }}>(% de empresas já varridas pelo motor)</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 20 }}>
              {[...coverage].sort((a, b) => b.total - a.total).map((c) => (
                <div
                  key={c.state}
                  className="card"
                  style={{ padding: 10, cursor: "pointer", outline: c.state === selectedState ? "2px solid var(--primary, #6366f1)" : "none" }}
                  onClick={() => setSelectedState(c.state)}
                  title={`${c.processed.toLocaleString("pt-BR")} de ${c.total.toLocaleString("pt-BR")} empresas`}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600 }}>
                    <span>{c.state}</span>
                    <span style={{ color: c.pct >= 100 ? "var(--green)" : c.pct > 0 ? "var(--yellow)" : "var(--text-muted)" }}>{c.pct}%</span>
                  </div>
                  <div style={{ height: 6, background: "var(--bg-muted, rgba(0,0,0,0.08))", borderRadius: 4, marginTop: 6, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(c.pct, 100)}%`, height: "100%", background: c.pct >= 100 ? "var(--green)" : "var(--primary, #6366f1)" }} />
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                    {c.processed.toLocaleString("pt-BR")} / {c.total.toLocaleString("pt-BR")}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Runs history */}
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, marginBottom: 8 }}>HISTÓRICO (últimas {runs.length})</div>
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--bg-muted, rgba(0,0,0,0.03))" }}>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Início</th>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Origem</th>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Status</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }}>Duração</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }}>Empresas</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }}>Pessoas</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }}>Salvos</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }}>Erros</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>Nenhuma execução ainda.</td></tr>
              ) : runs.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.06))" }}>
                  <td style={{ padding: "8px 12px" }}>{fmtDate(r.startedAt)}</td>
                  <td style={{ padding: "8px 12px" }}>{r.triggeredBy}</td>
                  <td style={{ padding: "8px 12px" }}><StatusBadge status={r.status} /></td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{fmtDuration(r.durationSeconds)}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{r.companiesProcessed}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{r.peopleFound}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{r.recordsSaved}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", color: r.errorsCount > 0 ? "var(--red)" : undefined }}>{r.errorsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
