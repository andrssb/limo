import { getDb } from "@limo/db";
import { calls } from "@limo/db";
import { addJob, QUEUES } from "../lib/queue.js";
import type { CallChannel, CallDirection, CallType } from "@limo/types";

/**
 * Camada de ingestão AGNÓSTICA AO CANAL (Fase 0 do Coaching IA).
 *
 * Toda fonte de áudio cai aqui numa forma normalizada — navegador (tabCapture +
 * microfone, 2 trilhas), VoIP (gravação única via webhook do provedor) ou upload.
 * O motor de transcrição/análise não precisa saber a origem: ele só recebe um
 * `call` com `audioUrl` (mono/misto) e/ou `sdrAudioUrl`+`leadAudioUrl` (diarização
 * real). É a "pré-integração universal": qualquer VoIP que consiga mandar uma
 * gravação + metadados pluga aqui, e o adaptador específico do cliente (tradução
 * do payload do provedor pra esta forma) é o único pedaço que muda por cliente.
 */
export interface IngestCallInput {
  userId: string;
  /** Opcional: reunião sem contato do CRM vinculado (ex.: Meet de qualificação). */
  contactId?: string | null;
  channel: CallChannel;
  direction?: CallDirection;
  /** Mapeado pra coluna `type` (legado). Default derivado do canal. */
  type?: CallType;
  startedAt?: Date;
  endedAt?: Date | null;
  durationSeconds?: number | null;
  /** Gravação única (mista/mono). Típico de VoIP e upload. */
  audioUrl?: string | null;
  /** Trilhas separadas (microfone do SDR / áudio do lead). Habilita diarização real. */
  sdrAudioUrl?: string | null;
  leadAudioUrl?: string | null;
  /** Metadados crus do provedor (nome, id externo da chamada, payload) — opcional. */
  sourceMeta?: Record<string, unknown> | null;
}

function defaultTypeForChannel(channel: CallChannel): CallType {
  if (channel === "whatsapp") return "whatsapp";
  if (channel === "upload") return "imported";
  return "manual"; // browser, voip
}

export async function ingestCall(input: IngestCallInput): Promise<{ callId: string }> {
  const db = getDb();

  const hasTracks = !!(input.sdrAudioUrl && input.leadAudioUrl);
  const hasAudio = hasTracks || !!input.audioUrl;

  const [call] = await db
    .insert(calls)
    .values({
      userId: input.userId,
      contactId: input.contactId ?? null,
      type: input.type ?? defaultTypeForChannel(input.channel),
      direction: input.direction ?? "outbound",
      channel: input.channel,
      startedAt: input.startedAt ?? new Date(),
      endedAt: input.endedAt ?? null,
      durationSeconds: input.durationSeconds ?? null,
      audioUrl: input.audioUrl ?? null,
      sdrAudioUrl: input.sdrAudioUrl ?? null,
      leadAudioUrl: input.leadAudioUrl ?? null,
      sourceMeta: (input.sourceMeta ?? null) as any,
      // Sem áudio ainda → fica "pending" aguardando upload posterior.
      transcriptionStatus: hasAudio ? "pending" : "pending",
      analysisStatus: "pending",
    })
    .returning();

  // Só enfileira o processamento quando já há áudio pra transcrever.
  if (hasAudio) {
    await addJob(QUEUES.CALL_PROCESS, "process-call", {
      callId: call.id,
      userId: input.userId,
    });
  }

  return { callId: call.id };
}
