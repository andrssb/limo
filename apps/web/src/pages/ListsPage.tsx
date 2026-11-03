import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, cachedGet } from "../lib/api";
import { Plus, Trash2, Users } from "lucide-react";

export function ListsPage() {
  const navigate = useNavigate();
  const [lists, setLists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await cachedGet<{ lists: any[] }>("/lists");
      setLists(res.lists);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/lists", { method: "POST", body: JSON.stringify({ name: name.trim(), description: desc.trim() || undefined }) });
      setName(""); setDesc(""); setShowNew(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Deletar lista e remover todos os contatos dela?")) return;
    await apiFetch(`/lists/${id}`, { method: "DELETE" });
    setLists((prev) => prev.filter((l) => l.id !== id));
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div>
            <div className="page-title">Listas de Prospecção</div>
            <div className="page-subtitle">Organize contatos em listas e gere inteligência de gatilho com IA</div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <Plus size={14} /> Nova lista
          </button>
        </div>
      </div>

      <div className="content">
        {showNew && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Nova lista</div>
            <form onSubmit={create} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input className="form-input" placeholder="Nome da lista *" value={name} onChange={(e) => setName(e.target.value)} required />
              <input className="form-input" placeholder="Descrição (opcional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Criando..." : "Criar"}</button>
                <button className="btn btn-ghost" type="button" onClick={() => setShowNew(false)}>Cancelar</button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="loading">Carregando...</div>
        ) : lists.length === 0 ? (
          <div className="card">
            <div className="empty">Nenhuma lista criada. Crie sua primeira lista de prospecção.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {lists.map((l) => (
              <div
                key={l.id}
                className="card"
                style={{ cursor: "pointer", position: "relative" }}
                onClick={() => navigate(`/lists/${l.id}`)}
              >
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ position: "absolute", top: 10, right: 10, padding: "4px 6px" }}
                  onClick={(e) => { e.stopPropagation(); remove(l.id); }}
                >
                  <Trash2 size={13} />
                </button>

                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, paddingRight: 32 }}>{l.name}</div>
                {l.description && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>{l.description}</div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}>
                  <Users size={13} />
                  {l.contactCount} contato{l.contactCount !== 1 ? "s" : ""}
                </div>
                {l.enrichmentSummary && (
                  <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--bg-surface)", borderRadius: 6, fontSize: 11, color: "var(--green)", borderLeft: "3px solid var(--green)" }}>
                    ✦ Gatilhos gerados pela IA
                  </div>
                )}
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
                  {new Date(l.createdAt).toLocaleDateString("pt-BR")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
