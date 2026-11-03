import { Worker } from "bullmq";
import { createRedis } from "../lib/redis.js";
import { getDb } from "@limo/db";
import { contacts, crmConnections, calls, callAnalyses } from "@limo/db";
import { eq, and } from "drizzle-orm";
import { decrypt, encrypt } from "../lib/crypto.js";
import {
  upsertHubSpotContact,
  logHubSpotCall,
  refreshHubSpotToken,
} from "../services/crm/hubspot.js";
import {
  upsertPipedriveContact,
  logPipedriveActivity,
  refreshPipedriveToken,
} from "../services/crm/pipedrive.js";
import {
  upsertSalesforceContact,
  logSalesforceTask,
  refreshSalesforceToken,
} from "../services/crm/salesforce.js";
import { QUEUES, type CRMSyncJob } from "../lib/queue.js";
import type { Contact, Call, CallAnalysis } from "@limo/types";

type ConnRow = typeof crmConnections.$inferSelect;

// Refresh token if within 5 minutes of expiry; persist new tokens to DB.
async function ensureFreshToken(conn: ConnRow): Promise<{ accessToken: string; instanceUrl?: string }> {
  const db = getDb();
  const isExpired = conn.expiresAt && conn.expiresAt.getTime() < Date.now() + 5 * 60 * 1000;

  if (!isExpired) {
    return {
      accessToken: decrypt(conn.accessToken),
      instanceUrl: (conn.fieldMappings as any)?.instanceUrl,
    };
  }

  const refreshToken = conn.refreshToken ? decrypt(conn.refreshToken) : null;
  if (!refreshToken) throw new Error(`${conn.provider} token expired with no refresh token`);

  if (conn.provider === "hubspot") {
    const t = await refreshHubSpotToken(refreshToken);
    await db.update(crmConnections).set({
      accessToken: encrypt(t.accessToken),
      refreshToken: encrypt(t.refreshToken),
      expiresAt: new Date(Date.now() + t.expiresIn * 1000),
      updatedAt: new Date(),
    }).where(eq(crmConnections.id, conn.id));
    return { accessToken: t.accessToken };
  }

  if (conn.provider === "pipedrive") {
    const t = await refreshPipedriveToken(refreshToken);
    await db.update(crmConnections).set({
      accessToken: encrypt(t.accessToken),
      refreshToken: encrypt(t.refreshToken),
      expiresAt: new Date(Date.now() + t.expiresIn * 1000),
      updatedAt: new Date(),
    }).where(eq(crmConnections.id, conn.id));
    return { accessToken: t.accessToken };
  }

  if (conn.provider === "salesforce") {
    const t = await refreshSalesforceToken(refreshToken);
    const existingMappings = (conn.fieldMappings as any) ?? {};
    await db.update(crmConnections).set({
      accessToken: encrypt(t.accessToken),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      fieldMappings: { ...existingMappings, instanceUrl: t.instanceUrl },
      updatedAt: new Date(),
    }).where(eq(crmConnections.id, conn.id));
    return { accessToken: t.accessToken, instanceUrl: t.instanceUrl };
  }

  throw new Error(`Unknown provider: ${conn.provider}`);
}

export function startCRMSyncWorker(): Worker {
  return new Worker<CRMSyncJob>(
    QUEUES.CRM_SYNC,
    async (job) => {
      const { contactId, userId, provider, callId } = job.data;
      const db = getDb();

      const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
      if (!contact) throw new Error(`Contact ${contactId} not found`);

      const connections = await db.select().from(crmConnections).where(
        and(
          eq(crmConnections.userId, userId),
          provider ? eq(crmConnections.provider, provider as any) : undefined
        )
      );

      // Pre-fetch call + analysis once (reused across all CRM connections)
      let call: typeof calls.$inferSelect | null = null;
      let analysis: typeof callAnalyses.$inferSelect | null = null;
      if (callId) {
        const [callRow] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
        call = callRow ?? null;
        if (call) {
          const [analysisRow] = await db.select().from(callAnalyses)
            .where(eq(callAnalyses.callId, callId)).limit(1);
          analysis = analysisRow ?? null;
        }
      }

      for (const conn of connections) {
        try {
          const { accessToken, instanceUrl } = await ensureFreshToken(conn);

          if (conn.provider === "hubspot") {
            const crmId = await upsertHubSpotContact(contact as unknown as Contact, accessToken);
            await db.update(contacts).set({ crmId, crmProvider: "hubspot" }).where(eq(contacts.id, contactId));
            job.log(`Synced to HubSpot: ${crmId}`);

            if (call) {
              await logHubSpotCall(crmId, call as unknown as Call, analysis as unknown as CallAnalysis | null, accessToken);
              job.log(`Logged call ${call.id} to HubSpot`);
            }
          } else if (conn.provider === "pipedrive") {
            const crmId = await upsertPipedriveContact(contact as unknown as Contact, accessToken);
            await db.update(contacts).set({ crmId, crmProvider: "pipedrive" }).where(eq(contacts.id, contactId));
            job.log(`Synced to Pipedrive: ${crmId}`);

            if (call) {
              await logPipedriveActivity(crmId, call as unknown as Call, analysis as unknown as CallAnalysis | null, accessToken);
              job.log(`Logged call ${call.id} to Pipedrive`);
            }
          } else if (conn.provider === "salesforce") {
            const sfInstanceUrl = instanceUrl ?? (conn.fieldMappings as any)?.instanceUrl ?? "";
            const crmId = await upsertSalesforceContact(contact as unknown as Contact, accessToken, sfInstanceUrl);
            await db.update(contacts).set({ crmId, crmProvider: "salesforce" }).where(eq(contacts.id, contactId));
            job.log(`Synced to Salesforce: ${crmId}`);

            if (call) {
              await logSalesforceTask(crmId, call as unknown as Call, analysis as unknown as CallAnalysis | null, accessToken, sfInstanceUrl);
              job.log(`Logged call ${call.id} to Salesforce`);
            }
          }
        } catch (err) {
          console.error(`[CRMSync] Failed for ${conn.provider}:`, (err as Error).message);
        }
      }
    },
    { connection: createRedis(), concurrency: 5 }
  );
}
