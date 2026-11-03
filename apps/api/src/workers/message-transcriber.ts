import { Worker } from "bullmq";
import { createRedis } from "../lib/redis.js";
import { getDb } from "@limo/db";
import { messages } from "@limo/db";
import { eq } from "drizzle-orm";
import { transcribeAudioMessage } from "../services/transcription.js";
import { QUEUES, type MessageTranscribeJob } from "../lib/queue.js";
import { readFile, unlink } from "fs/promises";

export function startMessageTranscriberWorker(): Worker {
  const worker = new Worker<MessageTranscribeJob>(
    QUEUES.MESSAGE_TRANSCRIBE,
    async (job) => {
      const { messageId, audioUrl } = job.data;
      const db = getDb();

      let buffer: Buffer;
      if (audioUrl.startsWith("/") || audioUrl.startsWith("file://")) {
        const filePath = audioUrl.replace("file://", "");
        buffer = await readFile(filePath);
        await unlink(filePath).catch(() => {});
      } else {
        const response = await fetch(audioUrl);
        if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);
        buffer = Buffer.from(await response.arrayBuffer());
      }

      const transcription = await transcribeAudioMessage(buffer);

      await db.update(messages)
        .set({ transcription })
        .where(eq(messages.id, messageId));

      job.log(`Message ${messageId} transcribed: "${transcription.slice(0, 80)}"`);
    },
    { connection: createRedis(), concurrency: 5 }
  );

  worker.on("failed", (job, err) => {
    if (!job) return;
    console.error(`[MessageTranscriber] Job ${job.id} failed:`, err.message);
  });

  return worker;
}
