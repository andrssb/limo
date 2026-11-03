import React, { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Music, Loader2 } from "lucide-react";
import { apiFetch, apiUpload, cachedGet } from "../lib/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const RESULTS = ["", "positive", "negative", "neutral", "inconclusive"] as const;
const RESULT_LABEL: Record<string, string> = {
  "": "Todas", positive: "Positiva", negative: "Negativa",
  neutral: "Neutra", inconclusive: "Inconclusiva",
};
const RESULT_COLOR: Record<string, string> = {
  positive: "var(--green)", negative: "var(--red)",
  neutral: "var(--yellow)", inconclusive: "var(--text-muted)",
};
const SEV_BORDER: Record<string, string> = {
  positive: "var(--green)", warning: "var(--yellow)",
  critical: "var(--red)", info: "var(--border-light)",
};

// ─── Main page ────────────────────────────────────────────────────────────────

export function CallsPage() {
  const [calls, setCalls]           = useState<any[]>([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [filterResult, setFilter]   = useState("");
  const [page, setPage]             = useState(1);
  const [analyses, setAnalyses]     = useState<Record<string, any>>({});
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [loadingAn, setLoadingAn]   = useState<string | null>(null);
  const [showModal, setShowModal]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (filterResult) params.set("result", filterResult);
    try {
      const res = await cachedGet<{ data: any[]; total: number }>(`/calls?${params}`);
      setCalls(res.data);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, filterResult]);

  useEffect(() => { load(); }, [load]);

  async function toggleAnalysis(callId: string) {
    if (expanded === callId) { setExpanded(null); return; }
    if (analyses[callId])    { setExpanded(callId); return; }
    setLoadingAn(callId);
    try {
      const res = await apiFetch<{ analysis: any }>(`/calls/${callId}/analysis`);
      setAnalyses((p) => ({ ...p, [callId]: res.analysis }));
      setExpanded(callId);
    } catch {
      alert("Análise ainda não disponível.");
    } finally {
      setLoadingAn(null);
    }
  }

  const thisWeek = calls.filter((c) => {
    const d = new Date(c.startedAt);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return d >= weekAgo;
  }).length;

  const totalPages = Math.ceil(total / 20);

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div>
            <div className="page-title">Ligações</div>
            <div className="page-subtitle">
              {total} registrada{total !== 1 ? "s" : ""} · {thisWeek} esta semana
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            + Nova ligação
          </button>
        </div>
      </div>

      <div className="content">
        {/* Filters */}
        <div className="filter-row">
          {RESULTS.map((r) => (
            <button
              key={r}
              className={`filter-btn${filterResult === r ? " active" : ""}`}
              onClick={() => { setFilter(r); setPage(1); }}
            >
              {RESULT_LABEL[r]}
            </button>
          ))}
        </div>

        {/* Calls list */}
        {loading ? (
          <div className="loading">Carregando...</div>
        ) : calls.length === 0 ? (
          <div className="card">
            <div className="empty">
              Nenhuma ligação registrada ainda.<br />
              <span style={{ fontSize: 12 }}>Clique em "+ Nova ligação" para começar.</span>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {calls.map((call) => (
              <CallCard
                key={call.id}
                call={call}
                analysis={analyses[call.id] ?? null}
                expanded={expanded === call.id}
                loadingAnalysis={loadingAn === call.id}
                onToggle={() => toggleAnalysis(call.id)}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination" style={{ marginTop: 16 }}>
            <button className="page-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>‹</button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
              return (
                <button key={p} className={`page-btn${page === p ? " active" : ""}`} onClick={() => setPage(p)}>{p}</button>
              );
            })}
            <button className="page-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>›</button>
          </div>
        )}
      </div>

      {showModal && (
        <NewCallModal
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}
    </>
  );
}

// ─── Call card ────────────────────────────────────────────────────────────────

function CallCard({ call, analysis, expanded, loadingAnalysis, onToggle }: {
  call: any; analysis: any; expanded: boolean;
  loadingAnalysis: boolean; onToggle: () => void;
}) {
  const dur = call.durationSeconds
    ? `${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s`
    : null;
  const dateStr = new Date(call.startedAt).toLocaleString("pt-BR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            {/* Contact name + meta */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
              {call.contactId && (
                <Link
                  to={`/contacts/${call.contactId}`}
                  style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {call.contact?.firstName ?? "Contato"}
                  {call.contact?.lastName ? ` ${call.contact.lastName}` : ""}
                </Link>
              )}
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{dateStr}</span>
              {dur && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· {dur}</span>}
              <span className="badge badge-gray">{call.direction === "outbound" ? "Saída" : "Entrada"}</span>
              <span className="badge badge-gray">{call.type}</span>
            </div>
            {/* Flash summary preview */}
            {analysis?.flashSummary && (
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {analysis.flashSummary.slice(0, 140)}{analysis.flashSummary.length > 140 ? "..." : ""}
              </div>
            )}
          </div>

          {/* Result badge */}
          {call.result && (
            <span style={{
              flexShrink: 0, fontSize: 11, fontWeight: 600,
              color: RESULT_COLOR[call.result],
              border: `1px solid ${RESULT_COLOR[call.result]}`,
              padding: "3px 10px", borderRadius: 4,
            }}>
              {RESULT_LABEL[call.result]}
            </span>
          )}
        </div>

        {/* Status row */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
          <StatusPill label="Transcrição" status={call.transcriptionStatus} />
          <StatusPill label="Análise IA" status={call.analysisStatus} />
          {call.audioUrl && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}><Music size={11} style={{ verticalAlign: "middle" }} /> Áudio</span>
          )}
          {call.analysisStatus === "done" && (
            <button
              onClick={onToggle}
              style={{
                marginLeft: "auto", background: "none", border: "none",
                color: "var(--green)", cursor: "pointer",
                fontSize: 12, fontFamily: "inherit", padding: 0,
              }}
            >
              {loadingAnalysis ? "Carregando..." : expanded ? "Fechar ↑" : "Ver diagnóstico →"}
            </button>
          )}
          {call.analysisStatus === "processing" && (
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--yellow)" }}><Loader2 size={11} className="spin" style={{ verticalAlign: "middle" }} /> Analisando...</span>
          )}
        </div>
      </div>

      {/* Expanded analysis */}
      {expanded && analysis && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "16px 18px", background: "var(--bg-surface)" }}>
          <div style={{ display: "flex", gap: 20, marginBottom: 16, flexWrap: "wrap" }}>
            <Metric label="Talk ratio" value={`${Math.round((analysis.talkRatio ?? 0) * 100)}%`} />
            <Metric label="Sentimento" value={`${Math.round((analysis.sentimentScore ?? 0) * 100)}%`} />
            {analysis.nextStep && (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Próximo passo</div>
                <div style={{
                  fontSize: 12.5, color: "var(--text)", background: "var(--bg-card)",
                  border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px",
                }}>
                  {analysis.nextStep}
                </div>
              </div>
            )}
          </div>

          {/* Fase 3 — Score detalhado */}
          {analysis.score && (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{
                  fontSize: 24, fontWeight: 900, lineHeight: 1,
                  color: scoreColor(analysis.score.overall),
                }}>{Math.round(analysis.score.overall)}<span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>/100</span></div>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>{analysis.score.rationale}</div>
              </div>
              {([
                ["Abertura", analysis.score.opening],
                ["Descoberta de dor", analysis.score.painDiscovery],
                ["Clareza da solução", analysis.score.solutionClarity],
                ["Uso de framework", analysis.score.frameworkUsage],
                ["Condução até demo", analysis.score.advanceToDemo],
              ] as [string, number][]).map(([label, val]) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", width: 130, flexShrink: 0 }}>{label}</div>
                  <div style={{ flex: 1, height: 6, background: "var(--bg-surface)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${Math.max(0, Math.min(100, val))}%`, height: "100%", background: scoreColor(val) }} />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: scoreColor(val), width: 28, textAlign: "right" }}>{Math.round(val)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Fase 3 — Frameworks detectados */}
          {analysis.frameworks?.filter((f: any) => f.detected).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Frameworks de vendas</div>
              {analysis.frameworks.filter((f: any) => f.detected).map((f: any, i: number) => (
                <div key={i} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>{f.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor(f.completeness) }}>{Math.round(f.completeness)}% completo</span>
                  </div>
                  {f.note && <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 6, lineHeight: 1.5 }}>{f.note}</div>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {f.stepsCovered?.map((s: string, j: number) => (
                      <span key={`c${j}`} style={{ fontSize: 10, color: "var(--green)", background: "rgba(163,230,53,0.1)", borderRadius: 4, padding: "2px 7px" }}>✓ {s}</span>
                    ))}
                    {f.stepsMissed?.map((s: string, j: number) => (
                      <span key={`m${j}`} style={{ fontSize: 10, color: "var(--red)", background: "rgba(239,68,68,0.1)", borderRadius: 4, padding: "2px 7px" }}>✗ {s}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Fase 3 — Conversão / perda */}
          {analysis.outcome && (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: analysis.outcome.converted ? "var(--green)" : "var(--yellow)", marginBottom: 8 }}>
                {analysis.outcome.converted ? "✓ Converteu — fatores de sucesso" : "Não converteu — diagnóstico"}
              </div>
              <OutcomeList label="Fatores de conversão" items={analysis.outcome.conversionFactors} color="var(--green)" />
              <OutcomeList label="Motivos da perda" items={analysis.outcome.lossReasons} color="var(--red)" />
              <OutcomeList label="Melhorias de abordagem" items={analysis.outcome.improvements} color="var(--blue)" />
              {analysis.outcome.objections?.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Objeções</div>
                  {analysis.outcome.objections.map((o: any, i: number) => (
                    <div key={i} style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 3 }}>
                      <span style={{ color: o.handled ? "var(--green)" : "var(--red)" }}>{o.handled ? "✓" : "✗"}</span> {o.objection}
                      {o.note && <span style={{ color: "var(--text-muted)" }}> — {o.note}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {analysis.diagnosis?.sections?.map((s: any, i: number) => (
            <div key={i} style={{
              borderLeft: `3px solid ${SEV_BORDER[s.severity] ?? "var(--border)"}`,
              paddingLeft: 12, marginBottom: 10,
            }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>{s.title}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>{s.body}</div>
              {s.recommendedResponse && (
                <div style={{ fontSize: 11.5, color: "var(--green)", marginTop: 4 }}>→ {s.recommendedResponse}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── New Call Modal ───────────────────────────────────────────────────────────

function NewCallModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [contactSearch, setContactSearch] = useState("");
  const [contacts, setContacts]           = useState<any[]>([]);
  const [contactId, setContactId]         = useState("");
  const [contactLabel, setContactLabel]   = useState("");
  const [showDropdown, setShowDropdown]   = useState(false);
  const [direction, setDirection]         = useState<"outbound" | "inbound">("outbound");
  const [startedAt, setStartedAt]         = useState(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    return now.toISOString().slice(0, 16);
  });
  const [durationMin, setDurationMin]     = useState("");
  const [durationSec, setDurationSec]     = useState("");
  const [audioFile, setAudioFile]         = useState<File | null>(null);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState("");
  const [phase, setPhase]                 = useState<"idle" | "uploading" | "done">("idle");
  const searchTimeout                     = useRef<ReturnType<typeof setTimeout>>();

  function handleContactSearch(val: string) {
    setContactSearch(val);
    setContactId("");
    clearTimeout(searchTimeout.current);
    if (!val.trim()) { setContacts([]); setShowDropdown(false); return; }
    searchTimeout.current = setTimeout(async () => {
      const res = await apiFetch<{ data: any[] }>(`/contacts?search=${encodeURIComponent(val)}&pageSize=8`);
      setContacts(res.data);
      setShowDropdown(true);
    }, 300);
  }

  function selectContact(c: any) {
    setContactId(c.id);
    setContactLabel(`${c.firstName} ${c.lastName}${c.companyName ? ` · ${c.companyName}` : ""}`);
    setContactSearch(`${c.firstName} ${c.lastName}`);
    setShowDropdown(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contactId) { setError("Selecione um contato."); return; }
    setSaving(true); setError("");

    try {
      const durationSeconds = (parseInt(durationMin || "0", 10) * 60) + parseInt(durationSec || "0", 10);

      const callRes = await apiFetch<{ call: any }>("/calls", {
        method: "POST",
        body: JSON.stringify({
          contactId,
          type: "manual",
          direction,
          startedAt: new Date(startedAt).toISOString(),
        }),
      });

      const callId = callRes.call.id;

      // Complete with duration
      if (durationSeconds > 0) {
        const endedAt = new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString();
        await apiFetch(`/calls/${callId}/complete`, {
          method: "POST",
          body: JSON.stringify({ endedAt, durationSeconds }),
        });
      }

      // Upload audio if provided
      if (audioFile) {
        setPhase("uploading");
        const fd = new FormData();
        fd.append("audio", audioFile, audioFile.name);
        await apiUpload(`/calls/${callId}/audio`, fd);
      }

      setPhase("done");
      setTimeout(onSaved, 800);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
      setPhase("idle");
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 28, width: 460, maxWidth: "90vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Nova Ligação</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>

        {phase === "done" ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: "var(--green)", fontSize: 13 }}>
            ✓ Ligação registrada!{audioFile ? " Áudio em processamento." : ""}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {/* Contact search */}
            <div className="form-group" style={{ position: "relative" }}>
              <label className="form-label">Contato *</label>
              <input
                className="form-input"
                placeholder="Buscar contato..."
                value={contactSearch}
                onChange={(e) => handleContactSearch(e.target.value)}
                autoComplete="off"
              />
              {showDropdown && contacts.length > 0 && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
                  background: "var(--bg-card)", border: "1px solid var(--border)",
                  borderRadius: 8, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}>
                  {contacts.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => selectContact(c)}
                      style={{
                        padding: "9px 14px", cursor: "pointer", fontSize: 13,
                        borderBottom: "1px solid var(--border)",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                    >
                      <span style={{ color: "var(--text)", fontWeight: 500 }}>{c.firstName} {c.lastName}</span>
                      {c.companyName && <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 12 }}>{c.companyName}</span>}
                    </div>
                  ))}
                </div>
              )}
              {contactId && (
                <div style={{ fontSize: 11, color: "var(--green)", marginTop: 4 }}>✓ {contactLabel}</div>
              )}
            </div>

            {/* Direction */}
            <div className="form-group">
              <label className="form-label">Direção</label>
              <div style={{ display: "flex", gap: 8 }}>
                {(["outbound", "inbound"] as const).map((d) => (
                  <button
                    key={d} type="button"
                    onClick={() => setDirection(d)}
                    style={{
                      flex: 1, padding: "8px", borderRadius: 8, cursor: "pointer",
                      fontFamily: "inherit", fontSize: 12, fontWeight: 600,
                      border: `1px solid ${direction === d ? "var(--green)" : "var(--border)"}`,
                      background: direction === d ? "var(--green-bg)" : "var(--bg-surface)",
                      color: direction === d ? "var(--green)" : "var(--text-muted)",
                    }}
                  >
                    {d === "outbound" ? "↑ Saída" : "↓ Entrada"}
                  </button>
                ))}
              </div>
            </div>

            {/* Date + Duration row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Data e hora</label>
                <input
                  className="form-input" type="datetime-local"
                  value={startedAt} onChange={(e) => setStartedAt(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Duração</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    className="form-input" type="number" min="0" max="300"
                    placeholder="min" value={durationMin}
                    onChange={(e) => setDurationMin(e.target.value)}
                    style={{ width: "50%" }}
                  />
                  <span style={{ color: "var(--text-muted)", fontSize: 12 }}>:</span>
                  <input
                    className="form-input" type="number" min="0" max="59"
                    placeholder="seg" value={durationSec}
                    onChange={(e) => setDurationSec(e.target.value)}
                    style={{ width: "50%" }}
                  />
                </div>
              </div>
            </div>

            {/* Audio */}
            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="form-label">Áudio da ligação <span style={{ color: "var(--text-muted)" }}>(opcional — dispara transcrição e análise IA)</span></label>
              <label style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                border: "1px dashed var(--border)", borderRadius: 8, cursor: "pointer",
                color: audioFile ? "var(--green)" : "var(--text-muted)", fontSize: 13,
                transition: "border-color 0.15s",
              }}>
                <input
                  type="file" accept=".mp3,.mp4,.wav,.ogg,.webm,audio/*"
                  style={{ display: "none" }}
                  onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
                />
                {audioFile ? <>✓ {audioFile.name}</> : <><Music size={13} style={{ verticalAlign: "middle" }} /> Escolher arquivo de áudio...</>}
              </label>
            </div>

            {error && <p className="error-msg">{error}</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex: 1, justifyContent: "center" }}>
                {phase === "uploading" ? "Enviando áudio..." : saving ? "Registrando..." : "Registrar"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusPill({ label, status }: { label: string; status: string }) {
  const color =
    status === "done"       ? "var(--green)"      :
    status === "processing" ? "var(--yellow)"     :
    status === "failed"     ? "var(--red)"        : "var(--text-muted)";
  const dot: React.ReactNode =
    status === "done"       ? "✓" :
    status === "processing" ? <Loader2 size={11} className="spin" /> :
    status === "failed"     ? "✗" : "—";
  return (
    <span style={{ fontSize: 11, color, display: "flex", alignItems: "center", gap: 4 }}>
      {dot} {label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{value}</div>
    </div>
  );
}

// Fase 3 — cor do score por faixa (verde ≥70, amarelo ≥40, vermelho <40).
function scoreColor(v: number): string {
  if (v >= 70) return "var(--green)";
  if (v >= 40) return "var(--yellow)";
  return "var(--red)";
}

function OutcomeList({ label, items, color }: { label: string; items?: string[]; color: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      {items.map((it, i) => (
        <div key={i} style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 2, lineHeight: 1.5 }}>
          <span style={{ color }}>•</span> {it}
        </div>
      ))}
    </div>
  );
}
