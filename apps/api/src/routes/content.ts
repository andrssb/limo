import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "@limo/db";
import { contentPieces, contacts, calls, messages } from "@limo/db";
import { eq, and, desc, count } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { generateContent, summarizeInteractionHistory } from "../services/ai.js";
import { getTeamKnowledgeContext } from "../services/coaching.js";

const generateSchema = z.object({
  contactId: z.string().uuid(),
  type: z.enum(["call_script", "email", "whatsapp"]),
  customContext: z.string().optional(),
});

export async function contentRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();
  fastify.addHook("preHandler", requireAuth);

  fastify.post("/content/generate", async (request, reply) => {
    const { id: userId, teamId } = request.user;
    const body = generateSchema.parse(request.body);

    const [contact] = await db.select().from(contacts).where(eq(contacts.id, body.contactId)).limit(1);
    if (!contact) return reply.code(404).send({ message: "Contato não encontrado" });

    // Build interaction history summary
    const recentCalls = await db.select({ result: calls.result, startedAt: calls.startedAt })
      .from(calls)
      .where(and(eq(calls.contactId, body.contactId), eq(calls.userId, userId)))
      .orderBy(desc(calls.startedAt))
      .limit(5);

    const recentMessages = await db.select({ content: messages.content, direction: messages.direction, sentAt: messages.sentAt })
      .from(messages)
      .where(eq(messages.contactId, body.contactId))
      .orderBy(desc(messages.sentAt))
      .limit(10);

    const historyLines: string[] = [];
    for (const c of recentCalls) {
      historyLines.push(`- Ligação em ${c.startedAt.toLocaleDateString("pt-BR")}: resultado ${c.result ?? "sem análise"}`);
    }
    for (const m of recentMessages) {
      const dir = m.direction === "outbound" ? "Você" : contact.firstName;
      historyLines.push(`- WhatsApp (${m.sentAt.toLocaleDateString("pt-BR")}) ${dir}: "${m.content?.slice(0, 80)}..."`);
    }

    const interactionHistory = historyLines.join("\n");

    // Coach IA: mesmo "cérebro" do coaching ao vivo (produto + playbook do time).
    const knowledgeContext = teamId ? await getTeamKnowledgeContext(teamId) : undefined;

    const content = await generateContent({
      type: body.type,
      temperature: contact.temperature,
      contactName: `${contact.firstName} ${contact.lastName}`,
      contactFirstName: contact.firstName,
      jobTitle: contact.jobTitle,
      companyName: contact.companyName,
      companyIndustry: (contact.enrichmentData as any)?.companyIndustry ?? null,
      interactionHistory,
      customContext: body.customContext,
      knowledgeContext,
    });

    const [saved] = await db.insert(contentPieces).values({
      userId,
      contactId: body.contactId,
      type: body.type,
      temperature: contact.temperature,
      content,
    }).returning();

    return reply.send({ piece: saved, content });
  });

  fastify.get("/content/history", async (request, reply) => {
    const { id: userId } = request.user;
    const query = request.query as any;
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const pageSize = parseInt(query.pageSize ?? "20", 10);
    const offset = (page - 1) * pageSize;

    const filters = [eq(contentPieces.userId, userId)];
    if (query.contactId) filters.push(eq(contentPieces.contactId, query.contactId));
    if (query.type) filters.push(eq(contentPieces.type, query.type));

    const where = and(...filters);
    const [{ total }] = await db.select({ total: count() }).from(contentPieces).where(where);
    const data = await db.select().from(contentPieces).where(where)
      .orderBy(desc(contentPieces.createdAt))
      .limit(pageSize).offset(offset);

    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  });

  fastify.post("/content/:id/mark-used", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { id: userId } = request.user;

    await db.update(contentPieces).set({ usedAt: new Date() })
      .where(and(eq(contentPieces.id, id), eq(contentPieces.userId, userId)));

    return reply.send({ success: true });
  });
}
