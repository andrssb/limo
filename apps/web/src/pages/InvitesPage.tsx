import React, { useEffect, useState } from "react";
import { apiFetch, cachedGet } from "../lib/api";

export function InvitesPage() {
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [maxUses, setMaxUses] = useState("");
  const [days, setDays] = useState("7");
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    try {
      const res = await cachedGet<{ invites: any[] }>("/teams/invites");
      setInvites(res.invites);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function create() {
    setCreating(true);
    try {
      const body: any = { expiresInDays: Number(days) };
      if (maxUses) body.maxUses = Number(maxUses);
      await apiFetch("/teams/invites", { method: "POST", body: JSON.stringify(body) });
      await load();
      setMaxUses("");
      setDays("7");
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(code: string) {
    if (!confirm(`Revogar o convite ${code}?`)) return;
    await apiFetch(`/teams/invites/${code}`, { method: "DELETE" });
    setInvites((inv) => inv.filter((i) => i.code !== code));
  }

  function copy(code: string) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  function daysLeft(expiresAt: string) {
    const diff = new Date(expiresAt).getTime() - Date.now();
    const d = Math.ceil(diff / 86400000);
    return d <= 1 ? "expira hoje" : `${d} dias restantes`;
  }

  return (
    <>
      <div className="topbar">
        <div className="page-title">Convites</div>
        <div className="page-subtitle">Gere códigos para adicionar membros ao time</div>
      </div>

      <div className="content">
        <div className="grid-2" style={{ marginBottom: 20 }}>
          {/* Create form */}
          <div className="card">
            <div className="card-title">Novo convite</div>
            <div className="form-group">
              <label className="form-label">Validade (dias)</label>
              <input
                className="form-input"
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Limite de usos (opcional)</label>
              <input
                className="form-input"
                type="number"
                min={1}
                placeholder="Sem limite"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" onClick={create} disabled={creating} style={{ width: "100%", justifyContent: "center" }}>
              {creating ? "Gerando..." : "⊕ Gerar convite"}
            </button>
          </div>

          {/* Instructions */}
          <div className="card">
            <div className="card-title">Como usar</div>
            <ol style={{ paddingLeft: 18, fontSize: 13, color: "var(--text-secondary)", lineHeight: 2 }}>
              <li>Gere um código de convite ao lado</li>
              <li>Copie e envie para o seu BDR</li>
              <li>Ele usa na tela de cadastro da extensão ou em <code style={{ color: "var(--green)", fontSize: 12 }}>/auth/register</code></li>
              <li>Entra automaticamente no seu time</li>
            </ol>
            <div className="sep" />
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Convites expirados são removidos automaticamente da listagem.
            </div>
          </div>
        </div>

        {/* Active invites */}
        <div className="card">
          <div className="card-title">Convites ativos ({invites.length})</div>
          {loading ? (
            <div className="loading">Carregando...</div>
          ) : invites.length === 0 ? (
            <div className="empty">Nenhum convite ativo. Gere um ao lado.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Usos</th>
                    <th>Validade</th>
                    <th>Criado em</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <span className="code-chip">{inv.code}</span>
                      </td>
                      <td>
                        {inv.uses}{inv.maxUses ? `/${inv.maxUses}` : ""}
                        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
                          {inv.maxUses ? `(${inv.maxUses - inv.uses} restantes)` : "(sem limite)"}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: "var(--yellow)" }}>{daysLeft(inv.expiresAt)}</span>
                      </td>
                      <td>{new Date(inv.createdAt).toLocaleDateString("pt-BR")}</td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => copy(inv.code)}
                          >
                            {copied === inv.code ? "✓ Copiado" : "Copiar"}
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => revoke(inv.code)}
                          >
                            Revogar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
