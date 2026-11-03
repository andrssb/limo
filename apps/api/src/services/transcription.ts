import { createReadStream } from "fs";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import type { TranscriptSegment } from "@limo/types";
import { groq, MODELS } from "../lib/groq.js";

export async function transcribeAudioBuffer(
  audioBuffer: Buffer,
  mimeType: string = "audio/webm",
  forceSpeaker?: TranscriptSegment["speaker"]
): Promise<{ text: string; segments: TranscriptSegment[] }> {
  const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("mp3") ? "mp3" : "webm";
  const tmpPath = join(tmpdir(), `limo-${randomUUID()}.${ext}`);

  try {
    await writeFile(tmpPath, audioBuffer);

    const transcription = await groq.audio.transcriptions.create({
      file: createReadStream(tmpPath) as any,
      model: MODELS.whisper,
      language: "pt",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });

    const segments = buildSegments(transcription as any, forceSpeaker);
    return { text: transcription.text, segments };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

export async function transcribeAudioUrl(audioUrl: string): Promise<{
  text: string;
  segments: TranscriptSegment[];
}> {
  const response = await fetch(audioUrl);
  if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "audio/webm";
  return transcribeAudioBuffer(buffer, contentType);
}

/**
 * DIARIZAÇÃO REAL: cada lado da conversa vem numa trilha mono separada
 * (SDR = microfone; lead = áudio da aba/remoto). Transcrevemos cada trilha
 * isoladamente — então cada segmento JÁ pertence a um único falante conhecido —
 * e mesclamos por ordem cronológica. Substitui o palpite `i % 2` do single-track.
 */
export async function transcribeTwoTracks(
  sdrTrack: { buffer: Buffer; mimeType?: string },
  leadTrack: { buffer: Buffer; mimeType?: string }
): Promise<{ text: string; segments: TranscriptSegment[] }> {
  const [sdr, lead] = await Promise.all([
    transcribeAudioBuffer(sdrTrack.buffer, sdrTrack.mimeType ?? "audio/webm", "sdr"),
    transcribeAudioBuffer(leadTrack.buffer, leadTrack.mimeType ?? "audio/webm", "lead"),
  ]);

  return mergeTracks(sdr.segments, lead.segments);
}

export async function transcribeTwoTrackUrls(
  sdrAudioUrl: string,
  leadAudioUrl: string
): Promise<{ text: string; segments: TranscriptSegment[] }> {
  const [sdrBuf, leadBuf] = await Promise.all([
    fetchAudio(sdrAudioUrl),
    fetchAudio(leadAudioUrl),
  ]);
  return transcribeTwoTracks(sdrBuf, leadBuf);
}

async function fetchAudio(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status}`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    mimeType: res.headers.get("content-type") ?? "audio/webm",
  };
}

/** Mescla segmentos de duas trilhas já rotuladas, ordenando por início. */
function mergeTracks(
  a: TranscriptSegment[],
  b: TranscriptSegment[]
): { text: string; segments: TranscriptSegment[] } {
  const segments = [...a, ...b].sort((x, y) => x.startMs - y.startMs);
  const text = segments
    .map((s) => `${s.speaker === "sdr" ? "BDR" : "Lead"}: ${s.text}`)
    .join("\n");
  return { text, segments };
}

function buildSegments(
  verboseJson: {
    segments?: Array<{
      start: number;
      end: number;
      text: string;
      avg_logprob?: number;
    }>;
  },
  forceSpeaker?: TranscriptSegment["speaker"]
): TranscriptSegment[] {
  if (!verboseJson.segments) return [];

  return verboseJson.segments.map((s, i) => ({
    // Quando a trilha já é de um único falante (2-track), o rótulo é confiável.
    // No single-track misto, mantemos o palpite alternado como heurística.
    speaker: forceSpeaker ?? (i % 2 === 0 ? "sdr" : "lead"),
    text: s.text.trim(),
    startMs: Math.round(s.start * 1000),
    endMs: Math.round(s.end * 1000),
    confidence: s.avg_logprob ? Math.min(1, Math.exp(s.avg_logprob)) : 0.9,
  }));
}

export async function transcribeAudioMessage(audioBuffer: Buffer): Promise<string> {
  const result = await transcribeAudioBuffer(audioBuffer, "audio/ogg");
  return result.text;
}
