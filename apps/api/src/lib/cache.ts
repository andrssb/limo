// Cache best-effort no Redis pras camadas que CUSTAM crédito (SERP/Scrapfly).
// Re-crawlar a mesma empresa não deve re-gastar crédito: o resultado fica no
// Redis com TTL. Tudo é tolerante a falha — se o Redis cair, degrada pra "miss"
// e o fluxo segue normal (nunca quebra o crawler por causa de cache).

import { getRedis } from "./redis.js";

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedis().get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await getRedis().set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // best-effort: ignora falha de escrita no cache
  }
}
