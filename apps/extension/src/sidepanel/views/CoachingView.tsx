import React, { useState, useRef, useEffect } from "react";
import { Mic, CheckCircle2, Square, Zap, Ear, ArrowLeft } from "lucide-react";
import { useStore } from "../../store.js";
import { apiFetch } from "../../lib/api.js";
import { T } from "../theme.js";

const COACHING_URL = "https://app.limoapp.com.br/coaching-live";

const TIP_COLORS: Record<string, string> = {
  question:  "#3b82f6",
  technique: "#a3e635",
  objection: "#f97316",
  mirror:    "#8b5cf6",
  close:     "#22c55e",
};
const TIP_LABELS: Record<string, string> = {
  question:  "Pergunta",
  technique: "Técnica",
  objection: "Objeção",
  mirror:    "Espelho",
  close:     "Fechamento",
};

interface Tip { type: string; label: string; content: string; urgency: string; }

export function CoachingView() {
  const { setView }                   = useStore();
  const [status, setStatus]           = useState<"idle" | "active" | "ended">("idle");
  const [tips, setTips]               = useState<Tip[]>([]);
  const [transcript, setTranscript]   = useState("");
  const [sessionId, setSessionId]     = useState<string | null>(null);
  const popupRef  = useRef<Window | null>(null);
  const tipsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { tipsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [tips]);

  // Listen for messages from the coaching page
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== "https://app.limoapp.com.br") return;

      if (e.data?.type === "COACHING_SESSION_STARTED") {
        setSessionId(e.data.sessionId);
        setStatus("active");
      }
      if (e.data?.type === "COACHING_TIPS" && e.data.tips?.length) {
        setTips((p) => [...e.data.tips, ...p].slice(0, 10));
      }
      if (e.data?.type === "COACHING_ENDED") {
        setStatus("ended");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Detect popup closed externally
  useEffect(() => {
    if (status !== "active") return;
    const t = setInterval(() => {
      if (popupRef.current?.closed) {
        clearInterval(t);
        setStatus("ended");
      }
    }, 1000);
    return () => clearInterval(t);
  }, [status]);

  function openCoachingPage() {
    setTips([]);
    setTranscript("");
    setSessionId(null);
    setStatus("idle");
    const popup = window.open(COACHING_URL, "limo_coaching",
      "width=380,height=320,left=200,top=100,resizable=no,toolbar=no,menubar=no");
    popupRef.current = popup;
  }

  function endSession() {
    popupRef.current?.close();
    if (sessionId) {
      apiFetch(`/coaching/${sessionId}/end`, { method: "POST", body: "{}" }).catch(() => {});
    }
    setStatus("ended");
  }

  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, background: T.bg, minHeight: "calc(100vh - 56px)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 900, color: T.text }}>Coaching ao Vivo</div>
          <div style={{ fontSize: 11, color: T.muted }}>IA ouve e sugere em tempo real</div>
        </div>
        <button onClick={() => { endSession(); setView("home"); }}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: T.muted, fontFamily: "inherit", fontWeight: 900, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <ArrowLeft size={13} /> voltar
        </button>
      </div>

      {/* Status card */}
      <div style={{ background: T.card, borderRadius: 10, border: `1px solid ${T.border}`, padding: 14 }}>
        {status === "idle" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 10, color: T.green, display: "flex", justifyContent: "center" }}><Mic size={34} /></div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 6 }}>Coaching automático nas reuniões</div>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 16, lineHeight: 1.5 }}>
              Em chamadas do <strong>Google Meet</strong> e <strong>Teams</strong>, o Coaching IA aparece
              sozinho na tela da reunião — é só tocar em <strong>Ativar coaching</strong> no widget da Limo.
              A IA ouve os dois lados e sugere em tempo real, ali mesmo.
            </div>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>
              Está numa ligação fora do Meet/Teams? Use o modo manual (captura só o seu microfone):
            </div>
            <button onClick={openCoachingPage} style={{
              background: "none", color: T.green, border: `1px solid ${T.green}`, borderRadius: 8,
              padding: "8px 18px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
              <Mic size={14} /> Coaching manual
            </button>
          </div>
        )}

        {status === "active" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.5s ease-in-out infinite" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#ef4444" }}>Gravando</span>
              </div>
              <button onClick={endSession} style={{
                background: "#fee2e2", color: "#ef4444", border: "none", borderRadius: 6,
                padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}>
                <Square size={11} fill="currentColor" /> Encerrar
              </button>
            </div>
            <div style={{ fontSize: 11, color: T.muted }}>
              Sessão: {sessionId?.slice(0, 8)}...
            </div>
          </div>
        )}

        {status === "ended" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 8, color: T.green, display: "flex", justifyContent: "center" }}><CheckCircle2 size={30} /></div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 12 }}>Sessão encerrada</div>
            <button onClick={() => { setStatus("idle"); setTips([]); setSessionId(null); }}
              style={{ background: T.green, color: "#1a2332", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>
              Nova sessão
            </button>
          </div>
        )}
      </div>

      {/* Tips */}
      {tips.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Sugestões da IA
          </div>
          {tips.slice(0, 5).map((tip, i) => (
            <div key={i} style={{
              background: T.card, borderRadius: 8, padding: "10px 12px",
              border: `1px solid ${T.border}`, borderLeftWidth: 3,
              borderLeftColor: TIP_COLORS[tip.type] ?? T.green,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: TIP_COLORS[tip.type] ?? T.green, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {TIP_LABELS[tip.type] ?? tip.type}
                </span>
                {tip.urgency === "high" && <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, color: T.red, fontWeight: 700 }}><Zap size={10} /> AGORA</span>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 2 }}>{tip.label}</div>
              <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>{tip.content}</div>
            </div>
          ))}
          <div ref={tipsEndRef} />
        </div>
      )}

      {status === "active" && tips.length === 0 && (
        <div style={{ textAlign: "center", padding: "30px 20px", color: T.muted, fontSize: 12 }}>
          <div style={{ marginBottom: 8, color: T.muted, display: "flex", justifyContent: "center" }}><Ear size={26} /></div>
          Ouvindo... Sugestões aparecem após ~10s de conversa.
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}
