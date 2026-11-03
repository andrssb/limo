import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "@limo/db";
import { personas } from "@limo/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";

const personaSchema = z.object({
  name:               z.string().min(1).max(200),
  targetRoles:        z.array(z.string()).default([]),
  targetSectors:      z.array(z.string()).default([]),
  targetCnaes:        z.array(z.string()).default([]),
  targetStates:       z.array(z.string()).default([]),
  targetCities:       z.array(z.string()).default([]),
  minEmployees:       z.number().int().positive().optional(),
  maxEmployees:       z.number().int().positive().optional(),
  painPoint:          z.string().default(""),
  productDescription: z.string().default(""),
});

export async function personasRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();
  fastify.addHook("preHandler", requireAuth);

  fastify.get("/personas", async (request) => {
    const { teamId } = request.user as any;
    const rows = await db.select().from(personas)
      .where(eq(personas.teamId, teamId))
      .orderBy(desc(personas.createdAt));
    return { personas: rows };
  });

  fastify.post("/personas", async (request, reply) => {
    const { id: userId, teamId } = request.user as any;
    const body = personaSchema.parse(request.body);
    const [persona] = await db.insert(personas).values({ ...body, userId, teamId }).returning();
    return reply.code(201).send({ persona });
  });

  fastify.patch("/personas/:id", async (request, reply) => {
    const { teamId } = request.user as any;
    const { id } = request.params as any;
    const body = personaSchema.partial().parse(request.body);
    const [persona] = await db
      .update(personas).set(body)
      .where(and(eq(personas.id, id), eq(personas.teamId, teamId)))
      .returning();
    if (!persona) return reply.code(404).send({ message: "Persona não encontrada" });
    return { persona };
  });

  fastify.delete("/personas/:id", async (request, reply) => {
    const { teamId } = request.user as any;
    const { id } = request.params as any;
    await db.delete(personas).where(and(eq(personas.id, id), eq(personas.teamId, teamId)));
    return reply.code(204).send();
  });
}
