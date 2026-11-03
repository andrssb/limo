import React, { useEffect, useState } from "react";
import { apiFetch, cachedGet } from "../lib/api";
import { Search, Loader2, Users, MapPin, TrendingUp, Building2, Save } from "lucide-react";

const UF_OPTIONS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const EMPLOYEE_OPTIONS = [
  { value: "",        label: "Qualquer porte" },
  { value: "1-10",    label: "1 – 10 funcionários" },
  { value: "11-50",   label: "11 – 50 funcionários" },
  { value: "51-100",  label: "51 – 100 funcionários" },
  { value: "101-200", label: "101 – 200 funcionários" },
  { value: "201-500", label: "201 – 500 funcionários" },
  { value: "501-1000",label: "501 – 1.000 funcionários" },
  { value: "1000+",   label: "Acima de 1.000 funcionários" },
];

interface Company {
  cnpj:                 string | null;
  legal_name:           string;
  trade_name:           string | null;
  state:                string | null;
  city:                 string | null;
  website:              string | null;
  website_type:         string;
  employee_count:       number | null;
  employee_count_range: string | null;
  employee_count_type:  string;
  employee_confidence:  number;
  revenue:              number | null;
  revenue_range:        string | null;
  revenue_type:         string;
  revenue_confidence:   number;
  confidence:           Record<string, number>;
  sources:              Record<string, string>;
}

function ConfidenceBadge({ value }: { value: number }) {
  const color = value >= 80 ? "#16a34a" : value >= 50 ? "#d97706" : "#9ca3af";
  const bg    = value >= 80 ? "rgba(22,163,74,0.1)" : value >= 50 ? "rgba(217,119,6,0.1)" : "rgba(156,163,175,0.1)";
  return (
    <span style={{ fontSize: 9, color, background: bg, padding: "1px 5px", borderRadius: 3, fontWeight: 900, marginLeft: 4 }}>
      {value}%
    </span>
  );
}

export function DiscoveryPage() {
  const [sector, setSector]       = useState("");
  const [state, setState]         = useState("");
  const [employeeRange, setRange] = useState("");
  const [results, setResults]     = useState<Company[]>([]);
  const [loading, setLoading]     = useState(false);
  const [searched, setSearched]   = useState(false);
  const [total, setTotal]         = useState(0);
  const [displayCount, setDisplayCount] = useState(50);

  // Save-to-list state
  const [lists, setLists] = useState<any[]>([]);
  const [selectedListId, setSelectedListId] = useState("");
  const [newListName, setNewListName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  async function loadLists() {
    try {
      const res = await cachedGet<{ lists: any[] }>("/lists");
      setLists(res.lists);
    } catch { /* ignore */ }
  }

  useEffect(() => { loadLists(); }, []);

  async function saveToList() {
    setSaving(true);
    setSaveMsg("");
    try {
      let listId = selectedListId;
      if (listId === "__new__") {
        const created = await apiFetch<{ list: { id: string } }>("/lists", {
          method: "POST",
          body: JSON.stringify({ name: newListName.trim() }),
        });
        listId = created.list.id;
      }
      const res = await apiFetch<{ added: number; requested: number }>("/discovery/save-to-list", {
        method: "POST",
        body: JSON.stringify({ listId, companies: results }),
      });
      const dupes = res.requested - res.added;
      setSaveMsg(`${res.added} empresa(s) salva(s)${dupes > 0 ? ` — ${dupes} já estavam na lista` : ""}`);
      await loadLists();
      if (selectedListId === "__new__") { setNewListName(""); setSelectedListId(listId); }
    } catch (e: any) {
      setSaveMsg(`Erro: ${e?.message ?? "falha ao salvar"}`);
    } finally {
      setSaving(false);
    }
  }

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!sector.trim()) return;
    setLoading(true);
    setSearched(true);
    setDisplayCount(50);
    setSaveMsg("");
    try {
      const res = await apiFetch<{ companies: Company[]; total: number }>("/discovery/search", {
        method: "POST",
        body: JSON.stringify({
          sector,
          state:         state         || undefined,
          employeeRange: employeeRange || undefined,
          limit: 25000,
        }),
      });
      setResults(res.companies);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }

  const displayName = (c: Company) => c.trade_name || c.legal_name;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Descobrir Empresas</div>
          <div className="page-subtitle">Busque empresas por setor, estado e porte</div>
        </div>
      </div>

      <div className="content" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card">
          <form onSubmit={search} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10, alignItems: "end" }}>
            <div>
              <div className="form-label">Setor *</div>
              <input
                className="form-input"
                placeholder="Ex: tecnologia, saúde, logística, construção..."
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                required
              />
            </div>
            <div>
              <div className="form-label">Estado</div>
              <select className="form-input" value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">Todos os estados</option>
                {UF_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <div className="form-label">Nº de funcionários</div>
              <select className="form-input" value={employeeRange} onChange={(e) => setRange(e.target.value)}>
                {EMPLOYEE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={loading || !sector.trim()}
              style={{ gridColumn: "span 3" }}
            >
              {loading
                ? <><Loader2 size={14} className="spin" /> Buscando...</>
                : <><Search size={14} /> Buscar empresas</>}
            </button>
          </form>
        </div>

        {searched && !loading && (
          <div className="card">
            {results.length === 0 ? (
              <div className="empty">Nenhuma empresa encontrada. Tente outros filtros.</div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    Mostrando {Math.min(displayCount, total)} de {total} empresa{total !== 1 ? "s" : ""}
                  </div>
                  {results.length > 0 && (
                    <div style={{ fontSize: 11, color: "#16a34a", background: "rgba(22,163,74,0.1)", padding: "3px 8px", borderRadius: 4 }}>
                      Fonte: Base de dados Limo
                    </div>
                  )}
                </div>

                {/* Save to list bar */}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap", padding: "10px 12px", background: "var(--bg-surface)", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <Save size={14} style={{ color: "var(--text-muted)" }} />
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Salvar {total} empresa{total !== 1 ? "s" : ""} em:</span>
                  <select
                    className="form-input"
                    style={{ width: "auto", flex: "0 1 240px" }}
                    value={selectedListId}
                    onChange={(e) => setSelectedListId(e.target.value)}
                  >
                    <option value="">Selecione uma lista…</option>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>{l.name} ({l.companyCount ?? 0} empresas)</option>
                    ))}
                    <option value="__new__">+ Nova lista…</option>
                  </select>
                  {selectedListId === "__new__" && (
                    <input
                      className="form-input"
                      style={{ width: "auto", flex: "0 1 200px" }}
                      placeholder="Nome da nova lista"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                    />
                  )}
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={saveToList}
                    disabled={saving || !selectedListId || (selectedListId === "__new__" && !newListName.trim())}
                  >
                    {saving ? <><Loader2 size={13} className="spin" /> Salvando…</> : "Salvar na lista"}
                  </button>
                  {saveMsg && <span style={{ fontSize: 12, color: saveMsg.startsWith("Erro") ? "var(--red)" : "var(--green)" }}>{saveMsg}</span>}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {results.slice(0, displayCount).map((c, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "12px 14px",
                        background: "var(--bg-surface)",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                      }}
                    >
                      {/* Header row */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>
                            {displayName(c)}
                          </div>
                          {c.trade_name && c.legal_name !== c.trade_name && (
                            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{c.legal_name}</div>
                          )}
                        </div>
                        {/* Location + CNPJ */}
                        <div style={{ display: "flex", gap: 12, flexShrink: 0, alignItems: "center" }}>
                          {(c.city || c.state) && (
                            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
                              <MapPin size={11} />
                              {[c.city, c.state].filter(Boolean).join(", ")}
                              <ConfidenceBadge value={c.confidence?.city ?? 0} />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Data row */}
                      <div style={{ display: "flex", gap: 20, marginTop: 8, flexWrap: "wrap" }}>
                        {/* Employees */}
                        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                          <Users size={11} style={{ color: "var(--text-muted)" }} />
                          <span style={{ color: "var(--text-muted)" }}>
                            {c.employee_count ?? c.employee_count_range ?? "—"}
                          </span>
                          <ConfidenceBadge value={c.employee_confidence} />
                        </div>

                        {/* Revenue */}
                        {c.revenue_range && (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                            <TrendingUp size={11} style={{ color: "var(--text-muted)" }} />
                            <span style={{ color: "var(--text-muted)" }}>{c.revenue_range}</span>
                            <ConfidenceBadge value={c.revenue_confidence} />
                          </div>
                        )}

                        {/* CNPJ */}
                        {c.cnpj && (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                            <Building2 size={11} style={{ color: "var(--text-muted)" }} />
                            <span style={{ color: "var(--text-muted)", fontFamily: "monospace" }}>{c.cnpj}</span>
                            <ConfidenceBadge value={c.confidence?.cnpj ?? 0} />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {displayCount < total && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => setDisplayCount((n) => n + 50)}
                    style={{ marginTop: 12, width: "100%" }}
                  >
                    Carregar mais ({Math.min(50, total - displayCount)} de {total - displayCount} restantes)
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
