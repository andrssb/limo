import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Mail, Phone, Music, Loader2 } from "lucide-react";
import { apiFetch, cachedGet, getStoredUser } from "../lib/api";
import { friendlySources } from "../lib/sources";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "calls" | "whatsapp" | "content";

const TEMP_COLOR: Record<string, string> = {
  hot: "var(--red)", warm: "var(--yellow)", cold: "var(--blue)",
};
const RESULT_COLOR: Record<string, string> = {
  positive: "var(--green)", negative: "var(--red)",
  neutral: "var(--yellow)", inconclusive: "var(--text-muted)",
};
const RESULT_LABEL: Record<string, string> = {
  positive: "Positiva", negative: "Negativa",
  neutral: "Neutra", inconclusive: "Inconclusiva",
};
const SEV_BORDER: Record<string, string> = {
  positive: "var(--green)", warning: "var(--yellow)",
  critical: "var(--red)", info: "var(--border-light)",
};

// ─── Main page ────────────────────────────────────────────────────────────────

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentUser = getStoredUser();
  const isManager = currentUser?.role === "manager" || currentUser?.role === "admin";

  const [contact, setContact] = useState<any>(null);
  const [calls, setCalls] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [contentPieces, setContentPieces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("calls");
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, any>>({});
  const [loadingAnalysis, setLoadingAnalysis] = useState<string | null>(null);
  const [updatingTemp, setUpdatingTemp] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genType, setGenType] = useState<"call_script" | "email" | "whatsapp">("call_script");
  const [generatedScript, setGeneratedScript] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [contactRes, callsRes, msgsRes] = await Promise.all([
        cachedGet<{ contact: any }>(`/contacts/${id}`),
        cachedGet<{ data: any[] }>(`/calls?contactId=${id}&pageSize=50`),
        cachedGet<{ data: any[] }>(`/whatsapp/messages?contactId=${id}&pageSize=50`).catch(() => ({ data: [] })),
      ]);
      setContact(contactRes.contact);
      setCalls(callsRes.data);
      setMessages(msgsRes.data);
    } catch {
      navigate("/contacts");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function loadAnalysis(callId: string) {
    if (analyses[callId]) {
      setExpandedCall(expandedCall === callId ? null : callId);
      return;
    }
    setLoadingAnalysis(callId);
    try {
      const res = await apiFetch<{ analysis: any }>(`/calls/${callId}/analysis`);
      setAnalyses((prev) => ({ ...prev, [callId]: res.analysis }));
      setExpandedCall(callId);
    } catch {
      alert("Análise ainda não disponível.");
    } finally {
      setLoadingAnalysis(null);
    }
  }

  async function updateTemperature(temp: string) {
    if (!id || updatingTemp) return;
    setUpdatingTemp(true);
    try {
      const res = await apiFetch<{ contact: any }>(`/contacts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ temperature: temp }),
      });
      setContact(res.contact);
    } finally {
      setUpdatingTemp(false);
    }
  }

  async function generateContent() {
    if (!id || generating) return;
    setGenerating(true);
    setGeneratedScript(null);
    try {
      const res = await apiFetch<{ content: string }>("/content/generate", {
        method: "POST",
        body: JSON.stringify({ contactId: id, type: genType }),
      });
      setGeneratedScript(res.content);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function enrichContact() {
    setEnriching(true);
    setEnrichMsg(null);
    try {
      const res = await apiFetch<{ matched: boolean; phone: string | null; email: string | null }>(
        `/contacts/${id}/enrich`,
        { method: "POST", body: JSON.stringify({}) }
      );
      await load();
      setEnrichMsg(res.matched ? "Contato enriquecido." : "Nenhum dado novo encontrado para este contato.");
    } catch (e: any) {
      setEnrichMsg(e?.message ?? "Não foi possível enriquecer agora.");
    } finally {
      setEnriching(false);
    }
  }

  async function syncCRM() {
    await apiFetch(`/contacts/${id}/sync-crm`, { method: "POST", body: JSON.stringify({}) });
    alert("Sincronização enfileirada!");
  }

  async function deleteContact() {
    await apiFetch(`/contacts/${id}`, { method: "DELETE" });
    navigate("/contacts");
  }

  if (loading) return <div className="loading">Carregando...</div>;
  if (!contact) return null;

  const initials = `${contact.firstName[0] ?? ""}${contact.lastName[0] ?? ""}`.toUpperCase();

  return (
    <>
      {/* Topbar */}
      <div className="topbar">
        <div className="topbar-row">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => navigate("/contacts")}
              style={{ padding: "5px 10px" }}
            >
              ← Contatos
            </button>
            <div>
              <div className="page-title">
                {contact.firstName} {contact.lastName}
                <span style={{
                  marginLeft: 10, fontSize: 12, padding: "2px 10px",
                  borderRadius: 20, border: `1px solid ${TEMP_COLOR[contact.temperature]}`,
                  color: TEMP_COLOR[contact.temperature], fontWeight: 500,
                }}>
                  {contact.temperature.toUpperCase()}
                </span>
              </div>
              <div className="page-subtitle">{contact.jobTitle ?? ""}{contact.companyName ? ` · ${contact.companyName}` : ""}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {isManager && (
              <button className="btn btn-ghost btn-sm" onClick={syncCRM}>↗ CRM</button>
            )}
            <button
              className="btn btn-danger btn-sm"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Excluir
            </button>
          </div>
        </div>
      </div>

      <div className="content" style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20, alignItems: "start" }}>

        {/* ── LEFT: Contact info ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Avatar + info */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <div style={{
                width: 52, height: 52, borderRadius: "50%",
                background: "var(--green-bg)", color: "var(--green)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, fontWeight: 700, flexShrink: 0,
              }}>{initials}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{contact.firstName} {contact.lastName}</div>
                {contact.jobTitle && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{contact.jobTitle}</div>}
                {contact.companyName && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{contact.companyName}</div>}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {contact.email && (
                <div style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--text-muted)", width: 14, display: "inline-flex" }}><Mail size={13} /></span>
                  <a href={`mailto:${contact.email}`} style={{ color: "var(--green)" }}>{contact.email}</a>
                </div>
              )}
              {contact.phone && (
                <div style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--text-muted)", width: 14, display: "inline-flex" }}><Phone size={13} /></span>
                  <span style={{ color: "var(--blue)" }}>{contact.phone}</span>
                </div>
              )}
              {contact.linkedinUrl && (
                <div style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--text-muted)", width: 14, fontSize: 11 }}>in</span>
                  <a href={contact.linkedinUrl} target="_blank" rel="noreferrer"
                    style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                    {contact.linkedinUrl.replace("https://www.linkedin.com/in/", "")}
                  </a>
                </div>
              )}
              {contact.location && (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{contact.location}</div>
              )}
              {contact.enrichmentData?.aiGenerated && !contact.email && !contact.phone && (
                <div style={{
                  marginTop: 6, padding: "8px 10px", borderRadius: 8,
                  background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)",
                  fontSize: 12, color: "var(--yellow)", lineHeight: 1.5,
                }}>
                  Lead gerado por IA — dados de contato nao disponíveis. Verifique no LinkedIn antes de prospectar.
                </div>
              )}
            </div>

            <button
              className="btn btn-secondary btn-sm"
              style={{ width: "100%", marginTop: 14 }}
              onClick={enrichContact}
              disabled={enriching}
            >
              {enriching ? "Enriquecendo..." : "Enriquecer Contato"}
            </button>
            {enrichMsg && (
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6, textAlign: "center" }}>
                {enrichMsg}
              </div>
            )}
          </div>

          {/* Qualificador de Garantia do Lead (Fase 4 — só gestores/Heads) */}
          {isManager && id && <QualificationCard contactId={id} />}

          {/* Temperature */}
          <div className="card">
            <div className="card-title">Temperatura</div>
            <div style={{ display: "flex", gap: 8 }}>
              {(["cold", "warm", "hot"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => updateTemperature(t)}
                  disabled={updatingTemp}
                  style={{
                    flex: 1, padding: "7px 4px", borderRadius: 8, cursor: "pointer",
                    fontFamily: "inherit", fontSize: 12, fontWeight: 900,
                    border: `1px solid ${contact.temperature === t ? TEMP_COLOR[t] : "var(--border)"}`,
                    background: contact.temperature === t ? `${TEMP_COLOR[t]}15` : "var(--bg-surface)",
                    color: contact.temperature === t ? TEMP_COLOR[t] : "var(--text-muted)",
                    transition: "all 0.15s",
                  }}
                >
                  {t === "hot" ? "Quente" : t === "warm" ? "Morno" : "Frio"}
                </button>
              ))}
            </div>
          </div>

          {/* Content generator */}
          <div className="card">
            <div className="card-title">Gerar Script</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {(["call_script", "email", "whatsapp"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setGenType(t)}
                  className={`filter-btn${genType === t ? " active" : ""}`}
                  style={{ fontSize: 11, flex: 1, textAlign: "center" }}
                >
                  {t === "call_script" ? "Ligação" : t === "email" ? "E-mail" : "WhatsApp"}
                </button>
              ))}
            </div>
            <button
              className="btn btn-primary"
              onClick={generateContent}
              disabled={generating}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {generating ? "Gerando..." : "Gerar"}
            </button>
            {generatedScript && (
              <div style={{ marginTop: 12 }}>
                <div style={{
                  background: "var(--bg-surface)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: 12, fontSize: 12.5, color: "var(--text-secondary)",
                  lineHeight: 1.7, whiteSpace: "pre-wrap", maxHeight: 220, overflowY: "auto",
                }}>
                  {generatedScript}
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(generatedScript)}
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: 6, width: "100%", justifyContent: "center" }}
                >
                  Copiar
                </button>
              </div>
            )}
          </div>

          {/* Enrichment sources */}
          {contact.enrichmentData?.sources?.length > 0 && (
            <div className="card">
              <div className="card-title">Fontes de dados</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {friendlySources(contact.enrichmentData.sources).map((s: string) => (
                  <span key={s} className="badge badge-gray">{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Timeline ── */}
        <div>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
            {([
              ["calls",    `Ligações (${calls.length})`],
              ["whatsapp", `WhatsApp (${messages.length})`],
              ["content",  "Scripts"],
            ] as [Tab, string][]).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: tab === t ? 600 : 400,
                  color: tab === t ? "var(--green)" : "var(--text-secondary)",
                  padding: "8px 16px", fontFamily: "inherit",
                  borderBottom: tab === t ? "2px solid var(--green)" : "2px solid transparent",
                  marginBottom: -1, transition: "all 0.15s",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Calls tab */}
          {tab === "calls" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {calls.length === 0 ? (
                <div className="empty">Nenhuma ligação registrada.</div>
              ) : (
                calls.map((call) => (
                  <CallCard
                    key={call.id}
                    call={call}
                    analysis={analyses[call.id] ?? null}
                    expanded={expandedCall === call.id}
                    loadingAnalysis={loadingAnalysis === call.id}
                    onToggle={() => loadAnalysis(call.id)}
                  />
                ))
              )}
            </div>
          )}

          {/* WhatsApp tab */}
          {tab === "whatsapp" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {messages.length === 0 ? (
                <div className="empty">Nenhuma mensagem de WhatsApp registrada.</div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} style={{
                    display: "flex",
                    justifyContent: msg.direction === "outbound" ? "flex-end" : "flex-start",
                  }}>
                    <div style={{
                      background: msg.direction === "outbound" ? "var(--green-bg)" : "var(--bg-card)",
                      border: `1px solid ${msg.direction === "outbound" ? "rgba(163,230,53,0.2)" : "var(--border)"}`,
                      borderRadius: 10, padding: "8px 12px", maxWidth: "72%",
                    }}>
                      {msg.type === "audio" ? (
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          <Music size={12} style={{ verticalAlign: "middle" }} /> Áudio{msg.transcription && <span style={{ color: "var(--text-secondary)", marginLeft: 6 }}>— {msg.transcription.slice(0, 80)}...</span>}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{msg.content}</div>
                      )}
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, textAlign: "right" }}>
                        {new Date(msg.sentAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Content tab */}
          {tab === "content" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {contentPieces.length === 0 ? (
                <div className="empty">
                  Nenhum script gerado ainda.<br />
                  <span style={{ fontSize: 12 }}>Use o gerador no painel esquerdo.</span>
                </div>
              ) : (
                contentPieces.map((p) => (
                  <div key={p.id} className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span className="badge badge-gray">{p.type}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {new Date(p.createdAt).toLocaleDateString("pt-BR")}
                        {p.usedAt && <span style={{ color: "var(--green)", marginLeft: 8 }}>✓ usado</span>}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {p.content}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowDeleteConfirm(false)}>
          <div className="card" style={{ width: 360 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Excluir contato?</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
              Esta ação é irreversível. Todas as ligações e mensagens associadas também serão removidas.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setShowDeleteConfirm(false)}>Cancelar</button>
              <button className="btn btn-danger" style={{ flex: 1, justifyContent: "center" }} onClick={deleteContact}>Excluir</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Call card ────────────────────────────────────────────────────────────────

function CallCard({ call, analysis, expanded, loadingAnalysis, onToggle }: {
  call: any;
  analysis: any;
  expanded: boolean;
  loadingAnalysis: boolean;
  onToggle: () => void;
}) {
  const duration = call.durationSeconds
    ? `${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s`
    : null;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* Call header */}
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", display: "inline-flex" }}><Phone size={12} /></span>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {new Date(call.startedAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
              {duration && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· {duration}</span>}
              <span className="badge badge-gray">{call.direction}</span>
            </div>
            {analysis?.flashSummary && (
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 6 }}>
                {analysis.flashSummary.slice(0, 120)}{analysis.flashSummary.length > 120 ? "..." : ""}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {call.result && (
              <span style={{
                fontSize: 11, fontWeight: 600,
                color: RESULT_COLOR[call.result],
                border: `1px solid ${RESULT_COLOR[call.result]}`,
                padding: "2px 8px", borderRadius: 4,
              }}>
                {RESULT_LABEL[call.result]}
              </span>
            )}
          </div>
        </div>

        {/* Status indicators */}
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
          <StatusPill label="Transcrição" status={call.transcriptionStatus} />
          <StatusPill label="Análise" status={call.analysisStatus} />
          {call.analysisStatus === "done" && (
            <button
              onClick={onToggle}
              style={{
                marginLeft: "auto", background: "none", border: "none",
                color: "var(--green)", cursor: "pointer", fontSize: 12,
                fontFamily: "inherit", padding: 0,
              }}
            >
              {loadingAnalysis ? "Carregando..." : expanded ? "Fechar diagnóstico ↑" : "Ver diagnóstico →"}
            </button>
          )}
        </div>
      </div>

      {/* Expanded analysis */}
      {expanded && analysis && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "16px", background: "var(--bg-surface)" }}>
          {/* Metrics row */}
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <Metric label="Talk ratio" value={`${Math.round((analysis.talkRatio ?? 0) * 100)}%`} />
            <Metric label="Sentimento" value={`${Math.round((analysis.sentimentScore ?? 0) * 100)}%`} />
            {analysis.nextStep && (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Próximo passo</div>
                <div style={{ fontSize: 12.5, color: "var(--text)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px" }}>
                  {analysis.nextStep}
                </div>
              </div>
            )}
          </div>

          {/* Diagnosis sections */}
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusPill({ label, status }: { label: string; status: string }) {
  const color = status === "done" ? "var(--green)" : status === "processing" ? "var(--yellow)" : status === "failed" ? "var(--red)" : "var(--text-muted)";
  const dot: React.ReactNode = status === "done" ? "✓" : status === "processing" ? <Loader2 size={11} className="spin" /> : status === "failed" ? "✗" : "—";
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
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{value}</div>
    </div>
  );
}

// ─── Qualificador de Garantia do Lead (Fase 4) ──────────────────────────────

const CLASS_META: Record<string, { label: string; color: string }> = {
  qualified:    { label: "Qualificado",        color: "var(--green)" },
  partial:      { label: "Parcialmente qualif.", color: "var(--yellow)" },
  disqualified: { label: "Desqualificado",     color: "var(--red)" },
};
const ORIGIN_LABEL: Record<string, string> = {
  inbound: "Inbound", outbound: "Outbound", referral: "Indicação", partner: "Parceiro", other: "Outro",
};
function qScoreColor(v: number): string {
  if (v >= 70) return "var(--green)";
  if (v >= 40) return "var(--yellow)";
  return "var(--red)";
}

function QualificationCard({ contactId }: { contactId: string }) {
  const [qual, setQual] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [qualifying, setQualifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cachedGet<{ qualification: any }>(`/contacts/${contactId}/qualification`)
      .then((r) => setQual(r.qualification))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [contactId]);

  async function runQualify() {
    setQualifying(true); setError(null);
    try {
      const r = await apiFetch<{ qualification: any }>(`/contacts/${contactId}/qualify`, { method: "POST", body: "{}" });
      setQual(r.qualification);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setQualifying(false);
    }
  }

  if (loading) return null;
  const meta = qual ? CLASS_META[qual.classification] : null;

  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Qualificação do lead</span>
        <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>Gestor</span>
      </div>

      {!qual && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12 }}>
          Avalia a aderência real do lead ao ICP, dores, momento e perfil decisor — com base na Educação de Produto.
        </div>
      )}

      {qual && meta && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: meta.color }}>{meta.label}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· {ORIGIN_LABEL[qual.origin] ?? qual.origin}</span>
            <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 900, color: qScoreColor(qual.score?.overall ?? 0) }}>
              {Math.round(qual.score?.overall ?? 0)}
            </span>
          </div>
          {qual.summary && <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: 10 }}>{qual.summary}</div>}

          {([
            ["ICP", qual.score?.icpFit],
            ["Dores", qual.score?.pains],
            ["Momento", qual.score?.buyingMoment],
            ["Potencial $", qual.score?.financialPotential],
            ["Decisor", qual.score?.decisionMaker],
            ["Interesse", qual.score?.interest],
          ] as [string, number][]).map(([label, val]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)", width: 74, flexShrink: 0 }}>{label}</div>
              <div style={{ flex: 1, height: 5, background: "var(--bg-surface)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${Math.max(0, Math.min(100, val ?? 0))}%`, height: "100%", background: qScoreColor(val ?? 0) }} />
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: qScoreColor(val ?? 0), width: 22, textAlign: "right" }}>{Math.round(val ?? 0)}</div>
            </div>
          ))}

          {qual.reasons?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {qual.reasons.map((r: string, i: number) => (
                <div key={i} style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 3, lineHeight: 1.5 }}>• {r}</div>
              ))}
            </div>
          )}

          {qual.marketingNote && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.25)", fontSize: 11.5, color: "var(--blue)", lineHeight: 1.5 }}>
              <strong>Marketing:</strong> {qual.marketingNote}
            </div>
          )}
        </div>
      )}

      <button className="btn btn-secondary btn-sm" style={{ width: "100%" }} onClick={runQualify} disabled={qualifying}>
        {qualifying ? "Qualificando..." : qual ? "Requalificar" : "Qualificar lead"}
      </button>
      {error && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 6, textAlign: "center" }}>{error}</div>}
    </div>
  );
}
