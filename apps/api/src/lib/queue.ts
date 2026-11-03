import { Queue, Worker, type Job } from "bullmq";
import { getRedis } from "./redis.js";

const connection = getRedis();

// ─── Queue names ─────────────────────────────────────────────────────────────

export const QUEUES = {
  CALL_PROCESS: "call-process",
  CRM_SYNC: "crm-sync",
  AUDIO_TRANSCRIBE: "audio-transcribe",
  WEEKLY_REPORT: "weekly-report",
  MESSAGE_TRANSCRIBE: "message-transcribe",
  GARIMPO:           "garimpo",
  ENRICHMENT_DAILY:  "enrichment-daily",
  PASSIVE_ENGINE:    "passive-engine",
} as const;

// ─── Typed job payloads ───────────────────────────────────────────────────────

export interface CallProcessJob {
  callId: string;
  userId: string;
}

export interface CRMSyncJob {
  contactId: string;
  userId: string;
  provider?: string;
  callId?: string;
}

export interface AudioTranscribeJob {
  callId: string;
  audioUrl: string;
}

export interface WeeklyReportJob {
  teamId: string;
}

export interface MessageTranscribeJob {
  messageId: string;
  audioUrl: string;
}

export interface DailyEnrichmentJob {
  type:        "enrich-companies" | "complete-contacts" | "revalidate-stale" | "flag-obsolete";
  batchSize?:  number;
  maxAgeDays?: number;
  offset?:     number;
}

export interface GarimpoJob {
  runId: string;
  personaId: string;
  listId: string;
  userId: string;
  teamId: string;
  maxContacts?: number; // teto de contatos por run definido pelo gestor (Fase 5/#5)
}

export interface PassiveEngineJob {
  runId: string;
  triggeredBy: "cron" | "manual";
  triggeredByUserId?: string;
  maxDurationMinutes?: number;  // defaults to 720 (12h) in the worker
  state?: string;               // 2-letter UF filter (worker rotates if absent)
}

// ─── Queue instances ──────────────────────────────────────────────────────────

const queues: Record<string, Queue> = {};

export function getQueue(name: string): Queue {
  if (!queues[name]) {
    queues[name] = new Queue(name, { connection });
  }
  return queues[name];
}

export function addJob<T>(queueName: string, jobName: string, data: T, opts?: object) {
  return getQueue(queueName).add(jobName, data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
    ...opts,
  });
}
