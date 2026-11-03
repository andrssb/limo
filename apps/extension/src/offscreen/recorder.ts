// Offscreen recorder — captura os DOIS lados da conversa em trilhas separadas:
//   • SDR  = microfone (getUserMedia)
//   • lead = áudio da aba (tabCapture, via streamId entregue pelo background)
// Faz DUAS coisas com cada trilha:
//   1) envia chunks de 10s rotulados → coaching AO VIVO (tips em tempo real)
//   2) ACUMULA a gravação inteira → ao encerrar, sobe as trilhas completas e
//      manda as URLs pro background, que cria a call (/calls/ingest) p/ a
//      ANÁLISE PÓS-CALL com diarização real (Fase 0 + item 5).
//
// Mensagens:
//   background → offscreen: { type: "COACHING_START_RECORDING", tabStreamId }
//                           { type: "COACHING_STOP_RECORDING" }
//   offscreen → background: { type: "COACHING_AUDIO_CHUNK", speaker, data, mimeType }  (ao vivo)
//                           { type: "COACHING_RECORDING_STARTED" }
//                           { type: "COACHING_MIC_ERROR", error }
//                           { type: "COACHING_FULL_TRACKS", sdrAudioUrl, leadAudioUrl?, durationMs }

const API_BASE = "https://api.limoapp.com.br/v1";

interface Track {
  recorder: MediaRecorder;
  stream: MediaStream;
  speaker: "sdr" | "lead";
  mimeType: string;
  chunks: Blob[]; // gravação completa acumulada
}

let micTrack: Track | null = null;
let tabTrack: Track | null = null;
let audioCtx: AudioContext | null = null;
let startedAt = 0;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "COACHING_START_RECORDING") startRecording(msg.tabStreamId);
  if (msg.type === "COACHING_STOP_RECORDING") stopRecording();
});

function pickMime(): string {
  return MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
}

function makeTrack(stream: MediaStream, speaker: "sdr" | "lead", mimeType: string): Track {
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = async (e) => {
    if (e.data.size === 0) return;
    chunks.push(e.data); // acumula p/ a gravação completa
    if (e.data.size < 500) return;
    // chunk ao vivo (tips em tempo real)
    const buffer = await e.data.arrayBuffer();
    chrome.runtime.sendMessage({
      type: "COACHING_AUDIO_CHUNK",
      speaker,
      data: Array.from(new Uint8Array(buffer)),
      mimeType,
    });
  };
  recorder.start(10000); // chunks de 10s
  return { recorder, stream, speaker, mimeType, chunks };
}

async function startRecording(tabStreamId?: string) {
  const mimeType = pickMime();
  startedAt = Date.now();
  try {
    // ── SDR: microfone ──────────────────────────────────────────────────────
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micTrack = makeTrack(micStream, "sdr", mimeType);

    // ── Lead: áudio da aba (se o background mandou um streamId) ──────────────
    if (tabStreamId) {
      const tabStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: tabStreamId },
        },
      } as any);

      // tabCapture silencia a aba por padrão — repassamos o áudio de volta pros
      // alto-falantes pra que o usuário continue ouvindo a chamada normalmente.
      audioCtx = new AudioContext();
      audioCtx.createMediaStreamSource(tabStream).connect(audioCtx.destination);

      tabTrack = makeTrack(tabStream, "lead", mimeType);
    }

    chrome.runtime.sendMessage({ type: "COACHING_RECORDING_STARTED" });
  } catch (err: any) {
    await stopRecording();
    chrome.runtime.sendMessage({ type: "COACHING_MIC_ERROR", error: err?.message ?? String(err) });
  }
}

/** Para o recorder e resolve quando o último chunk chegou (evento onstop). */
function stopTrack(track: Track | null): Promise<Track | null> {
  return new Promise((resolve) => {
    if (!track) return resolve(null);
    track.recorder.onstop = () => resolve(track);
    try {
      if (track.recorder.state !== "inactive") track.recorder.stop();
      else resolve(track);
    } catch {
      resolve(track);
    }
  });
}

async function stopRecording() {
  const durationMs = startedAt ? Date.now() - startedAt : 0;

  const [sdr, lead] = await Promise.all([stopTrack(micTrack), stopTrack(tabTrack)]);

  // Encerra as trilhas de mídia e o passthrough de áudio
  micTrack?.stream.getTracks().forEach((t) => t.stop());
  tabTrack?.stream.getTracks().forEach((t) => t.stop());
  try { await audioCtx?.close(); } catch { /* ignore */ }
  micTrack = null; tabTrack = null; audioCtx = null; startedAt = 0;

  // Sobe as gravações completas e avisa o background pra criar a call pós-call.
  await uploadFullTracks(sdr, lead, durationMs);
}

async function uploadFullTracks(sdr: Track | null, lead: Track | null, durationMs: number) {
  try {
    const sdrAudioUrl = sdr && sdr.chunks.length ? await uploadTrack(sdr) : null;
    const leadAudioUrl = lead && lead.chunks.length ? await uploadTrack(lead) : null;
    if (!sdrAudioUrl && !leadAudioUrl) return;
    chrome.runtime.sendMessage({ type: "COACHING_FULL_TRACKS", sdrAudioUrl, leadAudioUrl, durationMs });
  } catch { /* upload best-effort: a sessão ao vivo já foi entregue */ }
}

async function uploadTrack(track: Track): Promise<string | null> {
  const blob = new Blob(track.chunks, { type: track.mimeType });
  if (blob.size < 1000) return null;

  const token = await getToken();
  const form = new FormData();
  form.append("audio", blob, `${track.speaker}.webm`);

  const res = await fetch(`${API_BASE}/calls/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { url?: string };
  return data.url ?? null;
}

function getToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["accessToken"], (r) => resolve(r.accessToken ?? null));
  });
}
