import React, { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { Mic2, CheckCircle2 } from "lucide-react";

export function CoachingLivePage() {
  const [status, setStatus]     = useState<"idle" | "active" | "ended">("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const sessionRef  = useRef<string | null>(null);

  useEffect(() => () => stopAll(), []);

  function stopAll() {
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    streamRef.current   = null;
    if (sessionRef.current) {
      apiFetch(`/coaching/${sessionRef.current}/end`, { method: "POST", body: "{}" }).catch(() => {});
    }
  }

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      const { sessionId: sid } = await apiFetch<{ sessionId: string }>("/coaching/start", {
        method: "POST", body: "{}",
      });
      setSessionId(sid);
      sessionRef.current = sid;

      // Notify opener (extension side panel) of the session ID
      if (window.opener) {
        window.opener.postMessage({ type: "COACHING_SESSION_STARTED", sessionId: sid }, "*");
      }

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = async (e) => {
        if (e.data.size < 500 || !sessionRef.current) return;
        setProcessing(true);
        try {
          const base64 = await blobToBase64(e.data);
          const data = await apiFetch<any>(`/coaching/${sessionRef.current}/chunk`, {
            method: "POST",
            body: JSON.stringify({ audio: base64, mimeType }),
          });
          if (!data.skipped && data.transcript) {
            setTranscript((p) => (p + " " + data.transcript).trim());
          }
          // Forward tips to opener
          if (!data.skipped && data.tips?.length && window.opener) {
            window.opener.postMessage({ type: "COACHING_TIPS", tips: data.tips }, "*");
          }
        } catch { /* ignore */ }
        finally { setProcessing(false); }
      };

      recorder.start(10000);
      setStatus("active");
    } catch (err: any) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setError(err.name === "NotAllowedError"
        ? "Permita o acesso ao microfone quando o browser perguntar."
        : (err.message ?? "Erro ao iniciar"));
    }
  }

  async function stop() {
    stopAll();
    setStatus("ended");
    if (window.opener) {
      window.opener.postMessage({ type: "COACHING_ENDED" }, "*");
    }
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onloadend = () => res((r.result as string).split(",")[1]);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#1a2332", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Nunito Sans', sans-serif", padding: 24,
    }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ marginBottom: 8, color: "#a3e635" }}><Mic2 size={40} strokeWidth={1.5} /></div>
        <div style={{ fontSize: 20, fontWeight: 900, color: "#a3e635", marginBottom: 4 }}>Coaching ao Vivo</div>
        <div style={{ fontSize: 13, color: "#8898aa" }}>As sugestões aparecem no side panel da extensão</div>
      </div>

      {status === "idle" && (
        <div style={{ textAlign: "center" }}>
          <button onClick={start} style={{
            background: "#a3e635", color: "#1a2332", border: "none", borderRadius: 10,
            padding: "14px 36px", fontSize: 15, fontWeight: 900, cursor: "pointer",
          }}>
            Iniciar Coaching
          </button>
          {error && <div style={{ marginTop: 16, color: "#ef4444", fontSize: 13 }}>{error}</div>}
        </div>
      )}

      {status === "active" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 20 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.5s ease-in-out infinite" }} />
            <span style={{ color: "#ef4444", fontWeight: 700, fontSize: 15 }}>Gravando</span>
            {processing && <span style={{ color: "#8898aa", fontSize: 13 }}>processando...</span>}
          </div>
          {transcript && (
            <div style={{ maxWidth: 400, fontSize: 12, color: "#8898aa", marginBottom: 20, lineHeight: 1.6, maxHeight: 80, overflowY: "auto" }}>
              {transcript.slice(-300)}
            </div>
          )}
          <button onClick={stop} style={{
            background: "#374151", color: "#ef4444", border: "1px solid #ef4444",
            borderRadius: 8, padding: "10px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer",
          }}>
            ■ Encerrar
          </button>
        </div>
      )}

      {status === "ended" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 12, color: "#a3e635" }}><CheckCircle2 size={32} strokeWidth={1.5} /></div>
          <div style={{ color: "#a3e635", fontWeight: 700, marginBottom: 16 }}>Sessão encerrada</div>
          <button onClick={() => { setStatus("idle"); setTranscript(""); setSessionId(null); sessionRef.current = null; }} style={{
            background: "#a3e635", color: "#1a2332", border: "none", borderRadius: 8,
            padding: "10px 24px", fontSize: 14, fontWeight: 900, cursor: "pointer",
          }}>
            Nova sessão
          </button>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}
