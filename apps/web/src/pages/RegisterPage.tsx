import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiFetch, setToken, setStoredUser } from "../lib/api";
import {
  Users, UserCircle, ArrowLeft, Mail, Calendar,
  Search, Phone, Compass, BookOpen, Target, Sparkles,
} from "lucide-react";

// Mini-typeform de cadastro. Passos:
//   basics → access ─┬─ individual → feature → account → /dashboard
//                    └─ team → (detecta time por domínio)
//                              ├─ tem Limo  → ask-invite
//                              └─ sem Limo  → demo (perguntas) → Calendly
type Step =
  | "basics" | "access"
  | "feature" | "account"
  | "team-check" | "team-message" | "team-demo";

const FEATURES = [
  { id: "garimpo",   label: "Garimpo IA",            desc: "Encontrar leads e decisores",     icon: Search },
  { id: "coaching",  label: "Coaching de ligações",  desc: "IA analisa minhas calls",         icon: Phone },
  { id: "descobrir", label: "Descobrir empresas",    desc: "Prospectar por perfil ideal",     icon: Compass },
  { id: "discurso",  label: "Discurso de vendas",    desc: "Playbook e materiais",            icon: BookOpen },
  { id: "metas",     label: "Metas do time",         desc: "Gestão e acompanhamento",         icon: Target },
];

const cardBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 16,
  padding: "18px 20px", borderRadius: 12,
  border: "1px solid var(--border)", background: "var(--bg-surface)",
  cursor: "pointer", textAlign: "left", width: "100%",
  transition: "border-color 0.15s, background 0.15s",
};
function hoverOn(e: React.MouseEvent) {
  (e.currentTarget as HTMLElement).style.borderColor = "var(--green)";
  (e.currentTarget as HTMLElement).style.background = "var(--green-bg)";
}
function hoverOff(e: React.MouseEvent) {
  (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
  (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)";
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("basics");

  // Campos comuns (passo "basics")
  const [fullName, setFullName] = useState("");
  const [company, setCompany]   = useState("");
  const [website, setWebsite]   = useState("");
  const [email, setEmail]       = useState("");
  const [phone, setPhone]       = useState("");

  // Individual
  const [topFeature, setTopFeature] = useState("");
  const [password, setPassword]     = useState("");

  // Time sem Limo (demo)
  const [peopleCount, setPeopleCount] = useState("");
  const [peopleRoles, setPeopleRoles] = useState("");
  const [buyerRole, setBuyerRole]     = useState("");

  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  // Salva o lead do typeform (best-effort — não bloqueia o fluxo).
  async function saveSurvey(extra: Record<string, unknown>): Promise<{ calendlyUrl?: string } | null> {
    try {
      return await apiFetch("/signup/survey", {
        method: "POST",
        body: JSON.stringify({
          fullName, company, website, email, phone,
          ...extra,
        }),
      });
    } catch {
      return null;
    }
  }

  function goBasicsNext(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStep("access");
  }

  // Time: detecta se já existe Limo no domínio do email.
  async function chooseTeam() {
    setError("");
    setStep("team-check");
    try {
      const { hasTeam } = await apiFetch<{ hasTeam: boolean }>("/auth/check-team", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      if (hasTeam) {
        saveSurvey({ accessType: "team", teamHasLimo: true, outcome: "ask_invite" });
        setStep("team-message");
      } else {
        setStep("team-demo");
      }
    } catch (err) {
      // Se a checagem falhar, segue pro fluxo de demo (não trava o cadastro).
      setStep("team-demo");
    }
  }

  // Individual: cria a conta de fato.
  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      saveSurvey({ accessType: "individual", topFeature, outcome: "account" });
      const res = await apiFetch<{ user: any; tokens: { accessToken: string; refreshToken: string } }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name:     fullName.trim(),
          email,
          password,
          role:     "manager",
          teamName: company.trim() || fullName.trim(),
        }),
      });
      setToken(res.tokens.accessToken, res.tokens.refreshToken);
      setStoredUser(res.user);
      // Se o cadastro foi aberto PELA extensão (?ext=<id>), devolve a sessão pra
      // ela logar sozinha — a pessoa não precisa voltar e digitar login de novo.
      handoffToExtension(res);
      navigate("/dashboard");
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  // Envia os tokens de volta pra extensão que abriu este cadastro. Best-effort:
  // se não veio da extensão, ou ela não está instalada, apenas ignora.
  function handoffToExtension(res: { user: any; tokens: { accessToken: string; refreshToken: string } }) {
    try {
      const extId = new URLSearchParams(window.location.search).get("ext");
      const runtime = (window as any).chrome?.runtime;
      if (!extId || !runtime?.sendMessage) return;
      runtime.sendMessage(
        extId,
        {
          type: "LIMO_AUTH_HANDOFF",
          accessToken:  res.tokens.accessToken,
          refreshToken: res.tokens.refreshToken,
          user:         res.user,
        },
        // callback consome runtime.lastError (extensão ausente = sem warning no console)
        () => void runtime.lastError,
      );
    } catch {
      /* sem extensão/handoff — fluxo web segue normal */
    }
  }

  // Time sem Limo: salva lead e manda pro Calendly.
  async function handleDemo(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await saveSurvey({
      accessType:  "team",
      teamHasLimo: false,
      peopleCount: peopleCount || undefined,
      peopleRoles,
      buyerRole,
      outcome:     "demo",
    });
    const base = res?.calendlyUrl ?? "https://calendly.com/limo/demo";
    const url  = `${base}?name=${encodeURIComponent(fullName)}&email=${encodeURIComponent(email)}`;
    window.location.href = url;
  }

  return (
    <div className="login-page">
      <div className="login-box signup-typeform">
        <div className="login-logo">
          <img src="/logo_oficial.png" alt="Limo" className="login-logo-img" />
        </div>

        {/* ─── Passo 1: dados básicos ─────────────────────────────────────── */}
        {step === "basics" && (
          <>
            <Header title="Nos conte sobre você." subtitle="Leva menos de um minuto pra começar" />
            <form onSubmit={goBasicsNext}>
              <Field label="Nome completo *">
                <input className="form-input" value={fullName} autoFocus required
                  onChange={(e) => setFullName(e.target.value)} placeholder="Seu nome completo" />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <Field label="Empresa">
                  <input className="form-input" value={company}
                    onChange={(e) => setCompany(e.target.value)} placeholder="Onde trabalha" />
                </Field>
                <Field label="Site da empresa">
                  <input className="form-input" value={website}
                    onChange={(e) => setWebsite(e.target.value)} placeholder="empresa.com.br" />
                </Field>
              </div>
              <Field label="E-mail *">
                <input className="form-input" type="email" value={email} required
                  onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" />
              </Field>
              <Field label="Telefone">
                <input className="form-input" value={phone}
                  onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" />
              </Field>
              <button className="btn btn-primary" type="submit"
                style={{ width: "100%", justifyContent: "center", marginTop: 14 }}>
                Continuar
              </button>
            </form>
            <LoginHint />
          </>
        )}

        {/* ─── Passo 2: tipo de acesso ────────────────────────────────────── */}
        {step === "access" && (
          <>
            <BackBtn onClick={() => setStep("basics")} />
            <Header title="Como você vai usar o Limo?" subtitle="Escolha a opção que melhor descreve seu caso" />
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <button type="button" style={cardBtn} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                onClick={() => setStep("feature")}>
                <UserCircle size={28} style={{ color: "var(--green)", flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>Acesso individual</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Vou usar o Limo sozinho</div>
                </div>
              </button>
              <button type="button" style={cardBtn} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                onClick={chooseTeam}>
                <Users size={28} style={{ color: "var(--green)", flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>Faço parte de um time</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Outras pessoas da empresa vão usar</div>
                </div>
              </button>
            </div>
            <LoginHint />
          </>
        )}

        {/* ─── Individual: funcionalidade mais buscada ────────────────────── */}
        {step === "feature" && (
          <>
            <BackBtn onClick={() => setStep("access")} />
            <Header title="O que mais te interessa?" subtitle="A funcionalidade que você mais quer usar" />
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <button key={f.id} type="button" style={cardBtn} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                    onClick={() => { setTopFeature(f.id); setStep("account"); }}>
                    <Icon size={24} style={{ color: "var(--green)", flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>{f.label}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{f.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ─── Individual: senha e criação de conta ───────────────────────── */}
        {step === "account" && (
          <>
            <BackBtn onClick={() => { setStep("feature"); setError(""); }} />
            <Header title="Crie sua senha" subtitle="Último passo pra entrar no Limo" />
            <form onSubmit={handleCreateAccount}>
              <Field label="Senha *">
                <input className="form-input" type="password" value={password} autoFocus required minLength={8}
                  onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
              </Field>
              {error && <p className="error-msg">{error}</p>}
              <button className="btn btn-primary" type="submit" disabled={loading}
                style={{ width: "100%", justifyContent: "center", marginTop: 14 }}>
                {loading ? "Criando conta..." : "Criar conta"}
              </button>
            </form>
          </>
        )}

        {/* ─── Time: checando domínio ─────────────────────────────────────── */}
        {step === "team-check" && (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <Sparkles size={32} style={{ color: "var(--green)", marginBottom: 14 }} />
            <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>Verificando seu time...</div>
          </div>
        )}

        {/* ─── Time COM Limo: pedir convite ───────────────────────────────── */}
        {step === "team-message" && (
          <div style={{ textAlign: "center" }}>
            <Mail size={40} style={{ marginBottom: 16, color: "var(--green)" }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
              Seu time já usa o Limo!
            </div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 24 }}>
              Peça ao seu <strong>gestor</strong> que te envie um <strong>link de convite</strong>.
              <br />
              Com ele você cria sua conta e entra direto no time.
            </p>
            <BackBtn onClick={() => setStep("access")} inline />
          </div>
        )}

        {/* ─── Time SEM Limo: qualificação → demo ─────────────────────────── */}
        {step === "team-demo" && (
          <>
            <BackBtn onClick={() => setStep("access")} />
            <Header title="Vamos montar uma demo" subtitle="Mais alguns detalhes pra preparar a conversa" />
            <form onSubmit={handleDemo}>
              <Field label="Quantas pessoas vão usar o Limo? *">
                <input className="form-input" type="number" min={1} value={peopleCount} required autoFocus
                  onChange={(e) => setPeopleCount(e.target.value)} placeholder="Ex: 5" />
              </Field>
              <Field label="Quais os cargos dessas pessoas? *">
                <input className="form-input" value={peopleRoles} required
                  onChange={(e) => setPeopleRoles(e.target.value)} placeholder="Ex: BDRs, Closers" />
              </Field>
              <Field label="Qual o seu cargo? *">
                <input className="form-input" value={buyerRole} required
                  onChange={(e) => setBuyerRole(e.target.value)} placeholder="Ex: Head de Vendas" />
              </Field>
              {error && <p className="error-msg">{error}</p>}
              <button className="btn btn-primary" type="submit" disabled={loading}
                style={{ width: "100%", justifyContent: "center", marginTop: 14, display: "flex", gap: 8 }}>
                <Calendar size={16} /> {loading ? "Abrindo agenda..." : "Agendar demo"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sub-componentes de UI ──────────────────────────────────────────────────
function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 30 }}>
      <div style={{ fontSize: 19, fontWeight: 800, color: "var(--text-primary)", marginBottom: 8, lineHeight: 1.3 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>{subtitle}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}

function BackBtn({ onClick, inline }: { onClick: () => void; inline?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: "none", border: "none", color: "var(--text-muted)",
        fontSize: 13, cursor: "pointer", padding: 0, fontFamily: "inherit",
        marginBottom: inline ? 0 : 18,
      }}>
      <ArrowLeft size={14} /> Voltar
    </button>
  );
}

function LoginHint() {
  return (
    <p style={{ textAlign: "center", marginTop: 22, fontSize: 13, color: "var(--text-muted)" }}>
      Já tem conta? <Link to="/login" style={{ color: "var(--green)" }}>Entrar</Link>
    </p>
  );
}
