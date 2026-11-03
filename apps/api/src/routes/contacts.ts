import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "@limo/db";
import { contacts, users } from "@limo/db";
import { eq, and, ilike, or, desc, count, sql, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { enrichPersonPaid } from "../services/enrichment/paid_enrich.js";
import { addJob, QUEUES } from "../lib/queue.js";
import { upsertPersonToBase }     from "../services/enrichment/engine/people_base.js";
import { resolveCnpjByDomain }    from "../services/discovery/company_discovery_engine.js";
import { generateEmailCandidates } from "../services/enrichment/email.js";
import { buildContactSearchFilter, buildContactHasPhoneFilter } from "../services/contact-search.js";

const createContactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
  companyName: z.string().optional(),
  companyDomain: z.string().optional(),
  jobTitle: z.string().optional(),
  source: z.enum(["linkedin", "website", "manual", "crm", "import"]).default("manual"),
  enrichmentData: z.object({
    emailsFound: z.array(z.string()).optional(),
    phonesFound: z.array(z.string()).optional(),
    emailPattern: z.string().optional(),
    linkedinFollowers: z.number().optional(),
    companySize: z.string().optional(),
    companyIndustry: z.string().optional(),
    companyLinkedinUrl: z.string().optional(),
    sources: z.array(z.string()).optional(),
  }).optional(),
});

const enrichSchema = z.object({
  firstName:      z.string().optional(),
  lastName:       z.string().optional(),
  linkedinUrl:    z.string().url().optional(),
  email:          z.string().email().optional(),
  phone:          z.string().optional(),
  companyName:    z.string().optional(),
  companyDomain:  z.string().optional(),
  jobTitle:       z.string().optional(),
  allDomains:     z.array(z.string()).optional(),
});

const bulkDeleteSchema = z.object({
  ids:         z.array(z.string().uuid()).optional(),
  all:         z.boolean().optional(),
  temperature: z.enum(["cold", "warm", "hot"]).optional(),
  search:      z.string().optional(),
});

export async function contactsRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  fastify.addHook("preHandler", requireAuth);

  // Extension intake — captures the visible LinkedIn data and feeds the shared
  // people base (enr_people) so the Garimpo crawler can find this real person
  // later. Pure intake: the legacy enrichment pipeline no longer runs here; the
  // crawler complements and validates the data during a Garimpo run.
  fastify.post("/contacts/enrich", async (request, reply) => {
    const body = enrichSchema.parse(request.body);

    const firstName = body.firstName ?? "";
    const lastName  = body.lastName  ?? "";

    // Normalize the domains the extension captured/guessed from the page.
    const domains = [
      ...(body.allDomains ?? []),
      ...(body.companyDomain ? [body.companyDomain] : []),
    ]
      .map((d) => d.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]!)
      .filter(Boolean)
      .filter((d, i, a) => a.indexOf(d) === i);

    const primaryDomain = domains[0];

    // Strong join key: resolve the company CNPJ from its domain via the RF base
    // (cheap lookup — not the legacy enrichment engine).
    const cnpj = primaryDomain
      ? await resolveCnpjByDomain(primaryDomain).catch(() => null)
      : null;

    // Feed the shared people base with the observed data (never invented). This
    // is what lets the Garimpo crawler find this real person later.
    await upsertPersonToBase({
      firstName:     firstName || undefined,
      lastName:      lastName  || undefined,
      jobTitle:      body.jobTitle,
      companyName:   body.companyName,
      companyDomain: primaryDomain,
      cnpj:          cnpj ?? undefined,
      linkedinUrl:   body.linkedinUrl,
      email:         body.email,
      phone:         body.phone,
      source:        "linkedin_extension",
    }).catch(() => {});

    // Light email inference (no external API/SMTP): when the page didn't reveal
    // an email, offer professional-pattern candidates from the company domain so
    // the extension surfaces likely addresses to try. These are CANDIDATES
    // (clearly unverified) — never stored as fact in the shared base.
    const emailCandidates = body.email
      ? [body.email]
      : (primaryDomain && firstName && lastName)
        ? generateEmailCandidates(firstName, lastName, primaryDomain)
        : [];

    return reply.send({
      captured:        true,
      email:           body.email ?? null,
      phone:           body.phone ?? null,
      emailsFound:     emailCandidates,
      emailConfidence: body.email ? "probable" : (emailCandidates.length ? "guessed" : null),
      phonesFound:     body.phone ? [body.phone] : [],
      companyDomain:   primaryDomain ?? null,
      cnpj:            cnpj ?? null,
    });
  });

  fastify.post("/contacts", async (request, reply) => {
    const { id: userId, teamId } = request.user;
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });

    const body = createContactSchema.parse(request.body);

    // Check duplicate by email or LinkedIn URL
    if (body.email || body.linkedinUrl) {
      const existing = await db.select({ id: contacts.id }).from(contacts).where(
        and(
          eq(contacts.teamId, teamId),
          or(
            body.email ? ilike(contacts.email, body.email) : sql`false`,
            body.linkedinUrl ? eq(contacts.linkedinUrl, body.linkedinUrl) : sql`false`
          )
        )
      ).limit(1);

      if (existing.length > 0) {
        return reply.code(409).send({ statusCode: 409, error: "Conflict", message: "Contato já existe", contactId: existing[0]!.id });
      }
    }

    const [contact] = await db.insert(contacts).values({
      userId,
      teamId,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
      linkedinUrl: body.linkedinUrl,
      companyName: body.companyName,
      companyDomain: body.companyDomain,
      jobTitle: body.jobTitle,
      source: body.source,
      enrichmentData: body.enrichmentData ? {
        ...body.enrichmentData,
        lastEnrichedAt: new Date().toISOString(),
        sources: body.enrichmentData.sources ?? [body.source],
      } : null,
    }).returning();

    return reply.code(201).send({ contact });
  });

  fastify.get("/contacts", async (request, reply) => {
    const { id: userId, teamId, role } = request.user;
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });

    const query = request.query as any;
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize ?? "20", 10)));
    const offset = (page - 1) * pageSize;

    const filters = [eq(contacts.teamId, teamId)];
    if (role !== "manager" && role !== "admin") {
      filters.push(eq(contacts.userId, userId));
    }
    if (query.temperature) filters.push(eq(contacts.temperature, query.temperature));
    if (query.search) {
      const searchFilter = buildContactSearchFilter(String(query.search));
      if (searchFilter) filters.push(searchFilter);
    }
    if (query.hasPhone === "true") filters.push(buildContactHasPhoneFilter());

    const where = and(...filters);
    const [{ total }] = await db.select({ total: count() }).from(contacts).where(where);
    const data = await db.select().from(contacts).where(where)
      .orderBy(desc(contacts.updatedAt))
      .limit(pageSize)
      .offset(offset);

    return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  });

  fastify.get("/contacts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { teamId } = request.user;

    const [contact] = await db.select().from(contacts).where(
      and(eq(contacts.id, id), teamId ? eq(contacts.teamId, teamId) : sql`true`)
    ).limit(1);

    if (!contact) return reply.code(404).send({ message: "Contato não encontrado" });
    return reply.send({ contact });
  });

  fastify.patch("/contacts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { teamId } = request.user;
    const body = createContactSchema.partial().parse(request.body);

    const [updated] = await db.update(contacts)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(contacts.id, id), teamId ? eq(contacts.teamId, teamId) : sql`true`))
      .returning();

    if (!updated) return reply.code(404).send({ message: "Contato não encontrado" });
    return reply.send({ contact: updated });
  });

  fastify.delete("/contacts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { teamId } = request.user;

    await db.delete(contacts).where(
      and(eq(contacts.id, id), teamId ? eq(contacts.teamId, teamId) : sql`true`)
    );
    return reply.send({ success: true });
  });

  // Bulk delete: either an explicit list of ids, or every contact matching the
  // current filters (`all: true`). Always scoped to the caller's team — and to
  // their own contacts unless they're a manager/admin, mirroring GET /contacts.
  fastify.post("/contacts/bulk-delete", async (request, reply) => {
    const { id: userId, teamId, role } = request.user;
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });

    const body = bulkDeleteSchema.parse(request.body ?? {});

    const filters = [eq(contacts.teamId, teamId)];
    if (role !== "manager" && role !== "admin") {
      filters.push(eq(contacts.userId, userId));
    }

    if (body.all) {
      if (body.temperature) filters.push(eq(contacts.temperature, body.temperature));
      if (body.search) {
        // Mesmo filtro da listagem: apagar "todos os filtrados" precisa casar
        // exatamente com o que a tela mostrou.
        const searchFilter = buildContactSearchFilter(body.search);
        if (searchFilter) filters.push(searchFilter);
      }
    } else if (body.ids && body.ids.length > 0) {
      filters.push(inArray(contacts.id, body.ids));
    } else {
      return reply.send({ success: true, deleted: 0 });
    }

    const deleted = await db.delete(contacts).where(and(...filters)).returning({ id: contacts.id });
    return reply.send({ success: true, deleted: deleted.length });
  });

  fastify.post("/contacts/:id/sync-crm", async (request, reply) => {
    const { id: contactId } = request.params as { id: string };
    const { id: userId } = request.user;
    const { provider } = (request.body ?? {}) as { provider?: string };

    await addJob(QUEUES.CRM_SYNC, "sync-contact", { contactId, userId, provider });
    return reply.send({ success: true, message: "Sincronização enfileirada" });
  });

  // ── Enriquecer Contato (telefone/email da pessoa via fonte paga, sob demanda) ──
  // A fonte (provedor) nunca é exposta na resposta. O núcleo (cache 90d + teto
  // mensal + chamada ao provedor) vive no helper compartilhado com o Garimpo.
  fastify.post("/contacts/:id/enrich", async (request, reply) => {
    const { id: contactId } = request.params as { id: string };
    const { teamId } = request.user;
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });

    const [c] = await db.select().from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.teamId, teamId))).limit(1);
    if (!c) return reply.code(404).send({ message: "Contato não encontrado" });

    const enr = (c.enrichmentData ?? {}) as any;
    const cnpj = enr.cnpj as string | undefined;
    const [city, state] = (c.location ?? "").split(/[,/-]/).map((s) => s.trim());

    const out = await enrichPersonPaid(db, {
      teamId, contactId,
      firstName: c.firstName, lastName: c.lastName,
      companyName: c.companyName, cnpj,
      city: city || undefined, state: state || undefined,
    });

    if (out.status === "no_provider")    return reply.code(503).send({ message: "Enriquecimento ainda não está configurado." });
    if (out.status === "cap_reached")    return reply.code(429).send({ message: "Limite mensal de enriquecimento atingido." });
    if (out.status === "provider_error") return reply.code(502).send({ message: "Falha ao consultar a fonte de dados." });

    const bestPhone = out.phones?.[0]?.number ?? null;
    const bestEmail = out.emails?.[0]?.address ?? null;
    if (bestPhone || bestEmail) {
      await db.update(contacts).set({
        phone: bestPhone ?? c.phone,
        email: bestEmail ?? c.email,
        updatedAt: new Date(),
        enrichmentData: {
          ...enr,
          enrichedPhones: out.phones.map((p) => p.number),
          enrichedEmails: out.emails.map((e) => e.address),
          enrichedAt: new Date().toISOString(),
        },
      }).where(eq(contacts.id, contactId));
    }

    // resposta NÃO expõe o provedor
    return reply.send({
      matched: Boolean(out.matched || bestPhone || bestEmail),
      phone: bestPhone,
      email: bestEmail,
      phones: out.phones.map((p) => p.number),
      emails: out.emails.map((e) => e.address),
      fromCache: out.fromCache,
    });
  });
}
