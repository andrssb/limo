import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import {
  Gem, CheckCircle, Loader2, Sparkles, Package,
  CalendarClock, Zap, ShoppingCart,
} from "lucide-react";

// ─── Plan catalog (mirrors the Stripe products / TrialExpiredPage) ──────────────
const PLANS = [
  {
    id: "start" as const,
    name: "Start",
    price: "R$ 297",
    period: "/mês",
    personas: 220,
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
    personas: 500,
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
    personas: 600,
    features: [
      "Até 500 contatos por lista",
      "Tudo do Metrics",
      "Múltiplos times",
      "Suporte prioritário",
    ],
  },
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

const PLAN_LABEL: Record<string, string> = {
  trial: "Trial", start: "Start", metrics: "Metrics", business: "Business", tester: "Tester (interno)",
};

// Suggest the one-time pack that best fits the team's consumption rhythm.
function suggestPack(q: PersonaQuota) {
  const ratio = q.monthlyAllowance > 0 ? q.monthlyUsed / q.monthlyAllowance : 0;
  let size: number;
  let reason: string;

  if (q.totalAvailable <= 5) {
    size = 100;
    reason = "Você está quase sem mapeamentos disponíveis — um pacote maior evita parar a prospecção no meio do mês.";
  } else if (ratio >= 0.8) {
    size = 100;
    reason = "Seu ritmo de consumo é alto: já usou mais de 80% do plano. O pacote maior tem o melhor preço por persona.";
  } else if (ratio >= 0.5) {
    size = 90;
    reason = "Você já passou da metade do limite mensal. Este pacote dá fôlego com ótimo custo por persona.";
  } else if (ratio >= 0.25) {
    size = 80;
    reason = "Pelo seu ritmo, um reforço médio cobre bem os dias de pico sem sobrar saldo.";
  } else {
    size = 50;
    reason = "Para começar, um pacote leve já cobre um teste de prospecção mais intenso.";
  }

  return { pack: PERSONA_PACKS.find((p) => p.size === size)!, reason };
}

// Conteúdo reutilizável do plano — usado na página /plano e dentro de Configurações.
export function PlanContent() {
  const [quota, setQuota] = useState<PersonaQuota | null>(null);
  const [teamPlan, setTeamPlan] = useState<string>("trial");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [buyingSize, setBuyingSize] = useState<number | null>(null);
  const [showAllPacks, setShowAllPacks] = useState(false);

  useEffect(() => {
    apiFetch<{ team: any; personaQuota: PersonaQuota }>("/teams/mine")
      .then((res) => {
        setTeamPlan(res.team?.plan ?? "trial");
        setQuota(res.personaQuota);
      })
      .catch((e) => setError(e?.message ?? "Erro ao carregar o plano"))
      .finally(() => setLoading(false));
  }, []);

  async function upgrade(planId: string) {
    setError("");
    setCheckingOut(planId);
    try {
      const res = await apiFetch<{ url: string }>("/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: planId }),
      });
      window.location.href = res.url;
    } catch (e) {
      setError((e as Error).message ?? "Erro ao iniciar o pagamento");
      setCheckingOut(null);
    }
  }

  async function buyPack(size: number) {
    setError("");
    setBuyingSize(size);
    try {
      const res = await apiFetch<{ url: string }>("/billing/persona-pack/checkout", {
        method: "POST",
        body: JSON.stringify({ size }),
      });
      window.location.href = res.url;
    } catch (e) {
      setError((e as Error).message ?? "Erro ao iniciar o pagamento");
      setBuyingSize(null);
    }
  }

  if (loading) return <div className="loading" style={{ padding: 40 }}>Carregando...</div>;

  const isPaid = teamPlan !== "trial";
  const usagePct = quota && quota.monthlyAllowance > 0
    ? Math.min(100, Math.round((quota.monthlyUsed / quota.monthlyAllowance) * 100))
    : 0;
  const barColor = usagePct >= 90 ? "var(--red)" : usagePct >= 70 ? "var(--yellow)" : "var(--green)";
  const resetDate = quota?.periodEndsAt
    ? new Date(quota.periodEndsAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })
    : null;
  const suggestion = quota ? suggestPack(quota) : null;

  return (
      <div style={{ padding: "0 4px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 940 }}>
        {error && (
          <div className="card" style={{ padding: "10px 14px", color: "var(--red)", fontSize: 13 }}>{error}</div>
        )}

        {/* ── Plano atual + uso ─────────────────────────────────────────── */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Plano atual</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
                {PLAN_LABEL[teamPlan] ?? teamPlan}
                {!isPaid && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--yellow)", border: "1px solid var(--yellow)", borderRadius: 6, padding: "2px 8px" }}>
                    sem plano pago
                  </span>
                )}
              </div>
            </div>
            {resetDate && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
                <CalendarClock size={14} /> Renova em {resetDate}
              </div>
            )}
          </div>

          {quota && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: "var(--text-secondary)" }}>Mapeamentos de personas usados no período</span>
                <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>
                  {quota.monthlyUsed} / {quota.monthlyAllowance}
                </span>
              </div>
              <div style={{ height: 10, background: "var(--bg)", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
                <div style={{ width: `${usagePct}%`, height: "100%", background: barColor, transition: "width .3s" }} />
              </div>
              <div style={{ display: "flex", gap: 24, marginTop: 14, flexWrap: "wrap" }}>
                <Metric label="Restante no plano" value={quota.monthlyRemaining} />
                <Metric label="Saldo extra (pacotes)" value={quota.extraBalance} />
                <Metric label="Total disponível" value={quota.totalAvailable} accent />
              </div>
            </div>
          )}
        </div>

        {/* ── Oferta one-time sugerida ──────────────────────────────────── */}
        {suggestion && (
          <div className="card" style={{ padding: 20, border: "1px solid var(--green)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "var(--green)", marginBottom: 4 }}>
              <Sparkles size={16} /> Sugestão para o seu ritmo
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 16, maxWidth: 620 }}>
              {suggestion.reason}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div className="card" style={{ padding: 16, textAlign: "center", minWidth: 150, background: "var(--bg)" }}>
                <div style={{ fontSize: 26, fontWeight: 900, color: "var(--green)" }}>+{suggestion.pack.size}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>mapeamentos</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>R$ {suggestion.pack.priceBRL}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  R$ {suggestion.pack.perUnit.toFixed(2).replace(".", ",")} cada
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  className="btn btn-primary"
                  style={{ justifyContent: "center" }}
                  disabled={buyingSize !== null}
                  onClick={() => buyPack(suggestion.pack.size)}
                >
                  {buyingSize === suggestion.pack.size
                    ? <><Loader2 size={13} className="spin" /> Aguarde...</>
                    : <><Zap size={14} /> Comprar +{suggestion.pack.size} agora</>}
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ justifyContent: "center" }}
                  onClick={() => setShowAllPacks((v) => !v)}
                >
                  <Package size={14} /> {showAllPacks ? "Ocultar pacotes" : "Ver todos os pacotes"}
                </button>
              </div>
            </div>

            {showAllPacks && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 16 }}>
                {PERSONA_PACKS.map((pack) => (
                  <div key={pack.size} className="card" style={{ padding: 14, textAlign: "center", background: "var(--bg)" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--green)" }}>+{pack.size}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>personas</div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>R$ {pack.priceBRL}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 10 }}>
                      R$ {pack.perUnit.toFixed(2).replace(".", ",")} cada
                    </div>
                    <button
                      className="btn btn-ghost"
                      style={{ width: "100%", justifyContent: "center" }}
                      disabled={buyingSize !== null}
                      onClick={() => buyPack(pack.size)}
                    >
                      {buyingSize === pack.size ? <><Loader2 size={13} className="spin" /></> : <><ShoppingCart size={13} /> Comprar</>}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Upgrade de plano ──────────────────────────────────────────── */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", margin: "8px 2px 12px" }}>
            {isPaid ? "Mudar de plano" : "Escolher um plano"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            {PLANS.map((plan) => {
              const current = plan.id === teamPlan;
              return (
                <div
                  key={plan.id}
                  className="card"
                  style={{
                    padding: "22px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    border: plan.highlight ? "1px solid var(--green)" : undefined,
                    position: "relative",
                  }}
                >
                  {plan.highlight && (
                    <span style={{ position: "absolute", top: -10, left: 16, fontSize: 10, fontWeight: 800, background: "var(--green)", color: "#000", padding: "2px 8px", borderRadius: 6 }}>
                      MAIS POPULAR
                    </span>
                  )}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>{plan.name}</span>
                    {current && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--green)", border: "1px solid var(--green)", borderRadius: 6, padding: "2px 7px" }}>
                        SEU PLANO
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                    <span style={{ fontSize: 26, fontWeight: 900, color: "var(--text-primary)" }}>{plan.price}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{plan.period}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -6 }}>
                    {plan.personas} mapeamentos de personas / mês
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {plan.features.map((f) => (
                      <div key={f} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <CheckCircle size={14} style={{ color: "var(--green)", flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{f}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    className={plan.highlight ? "btn btn-primary" : "btn btn-ghost"}
                    style={{ marginTop: "auto", justifyContent: "center" }}
                    disabled={checkingOut !== null || current}
                    onClick={() => upgrade(plan.id)}
                  >
                    {current
                      ? "Plano ativo"
                      : checkingOut === plan.id
                        ? <><Loader2 size={13} className="spin" /> Aguarde...</>
                        : `Assinar ${plan.name}`}
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, textAlign: "center" }}>
            Pagamento seguro via Stripe. Você pode cancelar quando quiser.
          </div>
        </div>
      </div>
  );
}

// Página /plano (mantida para acesso direto por URL).
export function PlanPage() {
  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div>
            <div className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Gem size={20} /> Seu Plano
            </div>
            <div className="page-subtitle">O que está incluso, o quanto você já usou e ofertas para o seu ritmo</div>
          </div>
        </div>
      </div>
      <div className="content"><PlanContent /></div>
    </>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 800, color: accent ? "var(--green)" : "var(--text-primary)" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}
