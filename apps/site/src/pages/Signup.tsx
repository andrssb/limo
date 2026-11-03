import React, { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";

const API = "https://api.limoapp.com.br/v1";
const APP_URL = "https://app.limoapp.com.br";

export default function Signup() {
  const [params] = useSearchParams();
  const [plan, setPlan] = useState<"start" | "metrics" | "business">(() => {
    const p = params.get("plano");
    if (p === "metrics")  return "metrics";
    if (p === "business") return "business";
    return "start";
  });
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const p = params.get("plano");
    if (p === "metrics")  setPlan("metrics");
    if (p === "business") setPlan("business");
    if (p === "start")    setPlan("start");
  }, [params]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setError("Preencha todos os campos.");
      return;
    }
    if (form.password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          role: plan === "metrics" ? "manager" : "sdr",
          plan,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Erro ao criar conta. Tente novamente.");
        return;
      }

      // Store token and redirect to app
      if (data.tokens?.accessToken) {
        localStorage.setItem("limo_token", data.tokens.accessToken);
        if (data.user) localStorage.setItem("limo_user", JSON.stringify(data.user));
      }

      setSuccess(true);
      setTimeout(() => { window.location.href = APP_URL; }, 2500);
    } catch {
      setError("Erro de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="signup-page">
      <div className="signup-card">
        <Link to="/" style={{ display: "inline-block", marginBottom: 24 }}>
          <div className="signup-logo">
            <img src="/logo.png" alt="Limo" style={{ width: 160, height: 72, objectFit: "contain" }} />
          </div>
        </Link>

        {success ? (
          <div className="form-success">
            <div className="form-success-icon">
              <CheckCircle2 size={28} strokeWidth={2} />
            </div>
            <h3>Conta criada com sucesso!</h3>
            <p>Redirecionando para o painel...</p>
          </div>
        ) : (
          <>
            <p className="signup-subtitle">
              7 dias grátis · Sem cartão de crédito
            </p>

            <div className="signup-plan-selector">
              {[
                { key: "start",    label: "Start" },
                { key: "metrics",  label: "Metrics" },
                { key: "business", label: "Business" },
              ].map((p) => (
                <div
                  key={p.key}
                  className={`plan-option ${plan === p.key ? "selected" : ""}`}
                  onClick={() => setPlan(p.key as "start" | "metrics" | "business")}
                >
                  <div className="plan-option-name">Plano {p.label}</div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", marginTop: -10, marginBottom: 20 }}>
              Valores e detalhes apresentados após o teste grátis.
            </p>

            {error && <div className="form-error">{error}</div>}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Nome completo</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Seu nome"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">E-mail</label>
                <input
                  className="form-input"
                  type="email"
                  placeholder="voce@empresa.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Senha</label>
                <input
                  className="form-input"
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
              </div>

              <button type="submit" className="btn-primary form-submit" disabled={loading}>
                {loading ? "Criando conta..." : "Criar conta e começar →"}
              </button>
            </form>

            <p className="form-terms">
              Ao criar uma conta você concorda com nossos{" "}
              <a href="/termos">Termos de Uso</a> e{" "}
              <a href="/privacidade">Política de Privacidade</a>.
            </p>
            <p className="form-login-link">
              Já tem conta? <a href={APP_URL}>Entrar no painel</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
