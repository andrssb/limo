import React, { useEffect, useState, useRef } from "react";
import { apiFetch, cachedGet, getStoredUser } from "../lib/api";
import { Plus, Play, Loader2, CheckCircle, XCircle, Clock, Cpu, ShoppingCart, X, Package } from "lucide-react";

const STATE_OPTIONS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const PERSONA_PACKS = [
  { size: 50,  priceBRL: 67,  perUnit: 1.34 },
  { size: 80,  priceBRL: 97,  perUnit: 1.21 },
  { size: 90,  priceBRL: 107, perUnit: 1.19 },
  { size: 100, priceBRL: 117, perUnit: 1.17 },
] as const;

interface PersonaQuota {
  monthlyAllowance:  number;
  monthlyUsed:       number;
  monthlyRemaining:  number;
  extraBalance:      number;
  totalAvailable:    number;
  periodStartedAt:   string | null;
  periodEndsAt:      string | null;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "done")    return <span style={{ color: "var(--green)", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}><CheckCircle size={13} /> Concluído</span>;
  if (status === "running") return <span style={{ color: "var(--yellow)", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}><Loader2 size={13} className="spin" /> Rodando</span>;
  if (status === "failed")  return <span style={{ color: "var(--red)", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}><XCircle size={13} /> Falhou</span>;
  return <span style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}><Clock size={13} /> Aguardando</span>;
}

export function GarimpoPage() {
  const [personas, setPersonas]       = useState<any[]>([]);
  const [lists, setLists]             = useState<any[]>([]);
  const [runs, setRuns]               = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState<"personas" | "runs">("personas");
  const [showNew, setShowNew]         = useState(false);
  const [launching, setLaunching]     = useState(false);
  const [runTarget, setRunTarget]     = useState<{ personaId: string; listId: string; maxContacts?: number } | null>(null);
  const isManager = (() => { const u = getStoredUser(); return u?.role === "manager" || u?.role === "admin"; })();
  const [logRun, setLogRun]           = useState<any | null>(null);
  const [garimpoConfig, setGarimpoConfig] = useState<{ sources: string[] } | null>(null);
  const [quota, setQuota]             = useState<PersonaQuota | null>(null);
  const [showPacks, setShowPacks]     = useState(false);
  const [buyingSize, setBuyingSize]   = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const [form, setForm] = useState({
    name: "", targetRoles: "", targetSectors: "", targetCnaes: "",
    targetStates: [] as string[], targetCities: "",
    minEmployees: "", maxEmployees: "",
    painPoint: "", productDescription: "",
  });

  async function loadAll() {
    setLoading(true);
    try {
      const [pRes, lRes, rRes, cfgRes, mRes] = await Promise.all([
        cachedGet<{ personas: any[] }>("/personas"),
        cachedGet<{ lists: any[] }>("/lists"),
        cachedGet<{ runs: any[] }>("/garimpo/runs"),
        cachedGet<{ sources: string[] }>("/garimpo/config"),
        cachedGet<{ team: any; personaQuota: PersonaQuota }>("/teams/mine").catch(() => null),
      ]);
      setPersonas(pRes.personas);
      setLists(lRes.lists);
      setRuns(rRes.runs);
      setGarimpoConfig(cfgRes);
      if (mRes?.personaQuota) setQuota(mRes.personaQuota);
    } finally {
      setLoading(false);
    }
  }

  async function buyPersonaPack(size: number) {
    setBuyingSize(size);
    try {
      const res = await apiFetch<{ url: string }>("/billing/persona-pack/checkout", {
        method: "POST",
        body: JSON.stringify({ size }),
      });
      window.location.href = res.url;
    } catch (e: any) {
      alert(e?.message ?? "Não foi possível iniciar o pagamento.");
      setBuyingSize(null);
    }
  }

  useEffect(() => {
    loadAll();
    pollRef.current = setInterval(() => {
      apiFetch<{ runs: any[] }>("/garimpo/runs").then((r) => setRuns(r.runs)).catch(() => {});
    }, 5000);

    // Handle return from Stripe Checkout (one-time persona pack purchase)
    const params = new URLSearchParams(window.location.search);
    if (params.get("pack") === "success") {
      const size = params.get("size");
      alert(`Pagamento confirmado! +${size} mapeamentos de personas creditados na sua conta.`);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("pack") === "cancelled") {
      window.history.replaceState({}, "", window.location.pathname);
    }

    return () => clearInterval(pollRef.current);
  }, []);

  async function savePersona(e: React.FormEvent) {
    e.preventDefault();
    await apiFetch("/personas", {
      method: "POST",
      body: JSON.stringify({
        name: form.name,
        targetRoles:   form.targetRoles.split(",").map((s) => s.trim()).filter(Boolean),
        targetSectors: form.targetSectors.split(",").map((s) => s.trim()).filter(Boolean),
        targetCnaes:   form.targetCnaes.split(",").map((s) => s.trim()).filter(Boolean),
        targetStates:  form.targetStates,
        targetCities:  form.targetCities.split(",").map((s) => s.trim()).filter(Boolean),
        minEmployees:  form.minEmployees ? Number(form.minEmployees) : undefined,
        maxEmployees:  form.maxEmployees ? Number(form.maxEmployees) : undefined,
        painPoint:          form.painPoint,
        productDescription: form.productDescription,
      }),
    });
    setShowNew(false);
    setForm({ name:"", targetRoles:"", targetSectors:"", targetCnaes:"", targetStates:[], targetCities:"", minEmployees:"", maxEmployees:"", painPoint:"", productDescription:"" });
    loadAll();
  }

  async function deletePersona(id: string) {
    if (!confirm("Deletar persona?")) return;
    await apiFetch(`/personas/${id}`, { method: "DELETE" });
    setPersonas((prev) => prev.filter((p) => p.id !== id));
  }

  async function triggerRun() {
    if (!runTarget) return;
    setLaunching(true);
    try {
      await apiFetch("/garimpo/run", {
        method: "POST",
        body: JSON.stringify(runTarget),
      });
      setRunTarget(null);
      setTab("runs");
      loadAll();
    } finally {
      setLaunching(false);
    }
  }

  if (loading) return <div className="loading" style={{ padding: 40 }}>Carregando...</div>;

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div>
            <div className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Cpu size={20} /> Garimpo
            </div>
            <div className="page-subtitle">Robô de scraping diário — encontra contatos que batem com suas personas</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setShowPacks(true)} title="Comprar mais mapeamentos de personas">
              <ShoppingCart size={14} /> Adicionar mais mapeamentos
            </button>
            {tab === "personas" && (
              <button className="btn btn-primary" onClick={() => setShowNew(true)}><Plus size={14} /> Nova persona</button>
            )}
          </div>
        </div>
      </div>

      {showPacks && (
        <div
          onClick={() => buyingSize === null && setShowPacks(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ maxWidth: 720, width: "100%", padding: 20, position: "relative" }}
          >
            <button
              onClick={() => buyingSize === null && setShowPacks(false)}
              style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
              aria-label="Fechar"
            ><X size={18} /></button>

            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Adicionar mais mapeamentos de personas</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
              Pagamento único. O saldo é creditado na sua conta e usado depois que o limite mensal do plano acabar.
            </div>

            {quota && (
              <div className="card" style={{ marginBottom: 16, padding: "10px 12px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
                <span><strong>Plano atual:</strong> {quota.monthlyUsed}/{quota.monthlyAllowance} mensais</span>
                <span><strong>Saldo extra:</strong> {quota.extraBalance}</span>
                <span><strong>Total disponível:</strong> {quota.totalAvailable}</span>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              {PERSONA_PACKS.map((pack) => (
                <div key={pack.size} className="card" style={{ padding: 14, textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--green)" }}>+{pack.size}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>personas</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>R$ {pack.priceBRL}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 10 }}>
                    R$ {pack.perUnit.toFixed(2).replace(".", ",")} cada
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ width: "100%", justifyContent: "center" }}
                    disabled={buyingSize !== null}
                    onClick={() => buyPersonaPack(pack.size)}
                  >
                    {buyingSize === pack.size ? <><Loader2 size={13} className="spin" /> Aguarde</> : "Comprar"}
                  </button>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 16, textAlign: "center" }}>
              Os pacotes são acumuláveis e não expiram. Você sai daqui pro Stripe pra finalizar o pagamento.
            </div>
          </div>
        </div>
      )}

      <div className="content">
        {/* Tabs */}
        <div className="filter-row" style={{ marginBottom: 16 }}>
          <button className={`filter-btn${tab === "personas" ? " active" : ""}`} onClick={() => setTab("personas")}>
            Personas ({personas.length})
          </button>
          <button className={`filter-btn${tab === "runs" ? " active" : ""}`} onClick={() => setTab("runs")}>
            Execuções ({runs.length})
          </button>
        </div>

        {/* Sources banner */}
        {garimpoConfig && (
          <div className="card" style={{ marginBottom: 16, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>Fontes ativas:</span>
              <span className="badge badge-green" style={{ fontSize: 11 }}>✓ Base de dados Limo</span>
              <span className="badge badge-green" style={{ fontSize: 11 }}>✓ Extensão LinkedIn</span>
            </div>
          </div>
        )}

        {/* New persona form */}
        {tab === "personas" && showNew && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Nova Persona</div>
            <form onSubmit={savePersona} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ gridColumn: "span 2" }}>
                <div className="form-label">Nome da persona *</div>
                <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Ex: Diretor de TI em fintechs SP" />
              </div>
              <div>
                <div className="form-label">Cargos-alvo (separados por vírgula)</div>
                <input className="form-input" value={form.targetRoles} onChange={(e) => setForm({ ...form, targetRoles: e.target.value })} placeholder="CEO, CTO, Diretor Comercial" />
              </div>
              <div>
                <div className="form-label">Setores (separados por vírgula)</div>
                <input className="form-input" value={form.targetSectors} onChange={(e) => setForm({ ...form, targetSectors: e.target.value })} placeholder="Tecnologia, Saúde, Varejo" />
              </div>
              <div>
                <div className="form-label">CNAEs (separados por vírgula)</div>
                <input className="form-input" value={form.targetCnaes} onChange={(e) => setForm({ ...form, targetCnaes: e.target.value })} placeholder="6201-5/01, 6202-3/00" />
              </div>
              <div>
                <div className="form-label">Cidades (separadas por vírgula)</div>
                <input className="form-input" value={form.targetCities} onChange={(e) => setForm({ ...form, targetCities: e.target.value })} placeholder="São Paulo, Campinas" />
              </div>
              <div>
                <div className="form-label">Estados</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {STATE_OPTIONS.map((s) => (
                    <button
                      key={s} type="button"
                      className={`filter-btn${form.targetStates.includes(s) ? " active" : ""}`}
                      style={{ padding: "3px 8px", fontSize: 11 }}
                      onClick={() => setForm({ ...form, targetStates: form.targetStates.includes(s) ? form.targetStates.filter((x) => x !== s) : [...form.targetStates, s] })}
                    >{s}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="form-label">Funcionários (min — max)</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="form-input" type="number" placeholder="Mín" value={form.minEmployees} onChange={(e) => setForm({ ...form, minEmployees: e.target.value })} />
                  <input className="form-input" type="number" placeholder="Máx" value={form.maxEmployees} onChange={(e) => setForm({ ...form, maxEmployees: e.target.value })} />
                </div>
              </div>
              <div style={{ gridColumn: "span 2" }}>
                <div className="form-label">Produto que você vende</div>
                <textarea className="form-input" rows={2} value={form.productDescription} onChange={(e) => setForm({ ...form, productDescription: e.target.value })} placeholder="Plataforma de gestão de vendas para times de BDR..." style={{ resize: "vertical" }} />
              </div>
              <div style={{ gridColumn: "span 2" }}>
                <div className="form-label">Dor principal que você resolve</div>
                <textarea className="form-input" rows={2} value={form.painPoint} onChange={(e) => setForm({ ...form, painPoint: e.target.value })} placeholder="Equipes de vendas perdem tempo em tarefas manuais..." style={{ resize: "vertical" }} />
              </div>
              <div style={{ gridColumn: "span 2", display: "flex", gap: 8 }}>
                <button className="btn btn-primary" type="submit">Salvar persona</button>
                <button className="btn btn-ghost" type="button" onClick={() => setShowNew(false)}>Cancelar</button>
              </div>
            </form>
          </div>
        )}

        {/* Personas list */}
        {tab === "personas" && (
          personas.length === 0 ? (
            <div className="card"><div className="empty">Nenhuma persona criada. Crie uma para o Garimpo começar a trabalhar.</div></div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {personas.map((p) => (
                <div key={p.id} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{p.name}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                        {p.targetRoles?.map((r: string) => <span key={r} className="badge badge-green">{r}</span>)}
                        {p.targetSectors?.map((s: string) => <span key={s} className="badge badge-gray">{s}</span>)}
                        {p.targetStates?.map((s: string) => <span key={s} className="badge badge-gray">{s}</span>)}
                        {p.targetCnaes?.map((c: string) => <span key={c} className="badge badge-gray">CNAE {c}</span>)}
                      </div>
                      {p.productDescription && (
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}><Package size={12} style={{ verticalAlign: "middle" }} /> {p.productDescription.slice(0, 100)}{p.productDescription.length > 100 ? "…" : ""}</div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginLeft: 16 }}>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setRunTarget({ personaId: p.id, listId: "" })}
                      >
                        <Play size={12} /> Rodar agora
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => deletePersona(p.id)}>Excluir</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* Runs list */}
        {tab === "runs" && (
          runs.length === 0 ? (
            <div className="card"><div className="empty">Nenhuma execução ainda. Rode o Garimpo em uma persona.</div></div>
          ) : (
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Persona</th>
                      <th>Lista</th>
                      <th>Status</th>
                      <th>Empresas</th>
                      <th>Contatos</th>
                      <th>Iniciado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id} onClick={() => setLogRun(r)} style={{ cursor: "pointer" }} title="Ver log da execução">
                        <td style={{ fontWeight: 500 }}>{r.personaName}</td>
                        <td>{r.listName}</td>
                        <td><StatusBadge status={r.status} /></td>
                        <td>{r.companiesScanned}</td>
                        <td style={{ color: r.contactsFound > 0 ? "var(--green)" : undefined, fontWeight: r.contactsFound > 0 ? 600 : 400 }}>
                          {r.contactsFound}
                        </td>
                        <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                          {new Date(r.startedAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </div>

      {/* Log da execução */}
      {logRun && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={(e) => { if (e.target === e.currentTarget) setLogRun(null); }}>
          <div className="card" style={{ width: 720, maxWidth: "94vw", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Log do Garimpo — {logRun.personaName}</div>
              <button onClick={() => setLogRun(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              {logRun.companiesScanned} empresas · {logRun.contactsFound} contatos · lista {logRun.listName}
            </div>
            <div style={{
              flex: 1, overflowY: "auto", background: "var(--bg-surface)", borderRadius: 8,
              padding: "12px 14px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5,
              lineHeight: 1.65, color: "var(--text-secondary)", whiteSpace: "pre-wrap",
            }}>
              {Array.isArray(logRun.log) && logRun.log.length > 0
                ? (logRun.log as string[]).join("\n")
                : "Sem log registrado para esta execução."}
            </div>
          </div>
        </div>
      )}

      {/* Run modal */}
      {runTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="card" style={{ width: 380 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Iniciar Garimpo</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
              O Garimpo trabalha as empresas salvas nesta lista (via Descobrir) e adiciona nela os decisores encontrados. Se a lista não tiver empresas, ele descobre pelo setor da persona.
            </div>
            <select className="form-input" style={{ marginBottom: 12 }} value={runTarget.listId}
              onChange={(e) => setRunTarget({ ...runTarget, listId: e.target.value })}>
              <option value="">Selecione uma lista...</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.companyCount ?? 0} empresas · {l.contactCount ?? 0} contatos)</option>)}
            </select>
            {isManager && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
                  Quantos contatos extrair (opcional)
                </label>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  placeholder="Vazio = máximo do plano"
                  value={runTarget.maxContacts ?? ""}
                  onChange={(e) => setRunTarget({ ...runTarget, maxContacts: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Limita quantos decisores o Garimpo traz nesta execução.
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={triggerRun} disabled={!runTarget.listId || launching}>
                {launching ? <><Loader2 size={13} className="spin" /> Iniciando...</> : <><Play size={13} /> Iniciar</>}
              </button>
              <button className="btn btn-ghost" onClick={() => setRunTarget(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
