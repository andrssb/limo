// Página VISÍVEL da extensão usada uma única vez para conceder a permissão de
// microfone. O documento offscreen (invisível) não consegue exibir o prompt do
// Chrome; ao chamar getUserMedia aqui, o navegador mostra o prompt e a permissão
// passa a valer para toda a extensão (inclusive o offscreen).

const GREEN = "#a3e635";
const DARK = "#1a2332";

function view(state: "asking" | "ok" | "error", msg = "") {
  document.body.style.cssText =
    "margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;" +
    "background:#f5f7fa;font-family:'Nunito Sans',-apple-system,sans-serif";
  const icon = state === "ok" ? "✓" : state === "error" ? "!" : "●";
  const iconColor = state === "ok" ? "#16a34a" : state === "error" ? "#ef4444" : GREEN;
  const title =
    state === "ok" ? "Microfone liberado!" :
    state === "error" ? "Não foi possível liberar" :
    "Liberando o microfone…";
  const body =
    state === "ok" ? "Pode fechar esta aba e voltar para a reunião — agora é só tocar em <b>Ativar coaching</b> no widget da Limo." :
    state === "error" ? msg :
    "Permita o acesso ao microfone no aviso do navegador.";
  document.body.innerHTML = `
    <div style="max-width:380px;background:#fff;border:1px solid #e6e9ef;border-radius:16px;
      padding:32px 36px;text-align:center;box-shadow:0 10px 40px rgba(20,30,50,0.08)">
      <div style="width:56px;height:56px;border-radius:50%;display:flex;align-items:center;
        justify-content:center;margin:0 auto 18px;background:${DARK};color:${iconColor};
        font-size:26px;font-weight:900">${icon}</div>
      <div style="font-size:18px;font-weight:900;color:${DARK};margin-bottom:8px">${title}</div>
      <div style="font-size:13.5px;color:#5b6675;line-height:1.6">${body}</div>
    </div>`;
}

async function run() {
  view("asking");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((t) => t.stop()); // só queríamos a permissão
    view("ok");
    chrome.runtime.sendMessage({ type: "COACHING_MIC_PERMISSION_GRANTED" }).catch(() => {});
  } catch (err: any) {
    view("error", err?.message ?? "Erro ao acessar o microfone. Verifique se há um microfone conectado.");
  }
}

run();
