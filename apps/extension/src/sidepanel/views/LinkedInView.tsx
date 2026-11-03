import React, { useState } from "react";
import { Building2, MapPin, AtSign, Globe, Zap, RefreshCw, ArrowLeft, ArrowRight, Mail, Phone, Clock } from "lucide-react";
import { useStore } from "../../store.js";
import { apiFetch } from "../../lib/api.js";
import { T } from "../theme.js";

export function LinkedInView() {
  const { linkedInData, setView, setLinkedInData } = useStore();
  const [saving, setSaving] = useState<"idle" | "loading" | "ok" | "err">("idle");

  if (!linkedInData) {
    return (
      <div style={{ padding: 20, textAlign: "center" }}>
        <div style={{ fontSize: 13, color: T.muted, marginBottom: 8 }}>
          Aguardando perfil do LinkedIn...
        </div>
        <div style={{ fontSize: 11, color: T.muted, marginBottom: 16 }}>
          Certifique-se de estar em um perfil <code style={{ fontSize: 10 }}>/in/</code> e que a página carregou.
        </div>
        <button
          onClick={() =>
            chrome.runtime.sendMessage({ type: "TRIGGER_LINKEDIN_SCRAPE" }).catch(() => {})
          }
          style={{
            background: T.green, border: "none", color: T.navy,
            padding: "9px 20px", borderRadius: 8, cursor: "pointer",
            fontFamily: "inherit", fontSize: 12, fontWeight: 900,
          }}
        >
          Buscar dados agora
        </button>
      </div>
    );
  }

  const d = linkedInData;

  async function save() {
    setSaving("loading");
    try {
      await apiFetch("/contacts", {
        method: "POST",
        body: JSON.stringify({
          firstName:   d.firstName,
          lastName:    d.lastName,
          email:       d.email    ?? undefined,
          phone:       d.phone    ?? undefined,
          linkedinUrl: d.linkedinUrl,
          companyName: d.company  ?? undefined,
          jobTitle:    d.headline ?? undefined,
          location:    d.location ?? undefined,
          source:      "linkedin",
          enrichmentData: {
            emailsFound:  d.emailCandidates,
            emailPattern: null,
            sources:      ["linkedin-voyager", "enrichment-engine"],
          },
        }),
      });
      setSaving("ok");
      setTimeout(() => setSaving("idle"), 2500);
    } catch {
      setSaving("err");
      setTimeout(() => setSaving("idle"), 2500);
    }
  }

  const saveBg    = saving === "ok" ? T.green : saving === "err" ? T.red : T.green;
  const saveLabel = saving === "loading" ? "Salvando..." : saving === "ok" ? "Salvo!" : saving === "err" ? "Erro" : "Salvar no Limo";

  return (
    <div style={{ background: T.bg, minHeight: "100vh" }}>
      {/* Back */}
      <div style={{ padding: "10px 14px 0", display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={() => { setView("home"); setLinkedInData(null); }}
          style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center" }}
        ><ArrowLeft size={16} /></button>
        <span style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: "1px" }}>
          Perfil LinkedIn
        </span>
      </div>

      {/* Profile card */}
      <div style={{ margin: "10px 12px 0", background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: "14px" }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: T.text, lineHeight: 1.2 }}>
          {d.firstName} {d.lastName}
        </div>
        {d.headline && (
          <div style={{ fontSize: 12, color: T.secondary, marginTop: 3, lineHeight: 1.4 }}>
            {d.headline}
          </div>
        )}
        {d.company && (
          <div style={{ fontSize: 11, color: T.muted, marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}><Building2 size={12} /> {d.company}</div>
        )}
        {d.location && (
          <div style={{ fontSize: 11, color: T.muted, marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}><MapPin size={12} /> {d.location}</div>
        )}
      </div>

      {/* Contact info */}
      <div style={{ margin: "8px 12px 0", background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: "12px 14px" }}>
        <div style={{ fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 10, fontWeight: 900 }}>
          Contato
        </div>

        {d.enriching ? (
          <div style={{ fontSize: 12, color: T.muted, display: "flex", alignItems: "center", gap: 6 }}><Clock size={13} /> Enriquecendo dados...</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <EmailRow
              email={d.email}
              candidates={d.emailCandidates}
              confidence={d.emailConfidence}
            />
            <PhoneRow phone={d.phone} />
            {d.twitter && (
              <div style={{ fontSize: 12, color: T.muted, display: "flex", alignItems: "center", gap: 6 }}><AtSign size={13} /> @{d.twitter}</div>
            )}
            {d.website && (
              <div style={{ fontSize: 12, color: T.blue, wordBreak: "break-all", display: "flex", alignItems: "center", gap: 6 }}>
                <Globe size={13} /> {d.website}
              </div>
            )}
            {!d.email && !d.phone && d.emailCandidates.length === 0 && (
              <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
                Contato não encontrado automaticamente.
                {d.company
                  ? ` Tente buscar manualmente no site da ${d.company}.`
                  : " Empresa não identificada no perfil."}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ margin: "8px 12px 0", display: "flex", gap: 8 }}>
        <button
          onClick={save}
          disabled={saving === "loading"}
          style={{
            flex: 1, background: saveBg, border: "none", color: T.navy,
            padding: "10px 8px", borderRadius: 8, cursor: "pointer",
            fontFamily: "inherit", fontSize: 13, fontWeight: 900,
          }}
        >
          {saveLabel}
        </button>
        <button
          onClick={() => setView("content")}
          style={{
            flex: 1, background: T.greenBg, border: `1px solid rgba(163,230,53,0.3)`,
            color: T.greenInk, padding: "10px 8px", borderRadius: 8, cursor: "pointer",
            fontFamily: "inherit", fontSize: 13, fontWeight: 900,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <Zap size={14} /> Gerar script
        </button>
      </div>

      {/* Footer links */}
      <div style={{ padding: "6px 14px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <a
          href={d.linkedinUrl}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 11, color: T.blue, display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          Ver perfil <ArrowRight size={12} />
        </a>
        <button
          onClick={() => {
            useStore.getState().setLinkedInData(null);
            chrome.runtime.sendMessage({ type: "TRIGGER_LINKEDIN_SCRAPE" }).catch(() => {});
          }}
          style={{ background: "none", border: "none", fontSize: 11, color: T.muted, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <RefreshCw size={12} /> Recarregar
        </button>
      </div>
    </div>
  );
}

function EmailRow({
  email,
  candidates,
  confidence,
}: {
  email: string | null;
  candidates: string[];
  confidence: string | null;
}) {
  if (email) {
    const badge =
      confidence === "verified"
        ? <Badge label="verificado" bg={T.greenBg} color={T.greenInk} />
        : confidence === "probable"
        ? <Badge label="provável" bg="rgba(59,130,246,0.12)" color={T.blue} />
        : null;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: T.greenInk, display: "flex", alignItems: "center", gap: 6 }}><Mail size={13} /> {email}</span>
        {badge}
      </div>
    );
  }

  if (candidates.length > 0) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: T.muted, display: "flex", alignItems: "center", gap: 6 }}><Mail size={13} /> {candidates[0]}</span>
          <Badge label="estimado" bg="rgba(140,140,140,0.15)" color={T.muted} />
        </div>
        {candidates.length > 1 && (
          <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
            +{candidates.length - 1} candidatos
          </div>
        )}
      </div>
    );
  }

  return <div style={{ fontSize: 12, color: T.muted, display: "flex", alignItems: "center", gap: 6 }}><Mail size={13} /> Não encontrado</div>;
}

function PhoneRow({ phone }: { phone: string | null }) {
  if (!phone) {
    return <div style={{ fontSize: 12, color: T.muted, display: "flex", alignItems: "center", gap: 6 }}><Phone size={13} /> Não encontrado</div>;
  }
  return (
    <div style={{ fontSize: 12, color: T.blue, display: "flex", alignItems: "center", gap: 6 }}><Phone size={13} /> {phone}</div>
  );
}

function Badge({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span style={{
      fontSize: 9, background: bg, color, padding: "1px 5px",
      borderRadius: 3, marginLeft: 4, fontWeight: 900,
    }}>
      {label}
    </span>
  );
}
