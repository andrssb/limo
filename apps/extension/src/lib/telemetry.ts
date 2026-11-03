// Telemetria mínima e ANÔNIMA do funil. Gera um id na primeira execução e o
// guarda em chrome.storage; nenhum dado pessoal é enviado. É best-effort: se a
// rede/endpoint falhar, engole o erro — telemetria nunca quebra a UI.
const API_BASE = "https://api.limoapp.com.br/v1";

export type EventType = "install" | "app_open" | "login_view" | "login_attempt";

async function getAnonId(): Promise<string> {
  const { anon_id } = await chrome.storage.local.get("anon_id");
  if (anon_id) return anon_id as string;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ anon_id: id });
  return id;
}

function extVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "";
  }
}

export async function track(type: EventType, ok?: boolean): Promise<void> {
  try {
    const anonId = await getAnonId();
    await fetch(`${API_BASE}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, anonId, ok, version: extVersion() }),
      keepalive: true,
    });
  } catch {
    // best-effort: ignora
  }
}
