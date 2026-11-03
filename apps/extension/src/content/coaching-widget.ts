// Widget flutuante de Coaching ao Vivo (Fase 1) — injetado em páginas de
// reunião (Google Meet / Teams). Aparece sozinho com a marca Limo; um toque
// arma a captura (gesto exigido pelo Chrome) e vira indicador REC. As sugestões
// da IA aparecem inline, sem popup e sem abrir o sidepanel.
//
// Comunicação com o background:
//   content → bg: { type: "COACHING_WIDGET_START" }  → { sessionId } | { error }
//                 { type: "COACHING_WIDGET_STOP", sessionId }
//   bg → content: { type: "COACHING_TIPS", tips }
//                 { type: "COACHING_RECORDING_STARTED" }
//                 { type: "COACHING_MIC_ERROR", error }

interface Tip { type: string; label: string; content: string; urgency: string; }

const GREEN = "#65a30d";      // verde Limo legível sobre fundo claro
const GREEN_BG = "#a3e635";    // verde vibrante p/ botão principal
const DARK = "#1a2332";        // texto principal
const TIP_COLORS: Record<string, string> = {
  question: "#3b82f6", technique: GREEN, objection: "#f97316", mirror: "#8b5cf6", close: "#22c55e",
};
const TIP_LABELS: Record<string, string> = {
  question: "Pergunta", technique: "Técnica", objection: "Objeção", mirror: "Espelho", close: "Fechamento",
};

let host: HTMLDivElement | null = null;
let root: ShadowRoot | null = null;
let state: "idle" | "starting" | "recording" | "error" = "idle";
let sessionId: string | null = null;
let tips: Tip[] = [];
let errorMsg = "";

function injectWidget() {
  if (host) return;
  host = document.createElement("div");
  host.id = "limo-coaching-widget";
  host.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:2147483647;";
  root = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);
  render();
}

function logoUrl(): string {
  try { return chrome.runtime.getURL("logo_oficial.png"); } catch { return ""; }
}

function render() {
  if (!root) return;
  root.innerHTML = `
    <style>
      *{box-sizing:border-box;font-family:'Nunito Sans',-apple-system,sans-serif;margin:0}
      .card{width:300px;background:#ffffff;border:1px solid #e6e9ef;
        border-radius:14px;box-shadow:0 10px 40px rgba(20,30,50,0.12);overflow:hidden;color:${DARK}}
      .head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #eef1f5;background:#fafbfc}
      .logo{height:20px;width:auto}
      .brand{font-size:13px;font-weight:900;color:${GREEN};letter-spacing:-0.02em}
      .sub{font-size:10px;color:#8a94a6;margin-left:auto}
      .body{padding:14px}
      .btn{width:100%;border:none;border-radius:9px;padding:11px;font-size:13px;font-weight:900;
        cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:7px}
      .btn-go{background:${GREEN_BG};color:${DARK}}
      .btn-stop{background:#fef2f2;color:#ef4444;border:1px solid #fca5a5}
      .rec{display:flex;align-items:center;gap:8px;margin-bottom:12px}
      .dot{width:10px;height:10px;border-radius:50%;background:#ef4444;animation:p 1.4s ease-in-out infinite}
      .rec-txt{font-size:13px;font-weight:800;color:#ef4444}
      .hint{font-size:11px;color:#6b7280;line-height:1.5;margin-bottom:12px}
      .tips{display:flex;flex-direction:column;gap:7px;max-height:280px;overflow-y:auto;margin-bottom:12px}
      .tip{background:#f5f7fa;border-radius:8px;border-left:3px solid ${GREEN};padding:8px 10px}
      .tip-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:3px}
      .tip-cat{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em}
      .tip-now{font-size:9px;font-weight:800;color:#ef4444}
      .tip-label{font-size:12px;font-weight:700;color:${DARK};margin-bottom:1px}
      .tip-content{font-size:11.5px;color:#5b6675;line-height:1.45}
      .empty{text-align:center;color:#8a94a6;font-size:11px;padding:14px 4px}
      .err{color:#ef4444;font-size:11px;margin-bottom:10px;line-height:1.4}
      @keyframes p{0%,100%{opacity:1}50%{opacity:0.35}}
    </style>
    <div class="card">
      <div class="head">
        ${logoUrl() ? `<img class="logo" src="${logoUrl()}" alt="Limo"/>` : `<span class="brand">Limo</span>`}
        <span class="sub">${state === "recording" ? "ouvindo a call" : "Coaching IA"}</span>
      </div>
      <div class="body">${bodyHtml()}</div>
    </div>`;

  const go = root.querySelector("#limo-go") as HTMLButtonElement | null;
  const stop = root.querySelector("#limo-stop") as HTMLButtonElement | null;
  if (go) go.onclick = startCoaching;
  if (stop) stop.onclick = stopCoaching;
}

function bodyHtml(): string {
  if (state === "idle" || state === "error") {
    return `
      ${state === "error" ? `<div class="err">${errorMsg}</div>` : ""}
      <div class="hint">A IA vai ouvir os dois lados da conversa e sugerir perguntas, contornos de objeção e próximos passos em tempo real.</div>
      <button id="limo-go" class="btn btn-go">● Ativar coaching</button>`;
  }
  if (state === "starting") {
    return `<div class="hint">Iniciando… permita o microfone se o navegador perguntar.</div>`;
  }
  // recording
  const tipsHtml = tips.length
    ? tips.slice(0, 6).map((t) => `
        <div class="tip" style="border-left-color:${TIP_COLORS[t.type] ?? GREEN}">
          <div class="tip-top">
            <span class="tip-cat" style="color:${TIP_COLORS[t.type] ?? GREEN}">${TIP_LABELS[t.type] ?? t.type}</span>
            ${t.urgency === "high" ? `<span class="tip-now">⚡ AGORA</span>` : ""}
          </div>
          <div class="tip-label">${escapeHtml(t.label)}</div>
          <div class="tip-content">${escapeHtml(t.content)}</div>
        </div>`).join("")
    : `<div class="empty">Ouvindo… as sugestões aparecem após ~10s de conversa.</div>`;
  return `
    <div class="rec"><span class="dot"></span><span class="rec-txt">REC · gravando</span></div>
    <div class="tips">${tipsHtml}</div>
    <button id="limo-stop" class="btn btn-stop">■ Encerrar coaching</button>`;
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function startCoaching() {
  state = "starting"; tips = []; render();
  try {
    const res = await chrome.runtime.sendMessage({ type: "COACHING_WIDGET_START" });
    if (res?.error) throw new Error(res.error);
    sessionId = res?.sessionId ?? null;
    state = "recording";
  } catch (err: any) {
    state = "error";
    errorMsg = err?.message ?? "Não foi possível iniciar o coaching.";
  }
  render();
}

async function stopCoaching() {
  try {
    await chrome.runtime.sendMessage({ type: "COACHING_WIDGET_STOP", sessionId });
  } catch { /* ignore */ }
  sessionId = null; state = "idle"; tips = []; render();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "COACHING_TIPS" && Array.isArray(msg.tips)) {
    tips = [...msg.tips, ...tips].slice(0, 12);
    if (state === "recording") render();
  }
  if (msg?.type === "COACHING_MIC_ERROR") {
    state = "error"; errorMsg = msg.error ?? "Erro ao capturar áudio."; render();
  }
});

// Aparece sozinho nas páginas de reunião (matches do manifest cuidam de Meet/Teams).
injectWidget();
