import type { ExtensionMessage, ExtensionResponse } from "@limo/types";
import { track } from "../lib/telemetry.js";

const API_BASE = "https://api.limoapp.com.br/v1";
const SIGNUP_URL = "https://app.limoapp.com.br/register";

chrome.runtime.onInstalled.addListener((details) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // Só na instalação de verdade — em update/chrome_update abrir aba seria spam.
  if (details.reason !== "install") return;
  track("install");
  // Instalar não muda NADA na tela, e o Chrome joga o ícone pro menu de
  // extensões (escondido atrás do quebra-cabeça). Sem este empurrão a pessoa
  // esquece que instalou: dos ~50 que instalaram, 5 abriram o painel. Abre o
  // cadastro já com o id desta extensão — no fim a web devolve a sessão pelo
  // handoff (onMessageExternal) e o painel loga sozinho.
  chrome.tabs.create({ url: `${SIGNUP_URL}?ext=${encodeURIComponent(chrome.runtime.id)}` });
});

// ── Handoff de sessão do app web → extensão ──────────────────────────────────
// Quando alguém cria a conta no cadastro da web (app.limoapp.com.br/register),
// a página devolve os tokens pra cá. Assim a extensão fica logada SOZINHA, sem a
// pessoa ter que voltar e digitar e-mail/senha de novo (era o maior ponto de
// abandono do funil). Só aceita da origem oficial (garantido por
// externally_connectable no manifest, e revalidado aqui).
const WEB_ORIGIN = "https://app.limoapp.com.br";
chrome.runtime.onMessageExternal.addListener((message: any, sender, sendResponse) => {
  if (message?.type !== "LIMO_AUTH_HANDOFF") return;
  if (sender.origin !== WEB_ORIGIN) {
    sendResponse({ ok: false, error: "origem não autorizada" });
    return;
  }
  const { accessToken, refreshToken, user } = message;
  if (!accessToken || !user) {
    sendResponse({ ok: false, error: "payload incompleto" });
    return;
  }
  // Grava tudo numa tacada só: o painel escuta storage.onChanged e loga ao vivo.
  chrome.storage.local.set({ accessToken, refreshToken, user }, () => {
    sendResponse({ ok: true });
  });
  return true; // resposta assíncrona
});

chrome.runtime.onMessage.addListener(
  (message: any, sender, sendResponse: (r: any) => void) => {
    // ── Coaching ao vivo: widget (content script) inicia a captura ─────────
    // Arma o tabCapture (áudio do lead) + abre offscreen (mic do SDR + aba) e
    // cria a sessão. Degrada pra mic-only se o Chrome negar o gesto do tabCapture.
    if (message.type === "COACHING_WIDGET_START") {
      startWidgetCoaching(sender.tab?.id)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ error: err.message }));
      return true;
    }
    if (message.type === "COACHING_WIDGET_STOP") {
      chrome.runtime.sendMessage({ type: "COACHING_STOP_RECORDING" }).catch(() => {});
      endWidgetCoaching()
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: true }));
      return true;
    }

    // ── Chunk de áudio (offscreen → API) ───────────────────────────────────
    // Cada chunk já vem rotulado (sdr/lead). Transcreve+gera tips na API e
    // devolve as sugestões pro widget na aba da chamada.
    if (message.type === "COACHING_AUDIO_CHUNK") {
      handleAudioChunk(message).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }

    // ── Gravações completas (offscreen → API) ──────────────────────────────
    // Ao encerrar, cria a call com as trilhas → análise PÓS-CALL (Fase 0).
    if (message.type === "COACHING_FULL_TRACKS") {
      finalizeIngest(message).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }

    // ── Status da gravação (offscreen → widget) ────────────────────────────
    if (message.type === "COACHING_RECORDING_STARTED") {
      relayToCoachingTab(message).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }
    // Erro de microfone → quase sempre é permissão ausente (offscreen não pode
    // exibir o prompt). Abrimos a página visível de permissão e orientamos.
    if (message.type === "COACHING_MIC_ERROR") {
      handleMicError().catch(() => {});
      sendResponse({ ok: true });
      return true;
    }
    // Permissão concedida na página → avisa o widget que pode tentar de novo.
    if (message.type === "COACHING_MIC_PERMISSION_GRANTED") {
      relayToCoachingTab({ type: "COACHING_MIC_ERROR", error: "Microfone liberado! Toque em Ativar coaching novamente." }).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }

    // ── LinkedIn scraping relay (content script → storage + side panel) ────
    if (
      message.type === "LINKEDIN_PROFILE_STARTED" ||
      message.type === "LINKEDIN_PROFILE_DONE"
    ) {
      chrome.storage.local.set({ linkedin_data: message.payload }).catch(() => {});
      chrome.runtime.sendMessage(message).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }

    // ── Manual LinkedIn scrape trigger from side panel ────────────────────
    if (message.type === "TRIGGER_LINKEDIN_SCRAPE") {
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_LINKEDIN_SCRAPE" }).catch(() => {});
        }
      });
      sendResponse({ ok: true });
      return true;
    }

    handleMessage(message as ExtensionMessage)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: (err as Error).message }));
    return true;
  }
);

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case "GET_AUTH_TOKEN": {
      const token = await getStoredToken();
      return { accessToken: token };
    }

    case "ENRICH_CONTACT": {
      return apiFetch("/contacts/enrich", {
        method: "POST",
        body: JSON.stringify(message.payload),
      });
    }

    case "SAVE_CONTACT": {
      return apiFetch("/contacts", {
        method: "POST",
        body: JSON.stringify(message.payload),
      });
    }

    case "GENERATE_CONTENT": {
      return apiFetch("/content/generate", {
        method: "POST",
        body: JSON.stringify(message.payload),
      });
    }

    case "CALL_STARTED": {
      return apiFetch("/calls", {
        method: "POST",
        body: JSON.stringify({
          contactId: message.payload.contactId,
          type: "manual",
          direction: "outbound",
          startedAt: new Date().toISOString(),
        }),
      });
    }

    case "CALL_ENDED": {
      const { callId, audioBlob } = message.payload;
      if (audioBlob) {
        const blob = dataURLToBlob(audioBlob);
        const formData = new FormData();
        formData.append("audio", blob, "call.webm");
        const token = await getStoredToken();
        await fetch(`${API_BASE}/calls/${callId}/audio`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });
      }
      return { success: true };
    }

    case "OPEN_SIDE_PANEL": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && tab?.windowId) {
        await chrome.sidePanel.open({ tabId: tab.id, windowId: tab.windowId });
      }
      return { success: true };
    }

    case "GET_TAB_CONTEXT": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabUrl = tab?.url ?? "";
      const stored = await chrome.storage.local.get(["linkedin_data"]);

      if (tabUrl.match(/linkedin\.com\/in\/[^/?]+/)) {
        const tabVanity    = tabUrl.match(/linkedin\.com\/in\/([^/?]+)/)?.[1];
        const storedVanity = (stored.linkedin_data?.linkedinUrl as string | undefined)
          ?.match(/linkedin\.com\/in\/([^/?]+)/)?.[1];
        const data = tabVanity === storedVanity ? (stored.linkedin_data ?? null) : null;
        return { context: "linkedin", data };
      }

      return { context: null, data: null };
    }

    default:
      throw new Error(`Unknown message type: ${(message as any).type}`);
  }
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const token = await getStoredToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).message ?? `HTTP ${response.status}`);
  }
  return response.json();
}

async function getStoredToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["accessToken"], (result) => resolve(result.accessToken ?? null));
  });
}

// ─── Offscreen document for microphone capture ───────────────────────────────

async function setupOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL("offscreen/index.html");
  const existing = await (chrome as any).runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  }).catch(() => []);
  if (existing.length > 0) return;
  await (chrome as any).offscreen.createDocument({
    url: offscreenUrl,
    reasons: ["USER_MEDIA"],
    justification: "Captura de áudio (microfone + aba) para coaching ao vivo de vendas",
  });
}

// ─── Coaching ao vivo via widget (Fase 1) ────────────────────────────────────

interface ActiveCoaching { sessionId: string; tabId: number; }

async function getActiveCoaching(): Promise<ActiveCoaching | null> {
  const { coaching_session } = await chrome.storage.local.get(["coaching_session"]);
  return coaching_session ?? null;
}

async function startWidgetCoaching(tabId?: number): Promise<{ sessionId?: string; error?: string }> {
  if (!tabId) return { error: "Aba da chamada não identificada." };

  // Tenta capturar o áudio da aba (lado do lead). Exige gesto do usuário — se o
  // Chrome negar, seguimos só com o microfone (degradação graciosa).
  let tabStreamId: string | undefined;
  try {
    tabStreamId = await new Promise<string>((resolve, reject) => {
      (chrome as any).tabCapture.getMediaStreamId({ targetTabId: tabId }, (id: string) => {
        const err = chrome.runtime.lastError;
        if (err || !id) reject(new Error(err?.message ?? "sem streamId"));
        else resolve(id);
      });
    });
  } catch {
    tabStreamId = undefined; // mic-only fallback
  }

  // Cria a sessão de coaching na API
  const { sessionId } = (await apiFetch("/coaching/start", {
    method: "POST",
    body: JSON.stringify({}),
  })) as { sessionId: string };

  await chrome.storage.local.set({ coaching_session: { sessionId, tabId } });

  // Abre o offscreen e inicia a gravação das trilhas
  await setupOffscreenDocument();
  await chrome.runtime.sendMessage({ type: "COACHING_START_RECORDING", tabStreamId }).catch(() => {});

  return { sessionId };
}

async function endWidgetCoaching(): Promise<void> {
  // Encerra a sessão AO VIVO, mas mantém o ponteiro em storage até a ingestão
  // das gravações completas (COACHING_FULL_TRACKS) acontecer.
  const active = await getActiveCoaching();
  if (active?.sessionId) {
    await apiFetch(`/coaching/${active.sessionId}/end`, { method: "POST", body: "{}" }).catch(() => {});
  }
}

// Recebe as trilhas completas do offscreen e cria a call p/ análise pós-call.
async function finalizeIngest(message: {
  sdrAudioUrl: string | null;
  leadAudioUrl: string | null;
  durationMs: number;
}): Promise<void> {
  const active = await getActiveCoaching();
  await chrome.storage.local.remove(["coaching_session"]);

  const { sdrAudioUrl, leadAudioUrl, durationMs } = message;
  const durationSeconds = durationMs ? Math.round(durationMs / 1000) : undefined;

  // 2 trilhas → diarização real; 1 só (fallback mic-only) → áudio único.
  const body: Record<string, unknown> = {
    channel: "browser",
    direction: "outbound",
    durationSeconds,
    sourceMeta: active?.sessionId ? { coachingSessionId: active.sessionId } : undefined,
  };
  if (sdrAudioUrl && leadAudioUrl) {
    body.sdrAudioUrl = sdrAudioUrl;
    body.leadAudioUrl = leadAudioUrl;
  } else {
    body.audioUrl = sdrAudioUrl ?? leadAudioUrl;
  }

  await apiFetch("/calls/ingest", { method: "POST", body: JSON.stringify(body) }).catch(() => {});
}

async function handleAudioChunk(message: { speaker: "sdr" | "lead"; data: number[]; mimeType: string }): Promise<void> {
  const active = await getActiveCoaching();
  if (!active?.sessionId) return;

  const base64 = arrayToBase64(message.data);
  const res = (await apiFetch(`/coaching/${active.sessionId}/chunk`, {
    method: "POST",
    body: JSON.stringify({ audio: base64, mimeType: message.mimeType, speaker: message.speaker }),
  }).catch(() => null)) as { tips?: unknown[]; skipped?: boolean } | null;

  if (res && !res.skipped && res.tips?.length) {
    chrome.tabs.sendMessage(active.tabId, { type: "COACHING_TIPS", tips: res.tips }).catch(() => {});
  }
}

async function relayToCoachingTab(message: unknown): Promise<void> {
  const active = await getActiveCoaching();
  if (active?.tabId) {
    chrome.tabs.sendMessage(active.tabId, message).catch(() => {});
  }
}

// Erro de microfone (tipicamente permissão ausente): abre a página visível de
// permissão, orienta o widget e limpa a sessão órfã (a gravação não começou).
async function handleMicError(): Promise<void> {
  const active = await getActiveCoaching();
  await chrome.tabs.create({ url: chrome.runtime.getURL("permission/index.html") }).catch(() => {});
  if (active?.tabId) {
    chrome.tabs.sendMessage(active.tabId, {
      type: "COACHING_MIC_ERROR",
      error: "Abrimos uma aba pra liberar o microfone. Permita o acesso e toque em Ativar coaching novamente.",
    }).catch(() => {});
  }
  if (active?.sessionId) {
    await apiFetch(`/coaching/${active.sessionId}/end`, { method: "POST", body: "{}" }).catch(() => {});
  }
  await chrome.storage.local.remove(["coaching_session"]);
}

function arrayToBase64(arr: number[]): string {
  let binary = "";
  const bytes = new Uint8Array(arr);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function dataURLToBlob(dataURL: string): Blob {
  const [header, data] = dataURL.split(",");
  const mime = header!.match(/:(.*?);/)![1];
  const binary = atob(data!);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
  return new Blob([array], { type: mime });
}
