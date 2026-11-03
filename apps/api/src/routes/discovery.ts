import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { getDb } from "@limo/db";
import { lists, listCompanies } from "@limo/db";
import { eq, and } from "drizzle-orm";
import { discoverCompanies } from "../services/discovery/company_discovery_engine.js";

const searchSchema = z.object({
  sector:        z.string().min(1),
  state:         z.string().max(2).optional(),
  employeeRange: z.enum(["1-10", "11-50", "51-100", "101-200", "201-500", "501-1000", "1000+"]).optional(),
  limit:         z.coerce.number().min(1).max(25000).default(1000),
});

export async function discoveryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("preHandler", requireAuth);

  // POST /discovery/search — main company discovery
  fastify.post("/discovery/search", async (request) => {
    const body = searchSchema.parse(request.body);

    const companies = await discoverCompanies({
      sector:        body.sector,
      state:         body.state,
      employeeRange: body.employeeRange,
      limit:         body.limit,
    });

    return {
      companies,
      total: companies.length,
    };
  });

  // POST /discovery/save-to-list — persist discovered companies into a list,
  // which the Garimpo then works through to find decision-makers.
  fastify.post("/discovery/save-to-list", async (request, reply) => {
    const { id: userId, teamId } = request.user as any;
    const body = z.object({
      listId: z.string().uuid(),
      companies: z.array(z.object({
        id:           z.string().uuid().nullable().optional(),
        cnpj:         z.string().nullable().optional(),
        legal_name:   z.string().min(1),
        trade_name:   z.string().nullable().optional(),
        state:        z.string().nullable().optional(),
        city:         z.string().nullable().optional(),
        domain:       z.string().nullable().optional(),
        sector:       z.string().nullable().optional(),
        public_email: z.string().nullable().optional(),
        public_phone: z.string().nullable().optional(),
      })).min(1).max(25000),
    }).parse(request.body);

    const db = getDb();
    const [list] = await db.select().from(lists)
      .where(and(eq(lists.id, body.listId), eq(lists.teamId, teamId))).limit(1);
    if (!list) return reply.code(404).send({ message: "Lista não encontrada" });

    const rows = body.companies.map((c) => ({
      listId:        body.listId,
      discCompanyId: c.id ?? null,
      cnpj:          c.cnpj ? c.cnpj.replace(/\D/g, "").slice(0, 14) || null : null,
      legalName:     c.legal_name,
      tradeName:     c.trade_name ?? null,
      state:         c.state ?? null,
      city:          c.city ?? null,
      domain:        c.domain ?? null,
      sector:        c.sector ?? null,
      publicEmail:   c.public_email ?? null,
      publicPhone:   c.public_phone ?? null,
      addedBy:       userId,
    }));

    const inserted = await db.insert(listCompanies).values(rows)
      .onConflictDoNothing()
      .returning({ id: listCompanies.id });

    await db.update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, body.listId));

    return reply.code(201).send({ added: inserted.length, requested: rows.length });
  });
}
