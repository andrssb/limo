import { Resend } from "resend";
import { config } from "../config.js";
import type { WeeklyReportData, MemberDiagnosis, Bottleneck } from "@limo/types";

function getResend() {
  if (!config.RESEND_API_KEY) return null;
  return new Resend(config.RESEND_API_KEY);
}

// ─── Welcome Email ────────────────────────────────────────────────────────────

export async function sendWelcomeEmail(params: {
  name: string;
  email: string;
  role: string;
  teamName?: string;
}): Promise<void> {
  const { name, email, role, teamName } = params;
  const firstName = name.split(" ")[0];
  const isManager = role === "manager";

  const resend = getResend();
  if (!resend) return;
  await resend.emails.send({
    from: config.EMAIL_FROM,
    to: email,
    subject: `Bem-vindo ao Limo, ${firstName}!`,
    html: `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8">
<style>
  body { font-family: 'Courier New', monospace; background: #0f0f0f; color: #e0e0e0; margin: 0; padding: 0; }
  .container { max-width: 560px; margin: 0 auto; padding: 40px 28px; }
  .logo { font-size: 11px; color: #a3e635; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 32px; }
  h1 { font-size: 22px; color: #fff; margin: 0 0 8px; }
  .subtitle { font-size: 13px; color: #666; margin-bottom: 28px; }
  .card { background: #111; border: 1px solid #1e2d40; border-radius: 10px; padding: 20px 24px; margin-bottom: 20px; }
  .card-label { font-size: 10px; color: #4d6070; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; }
  .card-text { font-size: 13px; color: #ccc; line-height: 1.6; }
  .tip { border-left: 3px solid #a3e635; padding-left: 14px; }
  .footer { margin-top: 32px; font-size: 11px; color: #333; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <div class="logo">⬡ Limo</div>
  <h1>Bem-vindo, ${firstName}!</h1>
  <div class="subtitle">Sua conta foi criada com sucesso${teamName ? ` no time <strong style="color:#fff">${teamName}</strong>` : ""}.</div>

  <div class="card tip">
    <div class="card-label">Próximo passo</div>
    <div class="card-text">
      ${isManager
        ? `Convide seus BDRs em <strong>Configurações → Convites</strong> e aguarde o primeiro relatório semanal toda sexta às 8h.`
        : `Instale a extensão Limo no Chrome para enriquecer leads diretamente no LinkedIn e registrar ligações.`
      }
    </div>
  </div>

  <div class="card">
    <div class="card-label">Sua conta</div>
    <div class="card-text">
      <strong style="color:#fff">${name}</strong><br>
      ${email}<br>
      Papel: <span style="color:#a3e635">${role.toUpperCase()}</span>
    </div>
  </div>

  <div class="footer">Limo · Sales Enablement Platform</div>
</div>
</body>
</html>`,
  });
}

// ─── Alerta de novo cadastro (pro dono) ─────────────────────────────────────────
// Dispara no instante em que alguém cria conta (/auth/register) ou preenche o
// typeform (/signup/survey). Best-effort: se o Resend não estiver configurado,
// apenas loga e segue (não bloqueia o cadastro).

export async function sendSignupAlert(params: {
  kind: "account" | "lead";
  name: string;
  email: string;
  company?: string | null;
  phone?: string | null;
  role?: string | null;        // conta
  accessType?: string | null;  // lead: individual | team
  outcome?: string | null;     // lead: account | ask_invite | demo
}): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn(`[signup-alert] RESEND_API_KEY ausente — alerta de cadastro NÃO enviado (${params.kind}: ${params.email})`);
    return;
  }

  const isAccount = params.kind === "account";
  const title   = isAccount ? "Nova CONTA criada" : "Novo LEAD no typeform";
  const rows: Array<[string, string | null | undefined]> = [
    ["Nome", params.name],
    ["E-mail", params.email],
    ["Empresa", params.company],
    ["Telefone", params.phone],
    ["Papel", params.role?.toUpperCase()],
    ["Tipo de acesso", params.accessType],
    ["Desfecho", params.outcome],
  ];
  const rowsHtml = rows
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `<div class="card-text"><span style="color:#4d6070">${k}:</span> <strong style="color:#fff">${v}</strong></div>`)
    .join("");

  await resend.emails.send({
    from: config.EMAIL_FROM,
    to: config.SIGNUP_ALERT_EMAIL || config.OWNER_EMAIL,
    subject: `[Limo] ${title}: ${params.name}`,
    html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><style>
      body { font-family: 'Courier New', monospace; background: #0f0f0f; color: #e0e0e0; margin: 0; }
      .container { max-width: 520px; margin: 0 auto; padding: 36px 26px; }
      .logo { font-size: 11px; color: #a3e635; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 24px; }
      h1 { font-size: 19px; color: #fff; margin: 0 0 18px; }
      .card { background: #111; border: 1px solid #1e2d40; border-left: 3px solid #a3e635; border-radius: 10px; padding: 18px 22px; }
      .card-text { font-size: 13px; line-height: 1.9; }
      .footer { margin-top: 28px; font-size: 11px; color: #333; text-align: center; }
    </style></head><body><div class="container">
      <div class="logo">Limo</div>
      <h1>${title}</h1>
      <div class="card">${rowsHtml}</div>
      <div class="footer">Limo · alerta automático de cadastro</div>
    </div></body></html>`,
  });
}

// ─── Weekly Report Email ──────────────────────────────────────────────────────

export async function sendWeeklyReportEmail(params: {
  managerEmail: string;
  managerName: string;
  teamName: string;
  weekRange: string;
  report: WeeklyReportData;
}): Promise<void> {
  const resend = getResend();
  if (!resend) return;
  const html = buildReportHtml(params);
  await resend.emails.send({
    from: config.EMAIL_FROM,
    to: params.managerEmail,
    subject: `Limo Weekly · ${params.teamName} · ${params.weekRange}`,
    html,
  });
}

function thermometerBar(value: number): string {
  const filled = Math.round(value / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function coachabilityBadge(status: MemberDiagnosis["coachabilityStatus"]): string {
  const map = {
    excellent: "✅ EXCELENTE",
    positive: "✅ POSITIVO",
    alert: "⚠️ ALERTA",
    critical: "🚨 CRÍTICO",
  };
  return map[status];
}

function buildReportHtml(params: {
  managerName: string;
  teamName: string;
  weekRange: string;
  report: WeeklyReportData;
}): string {
  const { managerName, teamName, weekRange, report } = params;
  const convPct = (report.conversionRate * 100).toFixed(1);
  const callGap = report.callsGoal - report.callsTotal;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: 'Courier New', monospace; background: #0f0f0f; color: #e0e0e0; margin: 0; padding: 0; }
  .container { max-width: 680px; margin: 0 auto; padding: 32px 24px; }
  .header { border-bottom: 1px solid #333; padding-bottom: 16px; margin-bottom: 24px; }
  .title { font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 2px; }
  h1 { font-size: 20px; color: #fff; margin: 4px 0; }
  .section { margin-bottom: 32px; }
  .section-title { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 2px; border-top: 1px solid #222; padding-top: 12px; margin-bottom: 16px; }
  .thermometer { font-size: 28px; color: #22c55e; font-weight: bold; }
  .thermo-bar { color: #22c55e; font-size: 18px; letter-spacing: 2px; }
  .metric-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #1a1a1a; }
  .metric-label { color: #888; font-size: 13px; }
  .metric-value { color: #fff; font-size: 13px; font-weight: bold; }
  .bottleneck { background: #1a0a0a; border-left: 3px solid #ef4444; padding: 12px 16px; margin-bottom: 12px; }
  .bottleneck-title { color: #ef4444; font-weight: bold; font-size: 14px; }
  .bottleneck-body { color: #ccc; font-size: 13px; margin-top: 6px; line-height: 1.5; }
  .revenue-loss { color: #f87171; font-size: 12px; margin-top: 6px; }
  .member { background: #111; border: 1px solid #222; padding: 16px; margin-bottom: 12px; }
  .member-name { font-size: 15px; color: #fff; font-weight: bold; margin-bottom: 10px; }
  .member-row { font-size: 12px; padding: 3px 0; color: #bbb; }
  .member-row strong { color: #fff; }
  .coach-badge { display: inline-block; font-size: 11px; padding: 2px 8px; background: #1a1a1a; border-radius: 4px; margin-top: 6px; }
  .action-item { padding: 8px 0; border-bottom: 1px solid #1a1a1a; font-size: 13px; color: #d1d5db; }
  .action-item::before { content: "□ "; color: #4ade80; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #222; font-size: 11px; color: #555; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="title">Limo Weekly</div>
    <h1>${teamName} · ${weekRange}</h1>
  </div>

  <div class="section">
    <div class="section-title">🌡️ Termômetro da Operação</div>
    <div class="thermometer">${report.thermometer}%</div>
    <div class="thermo-bar">${thermometerBar(report.thermometer)}</div>
    <br>
    <div class="metric-row"><span class="metric-label">Ligações realizadas</span><span class="metric-value">${report.callsTotal} / ${report.callsGoal} ${callGap > 0 ? `(gap: ${callGap})` : "✓"}</span></div>
    <div class="metric-row"><span class="metric-label">Reuniões agendadas</span><span class="metric-value">${report.meetingsBooked}</span></div>
    <div class="metric-row"><span class="metric-label">Taxa de conversão</span><span class="metric-value">${convPct}%</span></div>
    <div class="metric-row"><span class="metric-label">Leads enriquecidos</span><span class="metric-value">${report.leadsEnriched}</span></div>
  </div>

  <div class="section">
    <div class="section-title">🚨 Principais Gargalos</div>
    ${report.bottlenecks
      .map(
        (b: Bottleneck, i: number) => `
    <div class="bottleneck">
      <div class="bottleneck-title">${i + 1}. ${b.title}</div>
      <div class="bottleneck-body">${b.description}</div>
      <div class="revenue-loss">Impacto estimado: R$ ${b.estimatedRevenueLoss.toLocaleString("pt-BR")} · ${b.occurrenceCount} ocorrências</div>
    </div>`
      )
      .join("")}
  </div>

  <div class="section">
    <div class="section-title">👤 Diagnóstico Individual</div>
    ${report.memberDiagnoses
      .map(
        (m: MemberDiagnosis) => `
    <div class="member">
      <div class="member-name">${m.userName}</div>
      <div class="member-row">✓ <strong>Pontos fortes:</strong> ${m.strengths.join(", ")}</div>
      <div class="member-row">⚡ <strong>Ponto crítico:</strong> ${m.criticalPoint}</div>
      <div class="member-row">🎯 <strong>Meta semana:</strong> ${m.weekGoal}</div>
      <div class="coach-badge">${coachabilityBadge(m.coachabilityStatus)} — ${m.coachabilityNote}</div>
    </div>`
      )
      .join("")}
  </div>

  <div class="section">
    <div class="section-title">📌 Ações Recomendadas para Esta Semana</div>
    ${report.actionItems.map((a: string) => `<div class="action-item">${a}</div>`).join("")}
  </div>

  <div class="footer">
    Limo · Sales Enablement Platform<br>
    Gerado automaticamente toda sexta-feira às 8h
  </div>
</div>
</body>
</html>`;
}
