import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, CheckCircle, Loader2 } from "lucide-react";
import { clearToken, apiFetch } from "../lib/api";

const PLANS = [
  {
    id: "start" as const,
    name: "Start",
    price: "R$ 297",
    period: "/mês",
    features: [
      "Até 100 contatos por lista",
      "Garimpo de decisores",
      "Extensão LinkedIn",
      "Coaching IA",
    ],
  },
  {
    id: "metrics" as const,
    name: "Metrics",
    price: "R$ 597",
    period: "/mês",
    highlight: true,
    features: [
      "Até 200 contatos por lista",
      "Tudo do Start",
      "Análise de ligações",
      "Relatórios avançados",
    ],
  },
  {
    id: "business" as const,
    name: "Business",
    price: "R$ 1.197",
    period: "/mês",
    features: [
      "Até 500 contatos por lista",
      "Tudo do Metrics",
      "Múltiplos times",
      "Suporte prioritário",
    ],
  },
];

export function TrialExpiredPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function checkout(planId: string) {
    setError("");
    setLoading(planId);
    try {
      const res = await apiFetch<{ url: string }>("/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: planId }),
      });
      window.location.href = res.url;
    } catch (err) {
      setError((err as Error).message ?? "Erro ao iniciar pagamento");
      setLoading(null);
    }
  }

  function logout() {
    clearToken();
    navigate("/login");
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px 16px",
    }}>
      {/* Logo */}
      <img src="/logo_oficial.png" alt="Limo" style={{ height: 36, marginBottom: 32 }} />

      {/* Lock card */}
      <div style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "32px 28px",
        textAlign: "center",
        maxWidth: 480,
        width: "100%",
        marginBottom: 32,
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: "50%",
          background: "rgba(239,68,68,0.1)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 20px",
        }}>
          <Lock size={28} style={{ color: "#ef4444" }} />
        </div>

        <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", marginBottom: 10 }}>
          O seu trial finalizou hoje.
        </div>
        <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Escolha um plano abaixo para continuar usando o Limo.
          O pagamento é processado de forma segura via Stripe.
        </div>
      </div>

      {/* Plans */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 16,
        width: "100%",
        maxWidth: 780,
        marginBottom: 24,
      }}>
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            style={{
              background: plan.highlight ? "var(--green)" : "var(--bg-card)",
              border: `1px solid ${plan.highlight ? "var(--green)" : "var(--border)"}`,
              borderRadius: 12,
              padding: "24px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{
              fontSize: 16, fontWeight: 800,
              color: plan.highlight ? "#000" : "var(--text-primary)",
            }}>
              {plan.name}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
              <span style={{
                fontSize: 26, fontWeight: 900,
                color: plan.highlight ? "#000" : "var(--text-primary)",
              }}>
                {plan.price}
              </span>
              <span style={{
                fontSize: 12,
                color: plan.highlight ? "#333" : "var(--text-muted)",
              }}>
                {plan.period}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {plan.features.map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle size={14} style={{ color: plan.highlight ? "#000" : "var(--green)", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: plan.highlight ? "#111" : "var(--text-secondary)" }}>{f}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => checkout(plan.id)}
              disabled={loading !== null}
              style={{
                marginTop: "auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "10px 0",
                background: plan.highlight ? "#000" : "var(--green)",
                color: plan.highlight ? "#fff" : "#000",
                border: "none",
                borderRadius: 8,
                cursor: loading !== null ? "not-allowed" : "pointer",
                fontWeight: 700,
                fontSize: 13,
                fontFamily: "inherit",
                opacity: loading !== null && loading !== plan.id ? 0.6 : 1,
              }}
            >
              {loading === plan.id ? <><Loader2 size={13} className="spin" /> Aguarde...</> : `Assinar ${plan.name}`}
            </button>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={logout}
        style={{
          background: "none", border: "none",
          color: "var(--text-muted)", fontSize: 13,
          cursor: "pointer", fontFamily: "inherit",
        }}
      >
        Sair da conta
      </button>
    </div>
  );
}
