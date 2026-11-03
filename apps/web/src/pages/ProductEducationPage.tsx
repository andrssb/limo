import React, { useEffect, useState } from "react";
import { apiFetch, cachedGet } from "../lib/api";
import { Plus, Trash2, Loader2, CheckCircle, Clock, Link, FileText, BookOpen, Lightbulb } from "lucide-react";

const STATUS_ICON: Record<string, React.ReactNode> = {
  done:       <CheckCircle size={13} style={{ color: "var(--green)" }} />,
  processing: <Loader2 size={13} className="spin" style={{ color: "var(--yellow)" }} />,
  pending:    <Clock size={13} style={{ color: "var(--text-muted)" }} />,
  failed:     <span style={{ fontSize: 12, color: "var(--red)" }}>✕</span>,
};

export function ProductEducationPage() {
  const [materials, setMaterials] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showNew, setShowNew]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [form, setForm]           = useState({ type: "url", title: "", sourceUrl: "", rawContent: "" });

  async function load() {
    setLoading(true);
    try {
      const res = await cachedGet<{ materials: any[] }>("/product-materials");
      setMaterials(res.materials);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 8000); // poll for processing status
    return () => clearInterval(t);
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/product-materials", {
        method: "POST",
        body: JSON.stringify({
          type: form.type,
          title: form.title || undefined,
          sourceUrl: form.type === "url" ? form.sourceUrl : undefined,
          rawContent: form.type === "text" ? form.rawContent : undefined,
        }),
      });
      setForm({ type: "url", title: "", sourceUrl: "", rawContent: "" });
      setShowNew(false);
      load();
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    await apiFetch(`/product-materials/${id}`, { method: "DELETE" });
    setMaterials((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div>
            <div className="page-title">Educação de Produto</div>
            <div className="page-subtitle">
              Ensine o Limo sobre o que você vende — ele usará isso no coaching ao vivo e na geração de conteúdo
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <Plus size={14} /> Adicionar material
          </button>
        </div>
      </div>

      <div className="content" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {showNew && (
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Novo material de produto</div>
            <form onSubmit={add} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8 }}>
                {(["url", "text"] as const).map((t) => (
                  <button
                    key={t} type="button"
                    className={`filter-btn${form.type === t ? " active" : ""}`}
                    onClick={() => setForm({ ...form, type: t })}
                  >
                    {t === "url" ? <><Link size={12} /> URL / Site</> : <><FileText size={12} /> Texto livre</>}
                  </button>
                ))}
              </div>

              <input className="form-input" placeholder="Título (opcional)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />

              {form.type === "url" ? (
                <input
                  className="form-input"
                  type="url"
                  placeholder="https://suaempresa.com.br ou link do vídeo do YouTube *"
                  value={form.sourceUrl}
                  onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
                  required
                />
              ) : (
                <textarea
                  className="form-input"
                  rows={5}
                  placeholder="Cole aqui o texto sobre o produto, proposta de valor, diferenciais, objeções comuns... *"
                  value={form.rawContent}
                  onChange={(e) => setForm({ ...form, rawContent: e.target.value })}
                  required
                  style={{ resize: "vertical" }}
                />
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" type="submit" disabled={saving}>
                  {saving ? <><Loader2 size={13} className="spin" /> Processando...</> : "Adicionar"}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setShowNew(false)}>Cancelar</button>
              </div>
            </form>
          </div>
        )}

        {loading && materials.length === 0 ? (
          <div className="loading">Carregando...</div>
        ) : materials.length === 0 ? (
          <div className="card">
            <div className="empty" style={{ padding: "40px 20px" }}>
              <BookOpen size={28} style={{ color: "var(--text-muted)", marginBottom: 12 }} />
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Nenhum material ainda</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 400, margin: "0 auto" }}>
                Adicione o site da sua empresa, páginas de produto, landing pages ou um texto descrevendo o que você vende.
                A IA vai processar e usar esse conhecimento no coaching ao vivo.
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {materials.map((m) => (
              <div key={m.id} className="card" style={{ cursor: "default" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      {STATUS_ICON[m.status] ?? STATUS_ICON.pending}
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{m.title ?? m.sourceUrl ?? "Material de texto"}</span>
                      <span className="badge badge-gray" style={{ fontSize: 10 }}>{m.type}</span>
                    </div>
                    {m.sourceUrl && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{m.sourceUrl}</div>
                    )}
                    {m.status === "processing" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--yellow)", marginTop: 4 }}>
                        <Loader2 size={11} className="spin" /> IA está processando o conteúdo...
                      </div>
                    )}
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(m.id)} title="Remover">
                    <Trash2 size={13} />
                  </button>
                </div>

                {expanded === m.id && m.aiSummary && (
                  <div style={{ marginTop: 12, padding: "12px 14px", background: "var(--bg-surface)", borderRadius: 8, borderLeft: "3px solid var(--green)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--green)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Resumo extraído pela IA
                    </div>
                    <pre style={{ fontSize: 12, color: "var(--text)", whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>
                      {(() => {
                        try {
                          const p = JSON.parse(m.aiSummary.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
                          return Object.entries(p).map(([k, v]) =>
                            `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? (v as string[]).join(", ") : v}`
                          ).join("\n");
                        } catch { return m.aiSummary; }
                      })()}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "12px 16px", background: "var(--bg-surface)", borderRadius: 8, fontSize: 12, color: "var(--text-muted)", borderLeft: "3px solid var(--border-light)" }}>
          <Lightbulb size={14} style={{ flexShrink: 0, marginTop: 1, color: "var(--green)" }} />
          <span>Quanto mais materiais você adicionar, mais preciso será o coaching ao vivo. Adicione o site principal, landing pages, decks de vendas (como texto) e páginas de produto.</span>
        </div>
      </div>
    </>
  );
}
