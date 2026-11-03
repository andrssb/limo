const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/v1";

function getToken() {
  return localStorage.getItem("limo_token");
}

export function setToken(token: string, refreshToken?: string) {
  localStorage.setItem("limo_token", token);
  if (refreshToken) localStorage.setItem("limo_refresh_token", refreshToken);
}

export function clearToken() {
  localStorage.removeItem("limo_token");
  localStorage.removeItem("limo_refresh_token");
  localStorage.removeItem("limo_user");
}

// O access token dura 15 minutos. Sem renovar, o operador era expulso para o
// login no meio da operação - inclusive durante uma ligação em andamento. A API
// ja emitia um refresh token de 7 dias; o painel simplesmente jogava fora.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem("limo_refresh_token");
  if (!refreshToken) return null;
  // Uma renovação por vez: varias chamadas paralelas tomando 401 juntas nao
  // podem disparar varios refresh e invalidar umas as outras.
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return null;
        const data = await res.json() as { tokens?: { accessToken?: string; refreshToken?: string } };
        if (!data.tokens?.accessToken) return null;
        setToken(data.tokens.accessToken, data.tokens.refreshToken);
        return data.tokens.accessToken;
      } catch {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

function sessionExpired(): never {
  clearToken();
  window.location.href = "/login";
  throw new Error("Sessão expirada");
}

export function getStoredUser() {
  const raw = localStorage.getItem("limo_user");
  return raw ? JSON.parse(raw) : null;
}

export function setStoredUser(user: object) {
  localStorage.setItem("limo_user", JSON.stringify(user));
}

// ─── Cache GET (stale-while-revalidate) ─────────────────────────────────────
// Faz a troca de telas ser instantânea: revisitar uma tela renderiza na hora com
// o último dado e revalida em segundo plano. Qualquer escrita (POST/PUT/DELETE)
// limpa o cache, então nada fica defasado após uma ação. TTL curto por segurança.
type CacheEntry = { data: unknown; ts: number };
const getCache = new Map<string, CacheEntry>();

export function invalidateApiCache() {
  getCache.clear();
}

export async function cachedGet<T>(path: string, ttlMs = 30_000): Promise<T> {
  const hit = getCache.get(path);
  if (hit && Date.now() - hit.ts < ttlMs) {
    // Fresco o suficiente: devolve já e revalida em segundo plano (atualiza o cache).
    apiFetch<T>(path).then((d) => getCache.set(path, { data: d, ts: Date.now() })).catch(() => {});
    return hit.data as T;
  }
  const data = await apiFetch<T>(path);
  getCache.set(path, { data, ts: Date.now() });
  return data;
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (res.status === 401) sessionExpired();
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).message ?? `Erro ${res.status}`); }
  invalidateApiCache(); // upload muda dado → próximos GETs vêm frescos
  return res.json();
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const send = (token: string | null) => fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      // Só envia Content-Type JSON quando há corpo — senão o Fastify rejeita
      // POST sem body com "Body cannot be empty when content-type is application/json"
      ...(options.body != null ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  let res = await send(getToken());

  if (res.status === 401) {
    // Access token vencido: renova uma vez e repete a chamada. So cai para o
    // login se a renovacao tambem falhar.
    const renewed = await refreshAccessToken();
    if (!renewed) sessionExpired();
    res = await send(renewed);
    if (res.status === 401) sessionExpired();
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Erro ${res.status}`);
  }

  // Escrita (não-GET) pode mudar qualquer dado → invalida o cache de GET.
  const method = (options.method ?? "GET").toUpperCase();
  if (method !== "GET") invalidateApiCache();

  return res.json();
}
