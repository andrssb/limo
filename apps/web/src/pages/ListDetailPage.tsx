import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch, cachedGet } from "../lib/api";
import { ArrowLeft, Sparkles, UserMinus, Loader2, Download } from "lucide-react";

export function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [list, setList] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [enrichment, setEnrichment] = useState<any>(null);
  const [product, setProduct] = useState("");
  const [showEnrichForm, setShowEnrichForm] = useState(false);
  const [tab, setTab] = useState<"contacts" | "companies">("contacts");
  const [companies, setCompanies] = useState<any[]>([]);
  const [companyTotal, setCompanyTotal] = useState(0);
  const [companyPage, setCompanyPage] = useState(1);
  const [defaultedTab, setDefaultedTab] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cachedGet<{ list: any; contacts: any[]; total: number }>(`/lists/${id}/contacts?page=${page}&pageSize=20`);
      setList(res.list);
      setContacts(res.contacts);
      setTotal(res.total);
      if (res.list.enrichmentSummary) {
        try { setEnrichment(JSON.parse(res.list.enrichmentSummary)); } catch { /* ignore */ }
      }
    } finally {
      setLoading(false);
    }
  }, [id, page]);

  useEffect(() => { load(); }, [load]);

  const loadCompanies = useCallback(async () => {
    try {
      const res = await cachedGet<{ companies: any[]; total: number }>(`/lists/${id}/companies?page=${companyPage}&pageSize=20`);
      setCompanies(res.companies);
      setCompanyTotal(res.total);
    } catch { /* ignore */ }
  }, [id, companyPage]);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);

  // Default to whichever tab has data — companies are saved first via Descobrir,
  // so a list can have companies but no contacts until the Garimpo runs.
  useEffect(() => {
    if (!defaultedTab && !loading && (total > 0 || companyTotal > 0)) {
      if (total === 0 && companyTotal > 0) setTab("companies");
      setDefaultedTab(true);
    }
  }, [loading, total, companyTotal, defaultedTab]);

  async function removeContact(contactId: string) {
    await apiFetch(`/lists/${id}/contacts/${contactId}`, { method: "DELETE" });
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
    setTotal((t) => Math.max(0, t - 1));
  }

  async function triggerEnrichment(e: React.FormEvent) {
    e.preventDefault();
    if (!product.trim()) return;
    setEnriching(true);
    try {
      const res = await apiFetch<{ enrichment: any }>(`/lists/${id}/enrich`, {
        method: "POST",
        body: JSON.stringify({ productDescription: product }),
      });
      setEnrichment(res.enrichment);
      setShowEnrichForm(false);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setEnriching(false);
    }
  }

  const totalPages = Math.ceil(total / 20);
  const companyTotalPages = Math.ceil(companyTotal / 20);

  if (loading && !list) return <div className="loading" style={{ padding: 40 }}>Carregando...</div>;

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div>
            <button className="btn btn-ghost btn-sm" style={{ marginBottom: 6 }} onClick={() => navigate("/lists")}>
              <ArrowLeft size={14} /> Listas
            </button>
            <div className="page-title">{list?.name ?? "—"}</div>
            <div className="page-subtitle">{total} contato{total !== 1 ? "s" : ""} · {companyTotal} empresa{companyTotal !== 1 ? "s" : ""}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a
              href={`/v1/lists/${id}/export`}
              download
              className="btn btn-secondary"
              style={{ gap: 6, display: "inline-flex", alignItems: "center" }}
            >
              <Download size={14} />
              Exportar CSV
            </a>
            <button className="btn btn-primary" onClick={() => setShowEnrichForm((v) => !v)} style={{ gap: 6 }}>
              <Sparkles size={14} />
              {enrichment ? "Reatualizar gatilhos" : "Gerar gatilhos com IA"}
            </button>
          </div>
        </div>
      </div>

      <div className="content" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Enrichment form */}
        {showEnrichForm && (
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Gatilho de Prospecção com IA</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              Descreva seu produto e a IA identificará os melhores gatilhos para esta lista.
            </div>
            <form onSubmit={triggerEnrichment} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <textarea
                className="form-input"
                rows={3}
                placeholder="Ex: Plataforma de gestão de vendas para times de BDR que ajuda a aumentar taxa de conversão..."
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                required
                style={{ resize: "vertical" }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" type="submit" disabled={enriching}>
                  {enriching ? <><Loader2 size={13} className="spin" /> Analisando...</> : "Gerar gatilhos"}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setShowEnrichForm(false)}>Cancelar</button>
              </div>
            </form>
          </div>
        )}

        {/* Enrichment results */}
        {enrichment && (
          <div className="card" style={{ borderLeft: "3px solid var(--green)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--green)" }}>✦ Inteligência de Gatilho</div>
            {enrichment.resumo && (
              <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 14, padding: "10px 12px", background: "var(--bg-surface)", borderRadius: 8 }}>
                {enrichment.resumo}
              </div>
            )}

            {enrichment.dores?.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Dores identificadas</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {enrichment.dores.map((d: string, i: number) => (
                    <div key={i} style={{ fontSize: 13, padding: "8px 12px", background: "var(--bg-surface)", borderRadius: 6, display: "flex", gap: 8 }}>
                      <span style={{ color: "var(--green)" }}>•</span> {d}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {enrichment.gatilhos?.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Gatilhos de abertura</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {enrichment.gatilhos.map((g: any, i: number) => (
                    <div key={i} style={{ background: "var(--bg-surface)", borderRadius: 8, padding: "12px 14px" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{g.titulo}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>{g.descricao}</div>
                      <div style={{ fontSize: 12, fontStyle: "italic", color: "var(--text)", padding: "8px 10px", background: "var(--bg-card)", borderRadius: 6, borderLeft: "2px solid var(--green)" }}>
                        "{g.abertura}"
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tabs: contatos / empresas */}
        <div className="card">
          <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: "1px solid var(--border)" }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setTab("contacts")}
              style={{ borderRadius: 0, fontWeight: tab === "contacts" ? 700 : 400, borderBottom: tab === "contacts" ? "2px solid var(--green)" : "2px solid transparent" }}
            >
              Contatos ({total})
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setTab("companies")}
              style={{ borderRadius: 0, fontWeight: tab === "companies" ? 700 : 400, borderBottom: tab === "companies" ? "2px solid var(--green)" : "2px solid transparent" }}
            >
              Empresas ({companyTotal})
            </button>
          </div>

          {tab === "contacts" ? (
            loading ? (
              <div className="loading">Carregando...</div>
            ) : contacts.length === 0 ? (
              <div className="empty">Nenhum contato ainda. Rode o Garimpo IA sobre as empresas salvas para encontrar decisores.</div>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Nome</th><th>Empresa</th><th>Cargo</th><th>E-mail</th><th>Telefone</th><th></th></tr>
                    </thead>
                    <tbody>
                      {contacts.map((c) => (
                        <tr key={c.id}>
                          <td onClick={() => navigate(`/contacts/${c.id}`)} style={{ cursor: "pointer", fontWeight: 500, color: "var(--text)" }}>
                            {c.firstName} {c.lastName}
                          </td>
                          <td>{c.companyName ?? "—"}</td>
                          <td>{c.jobTitle ?? "—"}</td>
                          <td>{c.email ?? "—"}</td>
                          <td>{c.phone ?? "—"}</td>
                          <td>
                            <button className="btn btn-ghost btn-sm" onClick={() => removeContact(c.id)} title="Remover da lista">
                              <UserMinus size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="pagination">
                    <button className="page-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>‹</button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                      return <button key={p} className={`page-btn${page === p ? " active" : ""}`} onClick={() => setPage(p)}>{p}</button>;
                    })}
                    <button className="page-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>›</button>
                  </div>
                )}
              </>
            )
          ) : (
            companies.length === 0 ? (
              <div className="empty">Nenhuma empresa nesta lista. Use o Descobrir Empresas para salvar empresas aqui.</div>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Empresa</th><th>CNPJ</th><th>Local</th><th>Setor</th><th>Domínio</th><th>Telefone</th></tr>
                    </thead>
                    <tbody>
                      {companies.map((c) => (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 500, color: "var(--text)" }}>{c.tradeName || c.legalName}</td>
                          <td style={{ fontFamily: "monospace", fontSize: 12 }}>{c.cnpj ?? "—"}</td>
                          <td>{[c.city, c.state].filter(Boolean).join(", ") || "—"}</td>
                          <td>{c.sector ?? "—"}</td>
                          <td>{c.domain ?? "—"}</td>
                          <td>{c.publicPhone ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {companyTotalPages > 1 && (
                  <div className="pagination">
                    <button className="page-btn" onClick={() => setCompanyPage((p) => Math.max(1, p - 1))} disabled={companyPage === 1}>‹</button>
                    {Array.from({ length: Math.min(5, companyTotalPages) }, (_, i) => {
                      const p = Math.max(1, Math.min(companyPage - 2, companyTotalPages - 4)) + i;
                      return <button key={p} className={`page-btn${companyPage === p ? " active" : ""}`} onClick={() => setCompanyPage(p)}>{p}</button>;
                    })}
                    <button className="page-btn" onClick={() => setCompanyPage((p) => Math.min(companyTotalPages, p + 1))} disabled={companyPage === companyTotalPages}>›</button>
                  </div>
                )}
              </>
            )
          )}
        </div>
      </div>
    </>
  );
}
