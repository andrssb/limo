import React, { useEffect, useState, useRef } from "react";
import { apiFetch, cachedGet, getStoredUser } from "../lib/api";
import {
  Plus, Loader2, RefreshCw, Send, Trash2, BookOpen, Link, FileText, Play,
  Phone, Shield, Repeat, Target, Handshake, CheckCircle, Brain, MessageSquare, Lightbulb, User,
} from "lucide-react";

const CATEGORIES = ["cold_call", "objection_handling", "mirroring", "qualification", "rapport", "closing", "mindset"];
const CAT_LABELS: Record<string, string> = {
  cold_call: "Cold Call", objection_handling: "Objeções", mirroring: "Espelhamento",
  qualification: "Qualificação", rapport: "Rapport", closing: "Fechamento", mindset: "Mindset",
};
const CAT_ICON: Record<string, React.ReactNode> = {
  cold_call: <Phone size={13} />, objection_handling: <Shield size={13} />, mirroring: <Repeat size={13} />,
  qualification: <Target size={13} />, rapport: <Handshake size={13} />, closing: <CheckCircle size={13} />, mindset: <Brain size={13} />,
};

export function SalesPlaybookPage() {
  const user = getStoredUser();
  const isManager = user?.role === "manager" || user?.role === "admin";

  const [references, setReferences]     = useState<any[]>([]);
  const [insights, setInsights]         = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
  const [tab, setTab]                   = useState<"chat" | "insights" | "references" | "knowledge">("chat");
  const [knowledge, setKnowledge]       = useState<any[]>([]);
  const [showNewKnowledge, setShowNewKnowledge] = useState(false);
  const [knowledgeForm, setKnowledgeForm] = useState({ type: "url", title: "", sourceUrl: "", rawContent: "" });
  const [addingKnowledge, setAddingKnowledge] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [enrichingId, setEnrichingId]   = useState<string | null>(null);
  const [messages, setMessages]         = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput]               = useState("");
  const [chatLoading, setChatLoading]   = useState(false);
  const [showNewRef, setShowNewRef]     = useState(false);
  const [refForm, setRefForm]           = useState({ name: "", youtubeHandle: "", instagramHandle: "", specialty: "" });
  const chatEndRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    try {
      const iRes = await cachedGet<{ insights: any[] }>("/sales-playbook/insights");
      setInsights(iRes.insights);
      const [rRes, kRes] = await Promise.all([
        isManager ? cachedGet<{ references: any[] }>("/sales-playbook/references") : Promise.resolve({ references: [] }),
        cachedGet<{ knowledge: any[] }>("/coaching/knowledge"),
      ]);
      setReferences(rRes.references);
      setKnowledge(kRes.knowledge ?? []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function enrich(refId: string) {
    setEnrichingId(refId);
    try {
      await apiFetch(`/sales-playbook/enrich/${refId}`, { method: "POST" });
      load();
    } catch (err) {
      alert((err as Error).message);
    } finally { setEnrichingId(null); }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || chatLoading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setChatLoading(true);
    try {
      const res = await apiFetch<{ response: string }>("/sales-playbook/chat", {
        method: "POST",
        body: JSON.stringify({ message: userMsg }),
      });
      setMessages((prev) => [...prev, { role: "assistant", content: res.response }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: "Erro ao processar. Tente novamente." }]);
    } finally { setChatLoading(false); }
  }

  async function addReference(e: React.FormEvent) {
    e.preventDefault();
    await apiFetch("/sales-playbook/references", {
      method: "POST",
      body: JSON.stringify(refForm),
    });
    setRefForm({ name: "", youtubeHandle: "", instagramHandle: "", specialty: "" });
    setShowNewRef(false);
    load();
  }

  async function deleteRef(id: string) {
    if (!confirm("Remover esta referência?")) return;
    await apiFetch(`/sales-playbook/references/${id}`, { method: "DELETE" });
    setReferences((prev) => prev.filter((r) => r.id !== id));
  }

  async function addKnowledge(e: React.FormEvent) {
    e.preventDefault();
    setAddingKnowledge(true);
    try {
      await apiFetch("/coaching/knowledge", {
        method: "POST",
        body: JSON.stringify(knowledgeForm),
      });
      setKnowledgeForm({ type: "url", title: "", sourceUrl: "", rawContent: "" });
      setShowNewKnowledge(false);
      load();
    } catch (err) {
      alert((err as Error).message);
    } finally { setAddingKnowledge(false); }
  }

  async function deleteKnowledge(id: string) {
    if (!confirm("Remover este material?")) return;
    await apiFetch(`/coaching/knowledge/${id}`, { method: "DELETE" });
    setKnowledge((prev) => prev.filter((k) => k.id !== id));
  }

  const filteredInsights = activeCategory ? insights.filter((i) => i.category === activeCategory) : insights;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BookOpen size={20} /> Discurso — Playbook de Vendas
          </div>
          <div className="page-subtitle">
            IA treinada nas metodologias de Luis Nekta, Pagotto, Ortega, Diego Maia e outros. Enriquecimento diário automático.
          </div>
        </div>
      </div>

      <div className="content">
        <div className="filter-row" style={{ marginBottom: 16 }}>
          <button className={`filter-btn${tab === "chat" ? " active" : ""}`} onClick={() => setTab("chat")}><span className="filter-btn-inner"><MessageSquare size={13} /> Coach IA</span></button>
          <button className={`filter-btn${tab === "insights" ? " active" : ""}`} onClick={() => setTab("insights")}><span className="filter-btn-inner"><Lightbulb size={13} /> Insights ({insights.length})</span></button>
          <button className={`filter-btn${tab === "knowledge" ? " active" : ""}`} onClick={() => setTab("knowledge")}><span className="filter-btn-inner"><Brain size={13} /> Enriquecimento ({knowledge.length})</span></button>
          {isManager && <button className={`filter-btn${tab === "references" ? " active" : ""}`} onClick={() => setTab("references")}><span className="filter-btn-inner"><User size={13} /> Referências ({references.length})</span></button>}
        </div>

        {/* Chat */}
        {tab === "chat" && (
          <div className="card" style={{ display: "flex", flexDirection: "column", height: 600 }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "4px 0", display: "flex", flexDirection: "column", gap: 12 }}>
              {messages.length === 0 && (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
                  <Brain size={36} style={{ marginBottom: 12, color: "var(--green)" }} />
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Coach IA de Vendas</div>
                  <div style={{ fontSize: 13, maxWidth: 400, margin: "0 auto" }}>
                    Pergunte sobre técnicas de cold call, como superar objeções, espelhamento, qualificação BANT/SPIN, rapport ou qualquer dúvida sobre vendas.
                  </div>
                  <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                    {["Como fazer um cold call eficaz?", "Técnica de espelhamento vocal", "Como superar 'não tenho tempo'", "Como qualificar um lead BANT"].map((q) => (
                      <button key={q} className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => { setInput(q); }}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                }}>
                  <div style={{
                    maxWidth: "80%", padding: "10px 14px", borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    background: m.role === "user" ? "var(--green)" : "var(--bg-surface)",
                    color: m.role === "user" ? "#1a2332" : "var(--text)",
                    fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap",
                  }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ display: "flex" }}>
                  <div style={{ padding: "10px 14px", background: "var(--bg-surface)", borderRadius: "14px 14px 14px 4px", fontSize: 13, color: "var(--text-muted)" }}>
                    <Loader2 size={14} className="spin" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 8 }}>
              <form onSubmit={sendMessage} style={{ display: "flex", gap: 8 }}>
                <input
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder="Pergunte sobre técnicas de vendas..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={chatLoading}
                />
                <button className="btn btn-primary" type="submit" disabled={chatLoading || !input.trim()}>
                  <Send size={14} />
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Insights */}
        {tab === "insights" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button className={`filter-btn${!activeCategory ? " active" : ""}`} onClick={() => setActiveCategory("")}>Todos</button>
              {CATEGORIES.map((c) => (
                <button key={c} className={`filter-btn${activeCategory === c ? " active" : ""}`} onClick={() => setActiveCategory(c)}>
                  <span className="filter-btn-inner">{CAT_ICON[c]} {CAT_LABELS[c]}</span>
                </button>
              ))}
            </div>

            {filteredInsights.length === 0 ? (
              <div className="card"><div className="empty">Nenhum insight ainda. Enriqueça uma referência na aba "Referências".</div></div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
                {filteredInsights.map((i) => (
                  <div key={i.id} className="card" style={{ borderLeft: "3px solid var(--green)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <span className="badge badge-green" style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 4 }}>{CAT_ICON[i.category] ?? <Lightbulb size={11} />} {CAT_LABELS[i.category] ?? i.category}</span>
                      {i.referenceName && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{i.referenceName}</span>}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{i.title}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>{i.insight}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Knowledge Enrichment */}
        {tab === "knowledge" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="card" style={{ background: "rgba(0,210,100,0.06)", borderColor: "var(--green)" }}>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                <strong style={{ color: "var(--green)" }}>Como funciona:</strong> Adicione URLs de artigos, vídeos do YouTube ou textos com técnicas de vendas. A IA extrai frameworks, scripts e técnicas e usa no coaching ao vivo.
              </div>
            </div>

            {showNewKnowledge && (
              <div className="card">
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Novo material de enriquecimento</div>
                <form onSubmit={addKnowledge} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    {[
                      { v: "url", label: "URL / Artigo", icon: <Link size={13} /> },
                      { v: "youtube", label: "YouTube", icon: <Play size={13} /> },
                      { v: "text", label: "Texto / Script", icon: <FileText size={13} /> },
                    ].map(({ v, label, icon }) => (
                      <button
                        key={v}
                        type="button"
                        className={`btn btn-sm ${knowledgeForm.type === v ? "btn-primary" : "btn-ghost"}`}
                        onClick={() => setKnowledgeForm({ ...knowledgeForm, type: v })}
                        style={{ display: "flex", alignItems: "center", gap: 4 }}
                      >
                        {icon} {label}
                      </button>
                    ))}
                  </div>
                  <div>
                    <div className="form-label">Título (opcional)</div>
                    <input className="form-input" placeholder="Ex: SPIN Selling — Guia completo" value={knowledgeForm.title} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, title: e.target.value })} />
                  </div>
                  {knowledgeForm.type !== "text" && (
                    <div>
                      <div className="form-label">{knowledgeForm.type === "youtube" ? "URL do vídeo YouTube" : "URL do artigo / página"}</div>
                      <input className="form-input" required placeholder={knowledgeForm.type === "youtube" ? "https://youtube.com/watch?v=..." : "https://..."} value={knowledgeForm.sourceUrl} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, sourceUrl: e.target.value })} />
                    </div>
                  )}
                  {knowledgeForm.type === "text" && (
                    <div>
                      <div className="form-label">Conteúdo (técnicas, scripts, frameworks...)</div>
                      <textarea
                        className="form-input"
                        required
                        rows={6}
                        placeholder="Cole aqui o texto com técnicas de vendas, scripts, frameworks ou qualquer conteúdo que a IA deve aprender..."
                        value={knowledgeForm.rawContent}
                        onChange={(e) => setKnowledgeForm({ ...knowledgeForm, rawContent: e.target.value })}
                        style={{ resize: "vertical" }}
                      />
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-primary" type="submit" disabled={addingKnowledge}>
                      {addingKnowledge ? <><Loader2 size={13} className="spin" /> Processando...</> : "Adicionar e processar"}
                    </button>
                    <button className="btn btn-ghost" type="button" onClick={() => setShowNewKnowledge(false)}>Cancelar</button>
                  </div>
                </form>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary btn-sm" onClick={() => setShowNewKnowledge(true)} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Plus size={13} /> Adicionar material
              </button>
            </div>

            {knowledge.length === 0 ? (
              <div className="card"><div className="empty">Nenhum material adicionado ainda. Adicione URLs, vídeos do YouTube ou textos com técnicas de vendas.</div></div>
            ) : (
              knowledge.map((k) => (
                <div key={k.id} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        {k.type === "youtube" ? <Play size={13} color="var(--text-muted)" /> : k.type === "text" ? <FileText size={13} color="var(--text-muted)" /> : <Link size={13} color="var(--text-muted)" />}
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{k.title || k.sourceUrl || "Material de texto"}</div>
                        <span className={`badge ${k.status === "done" ? "badge-green" : k.status === "failed" ? "badge-hot" : "badge-warm"}`} style={{ fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>
                          {k.status === "done" ? "✓ Processado" : k.status === "failed" ? "✗ Erro" : "Processando"}
                        </span>
                      </div>
                      {k.sourceUrl && k.title && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.sourceUrl}</div>
                      )}
                      {k.status === "done" && k.aiSummary && (
                        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.5 }}>
                          {k.aiSummary.slice(0, 200)}{k.aiSummary.length > 200 ? "..." : ""}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                        {new Date(k.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                      </div>
                    </div>
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: 12, flexShrink: 0 }} onClick={() => deleteKnowledge(k.id)} title="Remover">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* References */}
        {tab === "references" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {showNewRef && (
              <div className="card">
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Nova referência</div>
                <form onSubmit={addReference} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ gridColumn: "span 2" }}>
                    <div className="form-label">Nome *</div>
                    <input className="form-input" required value={refForm.name} onChange={(e) => setRefForm({ ...refForm, name: e.target.value })} placeholder="Ex: Jordão Sales" />
                  </div>
                  <div>
                    <div className="form-label">Handle YouTube</div>
                    <input className="form-input" value={refForm.youtubeHandle} onChange={(e) => setRefForm({ ...refForm, youtubeHandle: e.target.value })} placeholder="Ex: jordaosales" />
                  </div>
                  <div>
                    <div className="form-label">Instagram</div>
                    <input className="form-input" value={refForm.instagramHandle} onChange={(e) => setRefForm({ ...refForm, instagramHandle: e.target.value })} placeholder="@handle" />
                  </div>
                  <div style={{ gridColumn: "span 2" }}>
                    <div className="form-label">Especialidade</div>
                    <input className="form-input" value={refForm.specialty} onChange={(e) => setRefForm({ ...refForm, specialty: e.target.value })} placeholder="Ex: Cold call, outbound B2B, scripts de prospecção" />
                  </div>
                  <div style={{ gridColumn: "span 2", display: "flex", gap: 8 }}>
                    <button className="btn btn-primary" type="submit">Adicionar</button>
                    <button className="btn btn-ghost" type="button" onClick={() => setShowNewRef(false)}>Cancelar</button>
                  </div>
                </form>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary btn-sm" onClick={() => setShowNewRef(true)}><Plus size={13} /> Adicionar referência</button>
            </div>

            {references.map((r) => (
              <div key={r.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{r.name}</div>
                    {r.specialty && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>{r.specialty}</div>}
                    <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text-muted)" }}>
                      {r.youtubeHandle && <span>YouTube: @{r.youtubeHandle}</span>}
                      {r.instagramHandle && <span>Instagram: @{r.instagramHandle}</span>}
                    </div>
                    {r.lastEnrichedAt && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                        Último enriquecimento: {new Date(r.lastEnrichedAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => enrich(r.id)}
                      disabled={enrichingId === r.id}
                      title="Enriquecer agora"
                    >
                      {enrichingId === r.id ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                      {enrichingId === r.id ? " Enriquecendo..." : " Enriquecer"}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => deleteRef(r.id)}><Trash2 size={13} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
