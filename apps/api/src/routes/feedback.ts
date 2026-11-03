import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "@limo/db";
import { feedbackRecords, users } from "@limo/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";

const feedbackTypeEnum = z.enum([
  "talk_ratio",
  "objection_handling",
  "discovery",
  "closing",
  "rapport",
]);

const createSchema = z.object({
  userId: z.string().uuid(),
  callId: z.string().uuid().optional(),
  feedbackType: feedbackTypeEnum,
  feedbackText: z.string().min(10),
  targetMetric: z.string().min(1),
  baselineValue: z.number().default(0),
});

export async function feedbackRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();
  fastify.addHook("preHandler", requireAuth);

  // POST /feedback — manager creates feedback for an SDR
  fastify.post("/feedback", async (request, reply) => {
    const { id: managerId, role } = request.user as any;
    if (role !== "manager" && role !== "admin") {
      return reply.code(403).send({ message: "Apenas gestores podem criar feedback" });
    }

    const body = createSchema.parse(request.body);

    const [record] = await db.insert(feedbackRecords).values({
      userId: body.userId,
      managerId,
      callId: body.callId ?? null,
      feedbackType: body.feedbackType,
      feedbackText: body.feedbackText,
      targetMetric: body.targetMetric,
      baselineValue: body.baselineValue,
    }).returning();

    return reply.code(201).send({ feedback: record });
  });

  // GET /feedback/user/:userId — list feedback for a specific SDR
  fastify.get("/feedback/user/:userId", async (request, reply) => {
    const { id: requesterId, role } = request.user as any;
    const { userId } = request.params as { userId: string };

    // Managers can see anyone's feedback; SDRs can only see their own
    if (role !== "manager" && role !== "admin" && requesterId !== userId) {
      return reply.code(403).send({ message: "Acesso negado" });
    }

    const records = await db
      .select()
      .from(feedbackRecords)
      .where(eq(feedbackRecords.userId, userId))
      .orderBy(desc(feedbackRecords.createdAt))
      .limit(50);

    return reply.send({ data: records, total: records.length });
  });
}
