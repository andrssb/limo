import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, cachedGet } from "../lib/api";
import { friendlySource } from "../lib/sources";

const TEMPS = ["", "hot", "warm", "cold"] as const;
const TEMP_LABELS = { "": "Todos", hot: "Quente", warm: "Morno", cold: "Frio" };

export function ContactsPage() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [temperature, setTemperature] = useState<string>("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showNewContact, setShowNewContact] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (temperature) params.set("temperature", temperature);
    if (search) params.set("search", search);

    try {
      const res = await cachedGet<{ data: any[]; total: number }>(`/contacts?${params}`);
      setContacts(res.data);
      setTotal(res.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, temperature, search]);

  useEffect(() => { load(); }, [load]);

  function clearSelection() {
    setSelected(new Set());
    setSelectAllMatching(false);
  }

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
    clearSelection();
  }

  function changeTemp(t: string) {
    setTemperature(t);
    setPage(1);
    clearSelection();
  }

  function toggleOne(id: string) {
    setSelectAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allOnPageSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const headerChecked = selectAllMatching || allOnPageSelected;

  function togglePage() {
    if (selectAllMatching) { clearSelection(); return; }
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) contacts.forEach((c) => next.delete(c.id));
      else contacts.forEach((c) => next.add(c.id));
      return next;
    });
  }

  // How many are effectively selected for deletion
  const selectedCount = selectAllMatching ? total : selected.size;

  async function bulkDelete() {
    setDeleting(true);
    try {
      const body = selectAllMatching
        ? { all: true, ...(temperature ? { temperature } : {}), ...(search ? { search } : {}) }
        : { ids: [...selected] };
      await apiFetch<{ deleted: number }>("/contacts/bulk-delete", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setShowDeleteConfirm(false);
      clearSelection();
      setPage(1);
      await load();
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  }

  const totalPages = Math.ceil(total / 20);

  const tempBadge = (t: string) => {
    if (t === "hot") return <span className="badge badge-hot">Quente</span>;
    if (t === "warm") return <span className="badge badge-warm">Morno</span>;
    return <span className="badge badge-cold">Frio</span>;
  };

  const sourceBadge = (c: any) => {
    if (c.enrichmentData?.aiGenerated) {
      return <span className="badge badge-warning" title="Lead gerado por IA — verifique antes de contatar">IA não verificado</span>;
    }
    return <span className="badge badge-gray">{friendlySource(c.source)}</span>;
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div>
            <div className="page-title">Contatos</div>
            <div className="page-subtitle">{total} contato{total !== 1 ? "s" : ""} no time</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <form onSubmit={applySearch} style={{ display: "flex", gap: 8 }}>
              <input
                className="form-input"
                style={{ width: 220 }}
                placeholder="Buscar nome, e-mail, empresa..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <button className="btn btn-ghost btn-sm" type="submit">Buscar</button>
            </form>
            <button className="btn btn-primary btn-sm" onClick={() => setShowNewContact(true)}>+ Novo contato</button>
          </div>
        </div>
      </div>

      <div className="content">
        <div className="filter-row">
          {TEMPS.map((t) => (
            <button
              key={t}
              className={`filter-btn${temperature === t ? " active" : ""}`}
              onClick={() => changeTemp(t)}
            >
              {TEMP_LABELS[t]}
            </button>
          ))}
        </div>

        {selectedCount > 0 && (
          <div
            style={{
              display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
              padding: "10px 14px", background: "var(--bg-elevated, #fff)",
              border: "1px solid var(--border, #dde4ee)", borderRadius: 10,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {selectedCount} contato{selectedCount !== 1 ? "s" : ""} selecionado{selectedCount !== 1 ? "s" : ""}
            </span>
            {allOnPageSelected && !selectAllMatching && total > contacts.length && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setSelectAllMatching(true)}
              >
                Selecionar todos os {total}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={clearSelection}>Limpar seleção</button>
            <button
              className="btn btn-danger btn-sm"
              style={{ marginLeft: "auto" }}
              onClick={() => setShowDeleteConfirm(true)}
            >
              Excluir selecionados
            </button>
          </div>
        )}

        <div className="card">
          {loading ? (
            <div className="loading">Carregando...</div>
          ) : contacts.length === 0 ? (
            <div className="empty">Nenhum contato encontrado.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={headerChecked}
                        onChange={togglePage}
                        aria-label="Selecionar todos desta página"
                      />
                    </th>
                    <th>Nome</th>
                    <th>Empresa</th>
                    <th>E-mail</th>
                    <th>Temperatura</th>
                    <th>Origem</th>
                    <th>Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/contacts/${c.id}`)}
                      style={{ cursor: "pointer" }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectAllMatching || selected.has(c.id)}
                          onChange={() => toggleOne(c.id)}
                          aria-label={`Selecionar ${c.firstName} ${c.lastName}`}
                        />
                      </td>
                      <td style={{ color: "var(--text)", fontWeight: 500 }}>
                        {c.firstName} {c.lastName}
                        {c.jobTitle && (
                          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400, marginTop: 2 }}>
                            {c.jobTitle}
                          </div>
                        )}
                      </td>
                      <td>{c.companyName ?? "—"}</td>
                      <td>{c.email ?? "—"}</td>
                      <td>{tempBadge(c.temperature)}</td>
                      <td>{sourceBadge(c)}</td>
                      <td>{new Date(c.createdAt).toLocaleDateString("pt-BR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="pagination">
              <button className="page-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>‹</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                return (
                  <button key={p} className={`page-btn${page === p ? " active" : ""}`} onClick={() => setPage(p)}>
                    {p}
                  </button>
                );
              })}
              <button className="page-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>›</button>
            </div>
          )}
        </div>
      </div>

      {showNewContact && (
        <NewContactModal
          onClose={() => setShowNewContact(false)}
          onCreated={(id) => { setShowNewContact(false); navigate(`/contacts/${id}`); }}
        />
      )}

      {showDeleteConfirm && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => !deleting && setShowDeleteConfirm(false)}>
          <div className="card" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
              Excluir {selectedCount} contato{selectedCount !== 1 ? "s" : ""}?
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
              Esta ação é irreversível. As ligações e mensagens associadas a {selectedCount !== 1 ? "esses contatos" : "esse contato"} também serão removidas.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1, justifyContent: "center" }}
                disabled={deleting}
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancelar
              </button>
              <button
                className="btn btn-danger"
                style={{ flex: 1, justifyContent: "center" }}
                disabled={deleting}
                onClick={bulkDelete}
              >
                {deleting ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Novo contato (cadastro manual — SDR/BDR) ───────────────────────────────

function NewContactModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "", companyName: "", jobTitle: "", linkedinUrl: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(field: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [field]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSaving(true);
    try {
      // Só envia campos preenchidos (email/linkedin vazios quebrariam a validação).
      const payload: Record<string, string> = { firstName: form.firstName.trim(), lastName: form.lastName.trim(), source: "manual" };
      for (const k of ["email", "phone", "companyName", "jobTitle", "linkedinUrl"] as const) {
        if (form[k].trim()) payload[k] = form[k].trim();
      }
      const res = await apiFetch<{ contact: { id: string } }>("/contacts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      onCreated(res.contact.id);
    } catch (err: any) {
      setError(err?.message ?? "Erro ao criar contato.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 28, width: 460, maxWidth: "92vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Novo contato</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
        <form onSubmit={submit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Nome *</label>
              <input className="form-input" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} required />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Sobrenome *</label>
              <input className="form-input" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} required />
            </div>
          </div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label">Empresa</label>
            <input className="form-input" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Cargo</label>
            <input className="form-input" value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} placeholder="ex: Head de Vendas" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">E-mail</label>
              <input className="form-input" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Telefone</label>
              <input className="form-input" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
          </div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label">LinkedIn <span style={{ color: "var(--text-muted)" }}>(URL completa)</span></label>
            <input className="form-input" value={form.linkedinUrl} onChange={(e) => set("linkedinUrl", e.target.value)} placeholder="https://www.linkedin.com/in/..." />
          </div>

          {error && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--red)" }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex: 1, justifyContent: "center" }}>
              {saving ? "Salvando..." : "Criar contato"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
