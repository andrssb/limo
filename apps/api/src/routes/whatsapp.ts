import type { FastifyInstance } from "fastify";
import { getDb } from "@limo/db";
import { whatsappSessions, messages, contacts } from "@limo/db";
import { eq, and, or, desc, count } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { getRedis } from "../lib/redis.js";
import {
  createWhatsAppConnection,
  disconnectWhatsApp,
  isConnected,
  sendWhatsAppText,
  type WhatsAppIncomingMessage,
} from "../services/whatsapp.js";
import { addJob, QUEUES } from "../lib/queue.js";
import { randomUUID } from "crypto";

export async function whatsappRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();
  fastify.addHook("preHandler", requireAuth);

  fastify.post("/whatsapp/connect", async (request, reply) => {
    const { id: userId } = request.user;
    const sessionId = randomUUID();
    const redis = getRedis();

    await db.insert(whatsappSessions).values({
      userId,
      status: "connecting",
    }).onConflictDoUpdate({ target: whatsappSessions.userId, set: { status: "connecting", updatedAt: new Date() } });

    // Start connection in background — QR will be pushed to Redis pub/sub
    startWhatsAppSession(db, userId).catch(console.error);

    return reply.send({ sessionId, message: "Aguardando QR Code. Polling em GET /whatsapp/qr" });
  });

  fastify.get("/whatsapp/qr", async (request, reply) => {
    const { id: userId } = request.user;
    const redis = getRedis();
    const qr = await redis.get(`wa:qr:${userId}`);

    if (!qr) {
      const [session] = await db.select({ status: whatsappSessions.status }).from(whatsappSessions)
        .where(eq(whatsappSessions.userId, userId)).limit(1);
      return reply.send({ qr: null, status: session?.status ?? "disconnected" });
    }

    return reply.send({ qr, status: "connecting" });
  });

  fastify.get("/whatsapp/status", async (request, reply) => {
    const { id: userId } = request.user;
    const [session] = await db.select().from(whatsappSessions).where(eq(whatsappSessions.userId, userId)).limit(1);

    return reply.send({
      connected: isConnected(userId),
      status: session?.status ?? "disconnected",
      phoneNumber: session?.phoneNumber ?? null,
      connectedAt: session?.connectedAt ?? null,
    });
  });

  fastify.delete("/whatsapp/disconnect", async (request, reply) => {
    const { id: userId } = request.user;
    await disconnectWhatsApp(userId);
    await db.update(whatsappSessions).set({ status: "disconnected", updatedAt: new Date() })
      .where(eq(whatsappSessions.userId, userId));
    return reply.send({ success: true });
  });

  fastify.get("/whatsapp/messages", async (request, reply) => {
    const { id: userId } = request.user;
    const query = request.query as any;
    const contactId = query.contactId;
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const pageSize = parseInt(query.pageSize ?? "30", 10);
    const offset = (page - 1) * pageSize;

    const filters = [eq(messages.userId, userId)];
    if (contactId) filters.push(eq(messages.contactId, contactId));

    const where = and(...filters);
    const [{ total }] = await db.select({ total: count() }).from(messages).where(where);
    const data = await db.select().from(messages).where(where)
      .orderBy(desc(messages.sentAt)).limit(pageSize).offset(offset);

    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  });

  fastify.post("/whatsapp/send", async (request, reply) => {
    const { id: userId } = request.user;
    const body = request.body as { phone?: unknown; text?: unknown };
    if (typeof body?.phone !== "string" || typeof body?.text !== "string" || !body.text.trim()) {
      return reply.code(400).send({ message: "Informe phone e text" });
    }
    try {
      const whatsappMessageId = await sendWhatsAppText(userId, body.phone, body.text);
      return reply.send({ success: true, whatsappMessageId });
    } catch (error) {
      return reply.code(409).send({ message: (error as Error).message });
    }
  });
}

async function handleIncomingMessage(db: any, userId: string, msg: WhatsAppIncomingMessage): Promise<void> {
  const phoneClean = msg.phone.replace(/\D/g, "");
  const phoneNoBR = phoneClean.startsWith("55") ? phoneClean.slice(2) : phoneClean;

  const [matchedContact] = await db.select({ id: contacts.id }).from(contacts)
    .where(
      and(
        eq(contacts.userId, userId),
        or(
          eq(contacts.phone, phoneClean),
          eq(contacts.phone, phoneNoBR),
          eq(contacts.phone, `+${phoneClean}`),
        )
      )
    )
    .limit(1);

  if (!matchedContact) return; // skip messages from unknown contacts

  // Save audio buffer to temp file so the worker can access it
  let audioFilePath: string | null = null;
  if (msg.type === "audio" && msg.audioBuffer) {
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const { writeFile } = await import("fs/promises");
    const { randomUUID } = await import("crypto");
    audioFilePath = join(tmpdir(), `limo-wa-${randomUUID()}.ogg`);
    await writeFile(audioFilePath, msg.audioBuffer);
  }

  const [inserted] = await db.insert(messages).values({
    userId,
    contactId: matchedContact.id,
    whatsappMessageId: msg.whatsappMessageId,
    direction: msg.direction,
    type: msg.type,
    content: msg.content,
    audioUrl: audioFilePath,
    sentAt: new Date(msg.sentAt),
  }).onConflictDoNothing().returning();

  if (!inserted) return; // duplicate message

  if (msg.type === "audio" && audioFilePath) {
    await addJob(QUEUES.MESSAGE_TRANSCRIBE, "transcribe-message", {
      messageId: inserted.id,
      audioUrl: audioFilePath,
    });
  }
}

/**
 * Abre a sessao do WhatsApp para um usuario, com todos os handlers de QR,
 * status e mensagem recebida.
 *
 * Fica exportada porque o boot da API tambem precisa dela: a sessao viva mora
 * em memoria, entao todo deploy derrubava o WhatsApp e alguem tinha que clicar
 * em "Conectar" com o celular na mao. Enquanto isso o Luis prometia mandar
 * mensagem e nao mandava, sem ninguem perceber.
 */
export async function startWhatsAppSession(db: any, userId: string): Promise<void> {
  const redis = getRedis();
  await createWhatsAppConnection(
    userId,
    async (qr) => {
      await redis.set(`wa:qr:${userId}`, qr, "EX", 60);
      await redis.publish(`wa:qr:${userId}`, qr);
    },
    async (phone) => {
      await db.update(whatsappSessions).set({
        status: "connected",
        phoneNumber: phone,
        connectedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(whatsappSessions.userId, userId));
      await redis.del(`wa:qr:${userId}`);
    },
    async () => {
      await db.update(whatsappSessions).set({
        status: "disconnected",
        updatedAt: new Date(),
      }).where(eq(whatsappSessions.userId, userId));
    },
    async (msg: WhatsAppIncomingMessage) => {
      await handleIncomingMessage(db, userId, msg);
    },
  );
}

/**
 * Reabre no boot as sessoes que estavam conectadas. As credenciais vivem no
 * Redis e sobrevivem ao restart; se alguma estiver morta, a propria conexao
 * marca como desconectada depois das tentativas.
 */
export async function restoreWhatsAppSessions(db: any, log: {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
}): Promise<void> {
  const rows = await db.select({ userId: whatsappSessions.userId })
    .from(whatsappSessions).where(eq(whatsappSessions.status, "connected"));
  if (rows.length === 0) return;

  for (const row of rows) {
    try {
      await startWhatsAppSession(db, row.userId);
      log.info({ userId: row.userId }, "Sessao de WhatsApp restaurada apos o boot");
    } catch (error) {
      log.warn({ err: error, userId: row.userId }, "Nao foi possivel restaurar a sessao de WhatsApp");
    }
  }
}
