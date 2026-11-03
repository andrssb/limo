import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { apiFetch, getStoredUser, clearToken } from "../lib/api";
import { LogOut, Clock, Loader2, Gem, CalendarDays } from "lucide-react";
import { PlanContent } from "./PlanPage";

const CRM_PROVIDERS = [
  { key: "hubspot",    name: "HubSpot",    Logo: HubSpotLogo,    description: "CRM, deals e engajamento" },
  { key: "pipedrive",  name: "Pipedrive",  Logo: PipedriveLogo,  description: "Pipeline de vendas" },
  { key: "salesforce", name: "Salesforce", Logo: SalesforceLogo, description: "CRM enterprise" },
] as const;

type CrmKey = "hubspot" | "pipedrive" | "salesforce";

// ─── CRM Brand Logos ──────────────────────────────────────────────────────────

function HubSpotLogo() {
  return (
    <svg width="36" height="36" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Central hub circle */}
      <circle cx="30" cy="30" r="8" fill="#FF7A59"/>
      {/* Top spoke */}
      <rect x="27" y="15" width="6" height="15" rx="3" fill="#FF7A59"/>
      <circle cx="30" cy="11" r="6" fill="#FF7A59"/>
      {/* Bottom-right spoke (120°) */}
      <g transform="rotate(120 30 30)">
        <rect x="27" y="15" width="6" height="15" rx="3" fill="#FF7A59"/>
        <circle cx="30" cy="11" r="6" fill="#FF7A59"/>
      </g>
      {/* Bottom-left spoke (240°) */}
      <g transform="rotate(240 30 30)">
        <rect x="27" y="15" width="6" height="15" rx="3" fill="#FF7A59"/>
        <circle cx="30" cy="11" r="6" fill="#FF7A59"/>
      </g>
    </svg>
  );
}

function PipedriveLogo() {
  return (
    <svg width="36" height="36" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="60" height="60" rx="12" fill="#1F3D1F"/>
      {/* Stylised pipeline "Pd" mark */}
      <circle cx="24" cy="24" r="9" fill="#4DBC15"/>
      <rect x="21" y="24" width="6" height="14" rx="3" fill="#4DBC15"/>
      <rect x="32" y="15" width="6" height="30" rx="3" fill="#4DBC15"/>
    </svg>
  );
}

function SalesforceLogo() {
  return (
    <svg width="36" height="36" viewBox="0 0 80 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Salesforce cloud shape */}
      <path
        d="M33 48C21.9 48 13 39.1 13 28 13 19.7 18.1 12.5 25.5 9.6 27.8 5.2 32.5 2 38 2c5.2 0 9.7 2.8 12.2 7 1.2-.4 2.4-.6 3.8-.6 7.2 0 13 5.8 13 13 0 .6 0 1.2-.1 1.8C69.8 24.9 72 28.4 72 32.5 72 41 65 48 56.5 48H33z"
        fill="#00A1E0"
      />
    </svg>
  );
}

export function SettingsPage() {
  const user = getStoredUser();
  const isManager = user?.role === "manager" || user?.role === "admin";

  return (
    <>
      <div className="topbar">
        <div className="page-title">Configurações</div>
        <div className="page-subtitle">Integrações e preferências da conta</div>
      </div>

      <div className="content" style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 20 }}>
        <WhatsAppSection />
        {isManager && <CalendarSection />}
        <CRMSection />
        {isManager && <AssertivaSection />}
        {isManager && <VoipSection />}
        {isManager && (
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <Gem size={16} /> Seu Plano
            </div>
            <PlanContent />
          </div>
        )}
        <ProfileSection user={user} />
      </div>
    </>
  );
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

type CalendarStatus = {
  connected: boolean;
  oauthConfigured: boolean;
  connection: {
    accountEmail: string;
    calendarId: string;
    expiresAt: string;
    updatedAt: string;
  } | null;
};

function CalendarSection() {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      setStatus(await apiFetch<CalendarStatus>("/voice-sdr/calendar/status"));
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("calendar");
    if (result) {
      const messages: Record<string, string> = {
        connected: "Google Calendar conectado com sucesso.",
        denied: "A autorização do Google Calendar foi cancelada.",
        wrong_account: "Use a conta Google indicada para a agenda do Limo.",
        invalid_state: "A autorização expirou. Tente conectar novamente.",
        missing_refresh_token: "O Google não liberou acesso permanente. Tente conectar novamente.",
        error: "Não foi possível concluir a conexão com o Google Calendar.",
      };
      setNotice(messages[result] ?? "A conexão com o Google Calendar foi atualizada.");
      const url = new URL(window.location.href);
      url.searchParams.delete("calendar");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    load();
  }, []);

  async function connect() {
    setConnecting(true);
    setNotice(null);
    try {
      const result = await apiFetch<{ url: string; expectedAccount: string }>("/voice-sdr/calendar/google/auth-url");
      const popup = window.open(result.url, "limo_google_calendar", "width=620,height=760,left=220,top=80");
      if (!popup) {
        window.location.assign(result.url);
        return;
      }

      const timer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(timer);
          setConnecting(false);
          load();
          return;
        }
        try {
          if (popup.location.origin === window.location.origin && popup.location.pathname === "/settings") {
            const resultCode = new URLSearchParams(popup.location.search).get("calendar");
            popup.close();
            window.clearInterval(timer);
            setNotice(resultCode === "connected"
              ? "Google Calendar conectado com sucesso."
              : "A conexão não foi concluída. Tente novamente.");
            setConnecting(false);
            load();
          }
        } catch {
          // Enquanto o popup estiver no Google, o navegador bloqueia a leitura da URL.
        }
      }, 700);
    } catch (error) {
      setNotice((error as Error).message);
      setConnecting(false);
    }
  }

  if (loading) return null;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <CalendarDays size={28} color="var(--green)" />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Agenda das reuniões</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              O Luís consulta horários livres, cria o Google Meet e envia o convite ao lead.
            </div>
          </div>
        </div>
        <StatusDot status={status?.connected ? "connected" : "disconnected"} />
      </div>

      {status?.connected && status.connection ? (
        <div style={{ background: "var(--bg-surface)", borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ fontSize: 13, color: "var(--green)", fontWeight: 600, marginBottom: 4 }}>
            ✓ {status.connection.accountEmail}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Agenda pronta para confirmar reuniões automaticamente
          </div>
        </div>
      ) : (
        <div>
          <button className="btn btn-primary" onClick={connect} disabled={connecting || !status?.oauthConfigured}>
            {connecting ? "Aguardando autorização..." : "Conectar Google Calendar"}
          </button>
          {!status?.oauthConfigured && (
            <div style={{ fontSize: 11, color: "var(--yellow)", marginTop: 8 }}>
              A credencial Google do Limo ainda precisa ser configurada no servidor.
            </div>
          )}
        </div>
      )}

      {notice && (
        <div style={{ fontSize: 12, color: notice.includes("sucesso") ? "var(--green)" : "var(--yellow)", marginTop: 10 }}>
          {notice}
        </div>
      )}
    </div>
  );
}

function WhatsAppSection() {
  const [status, setStatus]       = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [phone, setPhone]         = useState<string | null>(null);
  const [connectedAt, setConn]    = useState<string | null>(null);
  const [qr, setQr]               = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [connecting, setConn2]    = useState(false);
  const pollRef                   = useRef<ReturnType<typeof setInterval>>();

  async function fetchStatus() {
    try {
      const res = await apiFetch<{ status: string; phoneNumber: string | null; connectedAt: string | null }>("/whatsapp/status");
      setStatus(res.status as any);
      setPhone(res.phoneNumber);
      setConn(res.connectedAt);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function pollQR() {
    try {
      const res = await apiFetch<{ qr: string | null; status: string }>("/whatsapp/qr");
      if (res.qr) {
        setQr(res.qr);
        setStatus("connecting");
      } else if (res.status === "connected") {
        clearInterval(pollRef.current);
        setQr(null);
        fetchStatus();
      } else if (res.status === "disconnected") {
        clearInterval(pollRef.current);
        setQr(null);
        setStatus("disconnected");
        setConn2(false);
      }
    } catch { /* ignore */ }
  }

  async function connect() {
    setConn2(true);
    setQr(null);
    try {
      await apiFetch("/whatsapp/connect", { method: "POST", body: JSON.stringify({}) });
      setStatus("connecting");
      pollRef.current = setInterval(pollQR, 3000);
      setTimeout(pollQR, 500);
    } catch (err) {
      alert((err as Error).message);
      setConn2(false);
    }
  }

  async function disconnect() {
    clearInterval(pollRef.current);
    await apiFetch("/whatsapp/disconnect", { method: "DELETE" });
    setStatus("disconnected");
    setPhone(null);
    setQr(null);
  }

  useEffect(() => {
    fetchStatus();
    return () => clearInterval(pollRef.current);
  }, []);

  if (loading) return null;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>WhatsApp</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Receba e transcreva mensagens de voz de contatos automaticamente
          </div>
        </div>
        <StatusDot status={status} />
      </div>

      {status === "connected" && phone && (
        <div style={{ background: "var(--bg-surface)", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: "var(--green)", fontWeight: 600, marginBottom: 4 }}>
            ✓ Conectado — {phone}
          </div>
          {connectedAt && (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Desde {new Date(connectedAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>
      )}

      {status === "connecting" && (
        <div style={{ marginBottom: 14 }}>
          {qr ? (
            <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
              <div style={{ background: "#fff", padding: 12, borderRadius: 10, display: "inline-block" }}>
                <QRCodeSVG value={qr} size={180} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>
                  Escaneie o QR Code
                </div>
                <ol style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 2, paddingLeft: 18, margin: 0 }}>
                  <li>Abra o WhatsApp no seu celular</li>
                  <li>Vá em <strong>Aparelhos conectados</strong></li>
                  <li>Toque em <strong>Conectar um aparelho</strong></li>
                  <li>Aponte a câmera para este QR Code</li>
                </ol>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10 }}>
                  <Clock size={11} style={{ verticalAlign: "middle" }} /> O código expira em 60 segundos — se expirar, clique em Reconectar
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--yellow)" }}><Loader2 size={12} className="spin" style={{ verticalAlign: "middle" }} /> Aguardando QR Code...</div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        {status !== "connected" && (
          <button
            className="btn btn-primary"
            onClick={connect}
            disabled={connecting}
          >
            {status === "connecting" ? "Reconectar" : "Conectar WhatsApp"}
          </button>
        )}
        {status !== "disconnected" && (
          <button className="btn btn-danger btn-sm" onClick={disconnect}>
            Desconectar
          </button>
        )}
      </div>
    </div>
  );
}

// ─── CRM ──────────────────────────────────────────────────────────────────────

function CRMSection() {
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [connecting, setConnecting]   = useState<string | null>(null);

  async function load() {
    try {
      const res = await apiFetch<{ connections: any[] }>("/crm/connections");
      setConnections(res.connections);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function connectCRM(provider: CrmKey) {
    setConnecting(provider);
    try {
      const res = await apiFetch<{ url: string }>(`/crm/${provider}/auth-url`);
      // Open OAuth in a popup — callback page will close it and reload this page
      const popup = window.open(res.url, "limo_oauth", "width=600,height=700,left=200,top=100");
      const timer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(timer);
          load();
          setConnecting(null);
        }
      }, 500);
    } catch (err) {
      alert(`Não foi possível iniciar a conexão com ${provider}. Verifique se as chaves de API estão configuradas no .env.`);
      setConnecting(null);
    }
  }

  async function disconnectCRM(provider: string) {
    await apiFetch(`/crm/${provider}`, { method: "DELETE" });
    load();
  }

  if (loading) return null;

  return (
    <div className="card">
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>CRM</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        Sincronize contatos e registre ligações automaticamente no seu CRM
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {CRM_PROVIDERS.map(({ key, name, Logo, description }) => {
          const conn = connections.find((c) => c.provider === key);
          return (
            <div key={key} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 12, background: "var(--bg-surface)", borderRadius: 10, padding: "12px 16px",
              border: `1px solid ${conn ? "rgba(163,230,53,0.2)" : "var(--border)"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Logo />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{description}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {conn ? (
                  <>
                    <span style={{ fontSize: 11, color: "var(--green)" }}>✓ Conectado</span>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => disconnectCRM(key)}
                    >
                      Desconectar
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => connectCRM(key)}
                    disabled={connecting === key}
                  >
                    {connecting === key ? "Abrindo..." : "Conectar"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14, padding: "10px 14px", background: "var(--bg-surface)", borderRadius: 8, fontSize: 12, color: "var(--text-muted)", borderLeft: "3px solid var(--border-light)" }}>
        Para ativar um CRM, configure as chaves de API no arquivo <code style={{ color: "var(--green)", fontSize: 11 }}>.env</code>:
        {" "}<code style={{ color: "var(--text-secondary)", fontSize: 11 }}>HUBSPOT_CLIENT_ID</code>,
        {" "}<code style={{ color: "var(--text-secondary)", fontSize: 11 }}>PIPEDRIVE_CLIENT_ID</code> etc.
      </div>
    </div>
  );
}

// ─── Assertiva (enriquecimento pago) ────────────────────────────────────────

function AssertivaSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving]   = useState(false);
  const [usage, setUsage]     = useState<any>(null);

  useEffect(() => {
    apiFetch<{ enabled: boolean }>("/admin/assertiva/setting").then((r) => setEnabled(r.enabled)).catch(() => setEnabled(true));
    // Consumo do mês — só o dono (owner) tem acesso; ignora 403 silenciosamente.
    apiFetch<any>("/admin/assertiva/usage").then(setUsage).catch(() => {});
  }, []);

  async function toggle() {
    if (enabled === null) return;
    const next = !enabled;
    setSaving(true);
    setEnabled(next);
    try {
      await apiFetch("/admin/assertiva/setting", { method: "PUT", body: JSON.stringify({ enabled: next }) });
    } catch {
      setEnabled(!next); // reverte em erro
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Pool de enriquecimento</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        Quando ligado, o Garimpo busca o telefone/e-mail real da pessoa (consome o pool pago). Desligue em testes; ligue para demos e clientes.
      </div>

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "var(--bg-surface)", borderRadius: 10, padding: "12px 16px",
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {enabled === null ? "Carregando..." : enabled ? "Ligado" : "Desligado"}
        </div>
        <button
          onClick={toggle}
          disabled={saving || enabled === null}
          aria-label="Ligar/desligar enriquecimento"
          style={{
            width: 46, height: 26, borderRadius: 13, border: "none", cursor: "pointer", position: "relative",
            background: enabled ? "var(--green)" : "var(--border)", transition: "background .15s",
          }}
        >
          <span style={{
            position: "absolute", top: 3, left: enabled ? 23 : 3, width: 20, height: 20,
            borderRadius: "50%", background: "#fff", transition: "left .15s",
          }} />
        </button>
      </div>

      {usage && (
        <div style={{ marginTop: 14, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
            Consumo do mês (estimado)
          </div>
          <div><strong>{usage.queries}</strong> consultas · <strong>{usage.matchedQueries}</strong> com retorno</div>
          <div>Custo estimado: <strong>R$ {Number(usage.estCostBrl).toFixed(2).replace(".", ",")}</strong> de R$ {Number(usage.poolBrl).toFixed(2).replace(".", ",")} ({usage.pctUsed}% do pool)</div>
          <div style={{ color: "var(--text-muted)" }}>Restam ~{usage.remainingQueries} consultas no pool · R$ {Number(usage.costPerQueryBrl).toFixed(2).replace(".", ",")}/consulta</div>
        </div>
      )}
    </div>
  );
}

// ─── Integração VoIP (webhook) ──────────────────────────────────────────────

function VoipSection() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState("");

  const WEBHOOK_URL = "https://api.limoapp.com.br/v1/voip/ingest";

  useEffect(() => {
    apiFetch<{ apiKey: string | null }>("/voip/api-key")
      .then((r) => setApiKey(r.apiKey))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function generate() {
    setGenerating(true);
    try {
      const r = await apiFetch<{ apiKey: string }>("/voip/api-key", { method: "POST", body: "{}" });
      setApiKey(r.apiKey);
    } catch { /* ignore */ }
    finally { setGenerating(false); }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => { setCopied(label); setTimeout(() => setCopied(""), 1500); });
  }

  if (loading) return null;

  return (
    <div className="card">
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Integração de VoIP (gravações de chamadas)</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.5 }}>
        Receba as gravações do seu discador/VoIP para transcrição, score e coaching automáticos. Funciona com qualquer provedor que envie a gravação via webhook — basta usar a URL e a chave abaixo.
      </div>

      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>URL do webhook (POST)</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-surface)", borderRadius: 8, padding: "8px 12px", marginBottom: 14 }}>
        <code style={{ fontSize: 12, color: "var(--text)", flex: 1, wordBreak: "break-all" }}>{WEBHOOK_URL}</code>
        <button className="btn btn-ghost btn-sm" onClick={() => copy(WEBHOOK_URL, "url")}>{copied === "url" ? "✓" : "Copiar"}</button>
      </div>

      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Chave de API (header <code>x-limo-voip-key</code>)</div>
      {apiKey ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-surface)", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
          <code style={{ fontSize: 12, color: "var(--text)", flex: 1, wordBreak: "break-all" }}>{apiKey}</code>
          <button className="btn btn-ghost btn-sm" onClick={() => copy(apiKey, "key")}>{copied === "key" ? "✓" : "Copiar"}</button>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>Nenhuma chave gerada ainda.</div>
      )}

      <button className="btn btn-secondary btn-sm" onClick={generate} disabled={generating}>
        {generating ? "Gerando..." : apiKey ? "Gerar nova chave (rotacionar)" : "Gerar chave de API"}
      </button>
      {apiKey && (
        <div style={{ fontSize: 11, color: "var(--yellow)", marginTop: 8 }}>
          Rotacionar invalida a chave atual — atualize no provedor depois de gerar uma nova.
        </div>
      )}
    </div>
  );
}

// ─── Profile ──────────────────────────────────────────────────────────────────

function ProfileSection({ user }: { user: any }) {
  const navigate = useNavigate();
  if (!user) return null;

  function logout() {
    clearToken();
    navigate("/login");
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Perfil</div>
        <button
          className="btn btn-danger btn-sm"
          onClick={logout}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <LogOut size={13} /> Sair da conta
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div className="form-label">Nome</div>
          <div style={{ fontSize: 14, color: "var(--text)", padding: "8px 0" }}>{user.name}</div>
        </div>
        <div>
          <div className="form-label">E-mail</div>
          <div style={{ fontSize: 14, color: "var(--text)", padding: "8px 0" }}>{user.email}</div>
        </div>
        <div>
          <div className="form-label">Papel</div>
          <span className={`badge ${user.role === "manager" ? "badge-green" : "badge-gray"}`}>
            {user.role}
          </span>
        </div>
        <div>
          <div className="form-label">Conta criada em</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", padding: "8px 0" }}>
            {new Date(user.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color =
    status === "connected"  ? "var(--green)"  :
    status === "connecting" ? "var(--yellow)" : "var(--text-muted)";
  const label =
    status === "connected"  ? "Conectado"    :
    status === "connecting" ? "Conectando..." : "Desconectado";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
      {label}
    </div>
  );
}
