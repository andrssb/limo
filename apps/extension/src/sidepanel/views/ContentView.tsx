import React, { useEffect, useState } from "react";
import { Zap, ArrowLeft } from "lucide-react";
import { useStore } from "../../store.js";
import { apiFetch } from "../../lib/api.js";
import { T } from "../theme.js";
import type { Contact, ContentType } from "@limo/types";

export function ContentView() {
  const { activeContact, isGenerating, generatedContent, setGenerating, setGeneratedContent, setView } = useStore();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState(activeContact?.id ?? "");
  const [contentType, setContentType] = useState<ContentType>("call_script");
  const [customContext, setCustomContext] = useState("");

  useEffect(() => {
    apiFetch<{ data: Contact[] }>("/contacts?pageSize=50")
      .then((res) => setContacts(res.data))
      .catch(console.error);
  }, []);

  async function handleGenerate() {
    if (!selectedContactId) return;
    setGenerating(true);
    setGeneratedContent(null);

    try {
      const res = await apiFetch<{ content: string }>("/content/generate", {
        method: "POST",
        body: JSON.stringify({ contactId: selectedContactId, type: contentType, customContext }),
      });
      setGeneratedContent(res.content);
    } catch (err) {
      setGeneratedContent(`Erro: ${(err as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }

  function copyToClipboard() {
    if (generatedContent) navigator.clipboard.writeText(generatedContent);
  }

  const typeLabels: Record<ContentType, string> = {
    call_script: "Script de Ligação",
    email: "E-mail",
    whatsapp: "Mensagem WhatsApp",
  };

  return (
    <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "10px", background: T.bg, minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        <button onClick={() => setView("home")} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center" }}><ArrowLeft size={16} /></button>
        <span style={{ fontSize: "11px", color: T.muted, textTransform: "uppercase", letterSpacing: "1px" }}>Gerador de Conteúdo</span>
      </div>

      <select
        value={selectedContactId}
        onChange={(e) => setSelectedContactId(e.target.value)}
        style={selectStyle}
      >
        <option value="">Selecionar lead...</option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>{c.firstName} {c.lastName} · {c.companyName ?? "—"}</option>
        ))}
      </select>

      <div style={{ display: "flex", gap: "6px" }}>
        {(["call_script", "email", "whatsapp"] as ContentType[]).map((t) => {
          const active = contentType === t;
          return (
            <button
              key={t}
              onClick={() => setContentType(t)}
              style={{
                flex: 1, padding: "7px 4px", borderRadius: "6px", cursor: "pointer",
                fontFamily: "inherit", fontSize: "10px",
                background: active ? T.green : T.card,
                color: active ? T.navy : T.muted,
                border: active ? "none" : `1px solid ${T.border}`,
                fontWeight: active ? 900 : 700,
              }}
            >
              {typeLabels[t]}
            </button>
          );
        })}
      </div>

      <textarea
        placeholder="Contexto adicional (opcional)..."
        value={customContext}
        onChange={(e) => setCustomContext(e.target.value)}
        rows={2}
        style={{ ...selectStyle, resize: "none", height: "56px" }}
      />

      <button
        onClick={handleGenerate}
        disabled={!selectedContactId || isGenerating}
        style={{
          background: T.green, border: "none", color: T.navy,
          padding: "10px", borderRadius: "6px", cursor: isGenerating ? "wait" : "pointer",
          fontFamily: "inherit", fontSize: "12px", fontWeight: 900,
          opacity: !selectedContactId ? 0.5 : 1,
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}
      >
        {isGenerating ? "Gerando..." : <><Zap size={14} /> Gerar</>}
      </button>

      {generatedContent && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <span style={{ fontSize: "10px", color: T.muted, textTransform: "uppercase", letterSpacing: "1px", fontWeight: 900 }}>Resultado</span>
            <button onClick={copyToClipboard} style={{ background: T.card, border: `1px solid ${T.border}`, color: T.secondary, padding: "3px 8px", borderRadius: "4px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", fontWeight: 900 }}>
              Copiar
            </button>
          </div>
          <div style={{
            background: T.card, border: `1px solid ${T.border}`, borderRadius: "8px",
            padding: "12px", fontSize: "12px", color: T.text, lineHeight: "1.7",
            whiteSpace: "pre-wrap", maxHeight: "300px", overflowY: "auto",
          }}>
            {generatedContent}
          </div>
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: T.card,
  border: `1px solid ${T.border}`,
  color: T.text,
  padding: "9px 12px",
  borderRadius: "6px",
  fontFamily: "inherit",
  fontSize: "12px",
  fontWeight: 900,
  outline: "none",
  width: "100%",
};
