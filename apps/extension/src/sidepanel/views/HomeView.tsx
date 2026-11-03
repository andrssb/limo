import React, { useEffect, useState } from "react";
import { Mic, Zap, Flame, Thermometer, Snowflake } from "lucide-react";
import { useStore } from "../../store.js";
import { apiFetch } from "../../lib/api.js";
import { T } from "../theme.js";
import type { Contact } from "@limo/types";

const tempMeta: Record<string, { label: string; color: string; Icon: typeof Flame }> = {
  hot:  { label: "Quente", color: T.red,    Icon: Flame },
  warm: { label: "Morno",  color: T.yellow, Icon: Thermometer },
  cold: { label: "Frio",   color: T.blue,   Icon: Snowflake },
};

export function HomeView() {
  const { setActiveContact, setView } = useStore();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    apiFetch<{ data: Contact[] }>("/contacts?pageSize=10&sortBy=updatedAt&sortDir=desc")
      .then((res) => setContacts(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: "12px", background: T.bg, minHeight: "100vh" }}>
      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "10px", color: T.muted, marginBottom: "8px", letterSpacing: "1.5px", textTransform: "uppercase" }}>
          Contatos recentes
        </div>
        {loading && <div style={{ color: T.muted, fontSize: "12px" }}>Carregando...</div>}
        {!loading && contacts.length === 0 && (
          <div style={{ color: T.muted, fontSize: "12px", textAlign: "center", padding: "20px 0" }}>
            Nenhum contato ainda
          </div>
        )}
        {contacts.map((c) => {
          const m = tempMeta[c.temperature] ?? tempMeta.cold;
          const Icon = m.Icon;
          return (
            <div
              key={c.id}
              onClick={() => { setActiveContact(c); setView("contact"); }}
              style={{
                background: T.card, border: `1px solid ${T.border}`, borderRadius: "10px",
                padding: "10px 12px", marginBottom: "6px", cursor: "pointer",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                transition: "box-shadow 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
            >
              <div>
                <div style={{ fontSize: "13px", fontWeight: 900, color: T.text }}>{c.firstName} {c.lastName}</div>
                <div style={{ fontSize: "11px", color: T.muted, marginTop: 1 }}>{c.companyName ?? c.jobTitle ?? "—"}</div>
              </div>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: "10px", fontWeight: 900, color: m.color,
                border: `1px solid ${m.color}`, background: `${m.color}1f`,
                padding: "2px 8px", borderRadius: "20px",
              }}>
                <Icon size={11} /> {m.label}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          onClick={() => setView("coaching")}
          style={{
            width: "100%", background: T.navy, border: `1px solid ${T.navy}`,
            color: T.green, padding: "11px", borderRadius: "8px",
            cursor: "pointer", fontFamily: "inherit", fontSize: "13px", fontWeight: 900,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <Mic size={15} /> Coaching ao Vivo
        </button>
        <button
          onClick={() => setView("content")}
          style={{
            width: "100%", background: T.green, border: "none",
            color: T.navy, padding: "11px", borderRadius: "8px",
            cursor: "pointer", fontFamily: "inherit", fontSize: "13px", fontWeight: 900,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <Zap size={15} /> Gerar conteúdo de abordagem
        </button>
      </div>
    </div>
  );
}
