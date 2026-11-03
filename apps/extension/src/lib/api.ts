const API_BASE = "https://api.limoapp.com.br/v1";

async function getStoredTokens(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["accessToken", "refreshToken"], (result) => {
      resolve({ accessToken: result.accessToken ?? null, refreshToken: result.refreshToken ?? null });
    });
  });
}

async function tryRefresh(): Promise<string | null> {
  const { refreshToken } = await getStoredTokens();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const { tokens } = await res.json();
    chrome.storage.local.set({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
    return tokens.accessToken as string;
  } catch {
    return null;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { accessToken } = await getStoredTokens();

  const doRequest = async (token: string | null) =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

  let response = await doRequest(accessToken);

  // Token expirado → tenta refresh e repete
  if (response.status === 401) {
    const newToken = await tryRefresh();
    if (newToken) {
      response = await doRequest(newToken);
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Erro desconhecido" }));
    throw new Error((error as any).message ?? `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function saveContact(data: object): Promise<any> {
  return apiFetch("/contacts", { method: "POST", body: JSON.stringify(data) });
}

export async function enrichContact(data: object): Promise<any> {
  return apiFetch("/contacts/enrich", { method: "POST", body: JSON.stringify(data) });
}

export async function generateContent(data: object): Promise<any> {
  return apiFetch("/content/generate", { method: "POST", body: JSON.stringify(data) });
}

export async function syncToCRM(contactId: string): Promise<any> {
  return apiFetch(`/contacts/${contactId}/sync-crm`, { method: "POST", body: JSON.stringify({}) });
}
