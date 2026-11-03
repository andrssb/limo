import type { FastifyInstance } from "fastify";
import { getDb } from "@limo/db";
import { crmConnections } from "@limo/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import {
  getHubSpotAuthUrl,
  exchangeHubSpotCode,
} from "../services/crm/hubspot.js";
import {
  getPipedriveAuthUrl,
  exchangePipedriveCode,
} from "../services/crm/pipedrive.js";
import {
  getSalesforceAuthUrl,
  exchangeSalesforceCode,
} from "../services/crm/salesforce.js";

export async function crmRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();
  fastify.addHook("preHandler", requireAuth);

  fastify.get("/crm/connections", async (request, reply) => {
    const { id: userId } = request.user;
    const connections = await db.select({
      id: crmConnections.id,
      provider: crmConnections.provider,
      expiresAt: crmConnections.expiresAt,
      pipelineId: crmConnections.pipelineId,
      createdAt: crmConnections.createdAt,
    }).from(crmConnections).where(eq(crmConnections.userId, userId));

    return reply.send({ connections });
  });

  // ── HubSpot ──────────────────────────────────────────────────────────────

  fastify.get("/crm/hubspot/auth-url", async (_request, reply) => {
    return reply.send({ url: getHubSpotAuthUrl() });
  });

  fastify.post("/crm/hubspot/callback", async (request, reply) => {
    const { id: userId } = request.user;
    const { code } = request.body as { code: string };
    const tokens = await exchangeHubSpotCode(code);

    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
    await db.insert(crmConnections).values({
      userId,
      provider: "hubspot",
      accessToken: encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken),
      expiresAt,
    }).onConflictDoUpdate({
      target: [crmConnections.userId, crmConnections.provider],
      set: {
        accessToken: encrypt(tokens.accessToken),
        refreshToken: encrypt(tokens.refreshToken),
        expiresAt,
        updatedAt: new Date(),
      },
    });

    return reply.send({ success: true, provider: "hubspot" });
  });

  // ── Pipedrive ────────────────────────────────────────────────────────────

  fastify.get("/crm/pipedrive/auth-url", async (_request, reply) => {
    return reply.send({ url: getPipedriveAuthUrl() });
  });

  fastify.post("/crm/pipedrive/callback", async (request, reply) => {
    const { id: userId } = request.user;
    const { code } = request.body as { code: string };
    const tokens = await exchangePipedriveCode(code);

    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
    await db.insert(crmConnections).values({
      userId,
      provider: "pipedrive",
      accessToken: encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken),
      expiresAt,
    }).onConflictDoUpdate({
      target: [crmConnections.userId, crmConnections.provider],
      set: {
        accessToken: encrypt(tokens.accessToken),
        refreshToken: encrypt(tokens.refreshToken),
        expiresAt,
        updatedAt: new Date(),
      },
    });

    return reply.send({ success: true, provider: "pipedrive" });
  });

  // ── Salesforce ───────────────────────────────────────────────────────────

  fastify.get("/crm/salesforce/auth-url", async (_request, reply) => {
    return reply.send({ url: getSalesforceAuthUrl() });
  });

  fastify.post("/crm/salesforce/callback", async (request, reply) => {
    const { id: userId } = request.user;
    const { code } = request.body as { code: string };
    const tokens = await exchangeSalesforceCode(code);

    const sfExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h
    await db.insert(crmConnections).values({
      userId,
      provider: "salesforce",
      accessToken: encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken ?? ""),
      expiresAt: sfExpiresAt,
      fieldMappings: { instanceUrl: tokens.instanceUrl },
    }).onConflictDoUpdate({
      target: [crmConnections.userId, crmConnections.provider],
      set: {
        accessToken: encrypt(tokens.accessToken),
        refreshToken: encrypt(tokens.refreshToken ?? ""),
        expiresAt: sfExpiresAt,
        fieldMappings: { instanceUrl: tokens.instanceUrl },
        updatedAt: new Date(),
      },
    });

    return reply.send({ success: true, provider: "salesforce" });
  });

  // ── Disconnect ───────────────────────────────────────────────────────────

  fastify.delete("/crm/:provider", async (request, reply) => {
    const { id: userId } = request.user;
    const { provider } = request.params as { provider: string };

    await db.delete(crmConnections).where(
      and(eq(crmConnections.userId, userId), eq(crmConnections.provider, provider as any))
    );
    return reply.send({ success: true });
  });
}
