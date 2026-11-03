import type { WASocket } from "@whiskeysockets/baileys";
import { getRedis } from "../lib/redis.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { normalizeBrazilianPhone } from "./voice-sdr.js";

const sessions = new Map<string, WASocket>();

// Baileys derruba o transporte logo depois do pareamento (código 515) e a
// sessão precisa ser recriada sozinha. O limite e o backoff existem para que
// uma credencial morta não vire reconexão infinita contra o WhatsApp — o
// caminho mais curto para o número ser banido.
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1500;
const RECONNECT_MAX_DELAY_MS = 30_000;
const reconnectAttempts = new Map<string, number>();
const manualDisconnects = new Set<string>();

export function reconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1), RECONNECT_MAX_DELAY_MS);
}

// WhatsApp auth state lives in Redis (encrypted), NOT on the local /tmp disk.
// Railway's filesystem is ephemeral, so a disk-based session was wiped on every
// redeploy and forced a re-scan. 60-day TTL, refreshed on every write.
const AUTH_PREFIX = "wa:auth";
const SESSION_TTL = 60 * 60 * 24 * 60; // 60 days

// Redis-backed Baileys auth state. Mirrors useMultiFileAuthState, but each blob
// is JSON-serialized with Baileys' BufferJSON (preserves Buffers) and encrypted.
async function useRedisAuthState(userId: string): Promise<{
  state: any;
  saveCreds: () => Promise<void>;
}> {
  const { initAuthCreds, BufferJSON, proto } = await import("@whiskeysockets/baileys");
  const redis = getRedis();
  const prefix = `${AUTH_PREFIX}:${userId}`;

  async function readData(suffix: string): Promise<any | null> {
    const raw = await redis.get(`${prefix}:${suffix}`);
    if (!raw) return null;
    try {
      return JSON.parse(decrypt(raw), BufferJSON.reviver);
    } catch {
      return null;
    }
  }

  async function writeData(suffix: string, value: any): Promise<void> {
    await redis.set(
      `${prefix}:${suffix}`,
      encrypt(JSON.stringify(value, BufferJSON.replacer)),
      "EX",
      SESSION_TTL,
    );
  }

  const creds = (await readData("creds")) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const data: Record<string, any> = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value ?? undefined;
            }),
          );
          return data;
        },
        set: async (data: Record<string, Record<string, any>>) => {
          const tasks: Promise<unknown>[] = [];
          for (const type in data) {
            for (const id in data[type]) {
              const value = data[type][id];
              const suffix = `${type}-${id}`;
              tasks.push(value ? writeData(suffix, value) : redis.del(`${prefix}:${suffix}`));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeData("creds", creds);
    },
  };
}

// Wipe every Redis key for a user's WhatsApp auth state.
async function clearAuthState(userId: string): Promise<void> {
  const redis = getRedis();
  const pattern = `${AUTH_PREFIX}:${userId}:*`;
  const keys: string[] = [];
  // SCAN (non-blocking) instead of KEYS — the Redis instance also holds queues.
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  if (keys.length) await redis.del(...keys);
}

export async function createWhatsAppConnection(
  userId: string,
  onQR: (qr: string) => void,
  onConnected: (phone: string) => void,
  onDisconnected: () => void,
  onMessage: (message: WhatsAppIncomingMessage) => void
): Promise<void> {
  // Dynamic import to avoid issues if Baileys is not installed
  const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } =
    await import("@whiskeysockets/baileys").catch(() => {
      throw new Error("Baileys not installed. Run: pnpm add @whiskeysockets/baileys");
    });

  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useRedisAuthState(userId);

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ["Limo", "Chrome", "1.0.0"],
  });

  sessions.set(userId, sock);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) onQR(qr);

    if (connection === "open") {
      reconnectAttempts.delete(userId);
      const phone = sock.user?.id?.split(":")[0] ?? "unknown";
      onConnected(phone);
    }

    if (connection === "close") {
      sessions.delete(userId);

      // Desconexão pedida pelo operador: não ressuscitar a sessão.
      if (manualDisconnects.has(userId)) {
        reconnectAttempts.delete(userId);
        return;
      }

      const loggedOut =
        (lastDisconnect?.error as any)?.output?.statusCode === DisconnectReason.loggedOut;
      if (loggedOut) {
        // Logged out for good — drop the stored credentials so the next
        // connect starts a fresh QR instead of replaying a dead session.
        reconnectAttempts.delete(userId);
        clearAuthState(userId).catch(() => {});
        onDisconnected();
        return;
      }

      const attempt = (reconnectAttempts.get(userId) ?? 0) + 1;
      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.delete(userId);
        onDisconnected();
        return;
      }
      reconnectAttempts.set(userId, attempt);
      setTimeout(() => {
        if (manualDisconnects.has(userId)) return;
        createWhatsAppConnection(userId, onQR, onConnected, onDisconnected, onMessage)
          .catch(() => {
            reconnectAttempts.delete(userId);
            onDisconnected();
          });
      }, reconnectDelayMs(attempt));
    }
  });

  sock.ev.on("messages.upsert", async ({ messages: msgs }) => {
    for (const msg of msgs) {
      if (!msg.message) continue;

      const isFromMe = msg.key.fromMe ?? false;
      const remoteJid = msg.key.remoteJid ?? "";
      if (remoteJid.includes("@g.us")) continue; // skip groups

      const phone = remoteJid.replace("@s.whatsapp.net", "");

      const textContent =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        null;

      const audioContent = msg.message.audioMessage ?? null;

      let audioBuffer: Buffer | null = null;
      if (audioContent) {
        try {
          const { downloadMediaMessage } = await import("@whiskeysockets/baileys");
          audioBuffer = await downloadMediaMessage(msg, "buffer", {}) as Buffer;
        } catch {
          // non-fatal: message saved without transcription
        }
      }

      onMessage({
        whatsappMessageId: msg.key.id ?? "",
        phone,
        direction: isFromMe ? "outbound" : "inbound",
        type: audioContent ? "audio" : "text",
        content: textContent,
        audioBuffer,
        sentAt: new Date((msg.messageTimestamp as number) * 1000).toISOString(),
      });
    }
  });
}

export async function disconnectWhatsApp(userId: string): Promise<void> {
  manualDisconnects.add(userId);
  reconnectAttempts.delete(userId);
  try {
    const sock = sessions.get(userId);
    if (sock) {
      try {
        await sock.logout();
      } catch {
        // already gone — fall through and clear state anyway
      }
      sessions.delete(userId);
    }
    await clearAuthState(userId);
  } finally {
    // O evento de close chega de forma assíncrona; solta a trava depois dele.
    setTimeout(() => manualDisconnects.delete(userId), 5_000);
  }
}

export async function sendWhatsAppText(userId: string, phone: string, text: string): Promise<string> {
  const sock = sessions.get(userId);
  if (!sock) throw new Error("WhatsApp do Luís não está conectado");
  // Mesmo normalizador do SDR de voz: decide pelo tamanho, não pelo prefixo,
  // senão um DDD 55 (Santa Maria) é lido como código de país.
  const e164 = normalizeBrazilianPhone(phone);
  if (!e164) throw new Error("Número de WhatsApp inválido");

  // Montar o JID concatenando "@s.whatsapp.net" NAO funciona no Brasil: conta
  // antiga vive no JID sem o nono digito (553199990000) enquanto o numero
  // discado tem nove (5531999990000). O sendMessage aceita qualquer JID e
  // devolve id de mensagem mesmo quando ninguem existe do outro lado - foi
  // assim que um envio "com sucesso" nunca chegou. Perguntar ao WhatsApp qual
  // e o JID real resolve as duas variantes.
  const digits = e164.slice(1);
  const lookup = (await sock.onWhatsApp(digits))?.[0];
  if (!lookup?.exists || !lookup.jid) throw new Error("Este número não tem WhatsApp");

  const result = await sock.sendMessage(lookup.jid, { text: text.trim() });
  return result?.key?.id ?? "";
}

export function isConnected(userId: string): boolean {
  return sessions.has(userId);
}

export interface WhatsAppIncomingMessage {
  whatsappMessageId: string;
  phone: string;
  direction: "inbound" | "outbound";
  type: "text" | "audio" | "image" | "document";
  content: string | null;
  audioBuffer: Buffer | null;
  sentAt: string;
}
