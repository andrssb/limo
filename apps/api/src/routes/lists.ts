import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "@limo/db";
import { lists, listContacts, listCompanies, contacts, users } from "@limo/db";
import { eq, and, desc, count, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { groq, MODELS } from "../lib/groq.js";

export async function listsRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();
  fastify.addHook("preHandler", requireAuth);

  // GET /lists
  fastify.get("/lists", async (request) => {
    const { teamId } = request.user as any;
    const rows = await db
      .select({
        id: lists.id,
        name: lists.name,
        description: lists.description,
        enrichmentSummary: lists.enrichmentSummary,
        createdAt: lists.createdAt,
      })
      .from(lists)
      .where(eq(lists.teamId, teamId))
      .orderBy(desc(lists.createdAt));

    // Counts via grouped queries (the inline correlated sql subquery was
    // returning 0 — Drizzle wasn't correlating ${lists.id} reliably).
    const ids = rows.map((r) => r.id);
    const [contactRows, companyRows] = ids.length
      ? await Promise.all([
          db.select({ listId: listContacts.listId, n: count() }).from(listContacts)
            .where(inArray(listContacts.listId, ids)).groupBy(listContacts.listId),
          db.select({ listId: listCompanies.listId, n: count() }).from(listCompanies)
            .where(inArray(listCompanies.listId, ids)).groupBy(listCompanies.listId),
        ])
      : [[], []];
    const contactBy = new Map(contactRows.map((r) => [r.listId, r.n]));
    const companyBy = new Map(companyRows.map((r) => [r.listId, r.n]));

    return {
      lists: rows.map((r) => ({
        ...r,
        contactCount: contactBy.get(r.id) ?? 0,
        companyCount: companyBy.get(r.id) ?? 0,
      })),
    };
  });

  // POST /lists
  fastify.post("/lists", async (request, reply) => {
    const { id: userId, teamId } = request.user as any;
    const body = z.object({
      name: z.string().min(1).max(200),
      description: z.string().optional(),
    }).parse(request.body);

    const [list] = await db.insert(lists).values({
      name: body.name,
      description: body.description,
      userId,
      teamId,
    }).returning();
    return reply.code(201).send({ list });
  });

  // PATCH /lists/:id
  fastify.patch("/lists/:id", async (request, reply) => {
    const { id: userId, teamId } = request.user as any;
    const { id } = request.params as any;
    const body = z.object({
      name: z.string().min(1).max(200).optional(),
      description: z.string().optional(),
    }).parse(request.body);

    const [list] = await db
      .update(lists)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(lists.id, id), eq(lists.teamId, teamId)))
      .returning();
    if (!list) return reply.code(404).send({ message: "Lista não encontrada" });
    return { list };
  });

  // DELETE /lists/:id
  fastify.delete("/lists/:id", async (request, reply) => {
    const { teamId } = request.user as any;
    const { id } = request.params as any;
    await db.delete(lists).where(and(eq(lists.id, id), eq(lists.teamId, teamId)));
    return reply.code(204).send();
  });

  // GET /lists/:id/contacts
  fastify.get("/lists/:id/contacts", async (request, reply) => {
    const { teamId } = request.user as any;
    const { id } = request.params as any;
    const { page = "1", pageSize = "20" } = request.query as any;

    const [list] = await db.select().from(lists)
      .where(and(eq(lists.id, id), eq(lists.teamId, teamId))).limit(1);
    if (!list) return reply.code(404).send({ message: "Lista não encontrada" });

    const offset = (Number(page) - 1) * Number(pageSize);
    const rows = await db
      .select({ contact: contacts, addedAt: listContacts.addedAt })
      .from(listContacts)
      .innerJoin(contacts, eq(contacts.id, listContacts.contactId))
      .where(eq(listContacts.listId, id))
      .orderBy(desc(listContacts.addedAt))
      .limit(Number(pageSize))
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(listContacts)
      .where(eq(listContacts.listId, id));

    return { list, contacts: rows.map((r) => r.contact), total };
  });

  // GET /lists/:id/companies — companies saved into the list via "Descobrir"
  fastify.get("/lists/:id/companies", async (request, reply) => {
    const { teamId } = request.user as any;
    const { id } = request.params as any;
    const { page = "1", pageSize = "20" } = request.query as any;

    const [list] = await db.select().from(lists)
      .where(and(eq(lists.id, id), eq(lists.teamId, teamId))).limit(1);
    if (!list) return reply.code(404).send({ message: "Lista não encontrada" });

    const offset = (Number(page) - 1) * Number(pageSize);
    const rows = await db
      .select()
      .from(listCompanies)
      .where(eq(listCompanies.listId, id))
      .orderBy(desc(listCompanies.addedAt))
      .limit(Number(pageSize))
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(listCompanies)
      .where(eq(listCompanies.listId, id));

    return { companies: rows, total };
  });

  // POST /lists/:id/contacts  { contactIds: string[] }
  fastify.post("/lists/:id/contacts", async (request, reply) => {
    const { id: userId, teamId } = request.user as any;
    const { id } = request.params as any;
    const { contactIds } = z.object({ contactIds: z.array(z.string().uuid()).min(1) }).parse(request.body);

    const [list] = await db.select().from(lists)
      .where(and(eq(lists.id, id), eq(lists.teamId, teamId))).limit(1);
    if (!list) return reply.code(404).send({ message: "Lista não encontrada" });

    await db.insert(listContacts)
      .values(contactIds.map((cid) => ({ listId: id, contactId: cid, addedBy: userId })))
      .onConflictDoNothing();

    await db.update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, id));
    return reply.code(201).send({ added: contactIds.length });
  });

  // DELETE /lists/:id/contacts/:contactId
  fastify.delete("/lists/:id/contacts/:contactId", async (request, reply) => {
    const { teamId } = request.user as any;
    const { id, contactId } = request.params as any;

    const [list] = await db.select().from(lists)
      .where(and(eq(lists.id, id), eq(lists.teamId, teamId))).limit(1);
    if (!list) return reply.code(404).send({ message: "Lista não encontrada" });

    await db.delete(listContacts)
      .where(and(eq(listContacts.listId, id), eq(listContacts.contactId, contactId)));
    return reply.code(204).send();
  });

  // POST /lists/:id/enrich  — trigger enrichment (news + AI pitch)
  fastify.post("/lists/:id/enrich", async (request, reply) => {
    const { teamId } = request.user as any;
    const { id } = request.params as any;
    const { productDescription } = z.object({ productDescription: z.string().min(10) }).parse(request.body);

    const [list] = await db.select().from(lists)
      .where(and(eq(lists.id, id), eq(lists.teamId, teamId))).limit(1);
    if (!list) return reply.code(404).send({ message: "Lista não encontrada" });

    // Get contacts in list
    const rows = await db
      .select({ contact: contacts })
      .from(listContacts)
      .innerJoin(contacts, eq(contacts.id, listContacts.contactId))
      .where(eq(listContacts.listId, id))
      .limit(10);

    if (rows.length === 0) return reply.code(400).send({ message: "Lista sem contatos" });

    const sectors = [...new Set(rows.flatMap((r) => r.contact.enrichmentData
      ? [(r.contact.enrichmentData as any).companyIndustry].filter(Boolean) : []))];
    const companies = [...new Set(rows.map((r) => r.contact.companyName).filter(Boolean))].slice(0, 5);

    const prompt = `Você é um especialista em vendas B2B brasileiro.

Produto sendo vendido: ${productDescription}

Empresas-alvo na lista: ${companies.join(", ")}
Setores identificados: ${sectors.length ? sectors.join(", ") : "variados"}

Sua tarefa:
1. Identifique 3 gatilhos de vendas relevantes para esse setor/produto (ex: expansão de mercado, regulamentação, tendência tecnológica)
2. Para cada gatilho, escreva uma frase de abertura personalizada de cold call/email (máx 2 linhas)
3. Sugira 2 dores principais que esse tipo de empresa provavelmente tem

Responda em JSON:
{
  "gatilhos": [{"titulo": "...", "descricao": "...", "abertura": "..."}],
  "dores": ["...", "..."],
  "resumo": "texto resumido de 2 frases para o BDR ter contexto"
}`;

    const msg = await groq.chat.completions.create({
      model: MODELS.fast,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = msg.choices[0]?.message?.content ?? "";
    let parsed: any = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { resumo: raw };
    } catch { parsed = { resumo: raw }; }

    const summary = JSON.stringify(parsed);
    await db.update(lists).set({ enrichmentSummary: summary, updatedAt: new Date() }).where(eq(lists.id, id));

    return { enrichment: parsed };
  });
}
