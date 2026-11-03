import React, { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Mail, Phone, Zap, MessageCircle, Music, Clock, X } from "lucide-react";
import { useStore } from "../../store.js";
import { apiFetch } from "../../lib/api.js";
import { T } from "../theme.js";
import type { Call, CallAnalysis, Message } from "@limo/types";

export function ContactView() {
  const { activeContact, setView, setActiveContact } = useStore();
  const [calls, setCalls] = useState<Call[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeCallAnalysis, setActiveCallAnalysis] = useState<CallAnalysis | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  useEffect(() => {
    if (!activeContact) return;
    apiFetch<{ data: Call[] }>(`/calls?contactId=${activeContact.id}&pageSize=10`).then((r) => setCalls(r.data)).catch(console.error);
    apiFetch<{ data: Message[] }>(`/whatsapp/messages?contactId=${activeContact.id}&pageSize=20`).then((r) => setMessages(r.data)).catch(console.error);
  }, [activeContact?.id]);

  if (!activeContact) return null;

  async function loadAnalysis(callId: string) {
    try {
      const res = await apiFetch<{ analysis: CallAnalysis }>(`/calls/${callId}/analysis`);
      setActiveCallAnalysis(res.analysis);
      setShowAnalysis(true);
    } catch {
      alert("Análise ainda não disponível");
    }
  }

  async function syncToCRM() {
    await apiFetch(`/contacts/${activeContact!.id}/sync-crm`, { method: "POST", body: JSON.stringify({}) });
    alert("Sincronização enfileirada!");
  }

  const tempColor: Record<string, string> = { hot: T.red, warm: T.yellow, cold: T.blue };
  const resultColors: Record<string, string> = { positive: T.greenInk, negative: T.red, neutral: T.yellow, inconclusive: T.muted };

  return (
    <div style={{ padding: "12px", background: T.bg, minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <button onClick={() => { setView("home"); setActiveContact(null); }} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center" }}><ArrowLeft size={16} /></button>
        <span style={{ fontSize: "11px", color: T.muted, textTransform: "uppercase", letterSpacing: "1px" }}>Perfil do Lead</span>
      </div>

      {/* Contact header */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "10px", padding: "14px", marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 900, color: T.text }}>{activeContact.firstName} {activeContact.lastName}</div>
            <div style={{ fontSize: "12px", color: T.muted, marginTop: "2px" }}>{activeContact.jobTitle ?? "—"}</div>
            <div style={{ fontSize: "12px", color: T.muted }}>{activeContact.companyName ?? "—"}</div>
          </div>
          <span style={{ fontSize: "10px", fontWeight: 900, color: tempColor[activeContact.temperature], border: `1px solid ${tempColor[activeContact.temperature]}`, background: `${tempColor[activeContact.temperature]}1f`, padding: "2px 8px", borderRadius: "20px" }}>
            {activeContact.temperature.toUpperCase()}
          </span>
        </div>
        {(activeContact.email || activeContact.phone) && (
          <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 4 }}>
            {activeContact.email && <div style={{ fontSize: "12px", color: T.greenInk, display: "flex", alignItems: "center", gap: 6 }}><Mail size={13} /> {activeContact.email}</div>}
            {activeContact.phone && <div style={{ fontSize: "12px", color: T.blue, display: "flex", alignItems: "center", gap: 6 }}><Phone size={13} /> {activeContact.phone}</div>}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "16px" }}>
        <button onClick={() => setView("content")} style={btnStyle(T.green, T.navy, false)}><Zap size={13} /> Gerar conteúdo</button>
        <button onClick={syncToCRM} style={btnStyle(T.card, T.secondary, true)}><ArrowUpRight size={13} /> CRM</button>
      </div>

      {/* Timeline */}
      <div style={{ fontSize: "11px", color: T.muted, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px", fontWeight: 900 }}>Timeline</div>

      {calls.map((call) => (
        <div key={call.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "8px", padding: "10px", marginBottom: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Phone size={12} style={{ color: T.muted }} />
              <span style={{ fontSize: "11px", color: T.secondary }}>Ligação · </span>
              <span style={{ fontSize: "11px", color: T.muted }}>{new Date(call.startedAt).toLocaleDateString("pt-BR")}</span>
              {call.durationSeconds && <span style={{ fontSize: "11px", color: T.muted }}> · {Math.round(call.durationSeconds / 60)}min</span>}
            </div>
            {call.result && (
              <span style={{ fontSize: "10px", fontWeight: 900, color: resultColors[call.result] }}>
                {call.result.toUpperCase()}
              </span>
            )}
          </div>
          {call.analysisStatus === "done" && (
            <button onClick={() => loadAnalysis(call.id)} style={{ marginTop: "6px", background: "none", border: "none", color: T.greenInk, cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 900, padding: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
              Ver diagnóstico <ArrowRight size={12} />
            </button>
          )}
          {call.analysisStatus === "processing" && (
            <div style={{ fontSize: "11px", color: T.yellow, marginTop: "4px", display: "flex", alignItems: "center", gap: 4 }}><Clock size={12} /> Analisando...</div>
          )}
        </div>
      ))}

      {messages.slice(0, 5).map((msg) => (
        <div key={msg.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "8px", padding: "10px", marginBottom: "6px" }}>
          <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px" }}>
            <span style={{ fontSize: "11px", color: T.secondary, display: "inline-flex", alignItems: "center", gap: 4 }}><MessageCircle size={12} /> WhatsApp</span>
            <span style={{ fontSize: "10px", color: msg.direction === "outbound" ? T.blue : T.muted }}>
              {msg.direction === "outbound" ? "Você" : activeContact.firstName}
            </span>
            <span style={{ fontSize: "10px", color: T.muted }}>· {new Date(msg.sentAt).toLocaleDateString("pt-BR")}</span>
          </div>
          <div style={{ fontSize: "12px", color: T.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {msg.content ?? (msg.type === "audio" ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Music size={12} /> Áudio</span> : "Mídia")}
          </div>
        </div>
      ))}

      {calls.length === 0 && messages.length === 0 && (
        <div style={{ color: T.muted, fontSize: "12px", textAlign: "center", padding: "20px" }}>Nenhuma interação registrada</div>
      )}

      {/* Analysis modal */}
      {showAnalysis && activeCallAnalysis && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(26,35,50,0.5)", zIndex: 1000,
          display: "flex", flexDirection: "column", overflow: "auto",
        }}>
          <div style={{ background: T.bg, padding: "16px", flex: 1, overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <span style={{ fontSize: "11px", color: T.muted, textTransform: "uppercase", letterSpacing: "1px", fontWeight: 900 }}>Diagnóstico</span>
              <button onClick={() => setShowAnalysis(false)} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", display: "inline-flex" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: "13px", color: T.secondary, lineHeight: "1.7", marginBottom: "16px" }}>{activeCallAnalysis.flashSummary}</div>
            <div style={{ fontSize: "11px", color: T.muted, marginBottom: "4px", fontWeight: 900 }}>PRÓXIMO PASSO</div>
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "6px", padding: "10px", fontSize: "12px", color: T.text, marginBottom: "16px" }}>
              {activeCallAnalysis.nextStep}
            </div>
            {activeCallAnalysis.diagnosis.sections.map((s, i) => (
              <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "8px", padding: "12px", marginBottom: "8px", borderLeft: `3px solid ${s.severity === "critical" ? T.red : s.severity === "positive" ? T.greenInk : s.severity === "warning" ? T.yellow : T.muted}` }}>
                <div style={{ fontSize: "12px", fontWeight: 900, color: T.text, marginBottom: "6px" }}>{s.title}</div>
                <div style={{ fontSize: "12px", color: T.secondary, lineHeight: "1.6" }}>{s.body}</div>
                {s.recommendedResponse && (
                  <div style={{ marginTop: "8px", fontSize: "11px", color: T.greenInk, display: "flex", alignItems: "center", gap: 4 }}><ArrowRight size={12} /> {s.recommendedResponse}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function btnStyle(bg: string, color: string, bordered: boolean): React.CSSProperties {
  return {
    flex: 1, background: bg, border: bordered ? `1px solid ${T.border}` : "none", color,
    padding: "8px", borderRadius: "6px", cursor: "pointer",
    fontFamily: "inherit", fontSize: "11px", fontWeight: 900,
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
  };
}
