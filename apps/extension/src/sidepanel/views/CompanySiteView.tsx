import React, { useEffect, useState } from "react";
import { Building2, Mail, Phone, ArrowLeft } from "lucide-react";
import { useStore } from "../../store.js";
import { apiFetch } from "../../lib/api.js";
import { T } from "../theme.js";
import type { SitePerson } from "@limo/types";

export function CompanySiteView() {
  const { companyData, setView, setCompanyData } = useStore();
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [lists, setLists] = useState<any[]>([]);
  const [listId, setListId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<{ lists: any[] }>("/lists")
      .then((r) => setLists(r.lists ?? []))
      .catch(() => {});
  }, []);

  if (!companyData) {
    return (
      <div style={{ padding: 20, textAlign: "center" }}>
        <div style={{ fontSize: 13, color: T.muted }}>
          Aguardando dados do site...
        </div>
      </div>
    );
  }

  const { domain, companyName, people, emails, phones } = companyData;

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function toggleAll() {
    if (checked.size === people.length) {
      setChecked(new Set());
    } else {
      setChecked(new Set(people.map((_, i) => i)));
    }
  }

  async function importSelected() {
    if (!listId) { alert("Selecione uma lista primeiro."); return; }

    setImporting(true);
    const selected = [...checked].map((i) => people[i]!);
    const ids: string[] = [];

    for (const person of selected) {
      try {
        const nameParts = (person.name ?? "Contato").split(" ");
        const res = await apiFetch<{ contact: { id: string } }>("/contacts", {
          method: "POST",
          body: JSON.stringify({
            firstName:     nameParts[0] ?? "Contato",
            lastName:      nameParts.slice(1).join(" ") || (companyName ?? domain),
            email:         person.email    ?? undefined,
            phone:         person.phone    ?? undefined,
            jobTitle:      person.jobTitle ?? undefined,
            companyName:   companyName     ?? undefined,
            companyDomain: domain,
            linkedinUrl:   person.linkedin ?? undefined,
            source:        "website",
            enrichmentData: {
              emailsFound:  person.emailCandidates ?? [],
              phonesFound:  phones,
              emailPattern: null,
              sources:      ["website-scrape"],
            },
          }),
        });
        ids.push(res.contact.id);
      } catch { /* skip individual failures */ }
    }

    if (ids.length > 0) {
      try {
        await apiFetch(`/lists/${listId}/contacts`, {
          method: "POST",
          body: JSON.stringify({ contactIds: ids }),
        });
      } catch { /* ignore */ }
    }

    setImportResult(ids.length);
    setImporting(false);
    setChecked(new Set());
    setTimeout(() => setImportResult(null), 3000);
  }

  const selectedCount = checked.size;

  return (
    <div style={{ background: T.bg, minHeight: "100vh" }}>
      {/* Back */}
      <div style={{ padding: "10px 14px 0", display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={() => { setView("home"); setCompanyData(null); }}
          style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center" }}
        ><ArrowLeft size={16} /></button>
        <span style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: "1px" }}>
          Site · {domain}
        </span>
      </div>

      {/* Company header */}
      {companyName && (
        <div style={{ padding: "8px 14px 0" }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: T.text, display: "inline-flex", alignItems: "center", gap: 5 }}><Building2 size={13} /> {companyName}</span>
        </div>
      )}

      {/* People list */}
      <div style={{ padding: "10px 12px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: T.muted, fontWeight: 900, textTransform: "uppercase", letterSpacing: "1px" }}>
            {people.length} contato{people.length !== 1 ? "s" : ""} encontrado{people.length !== 1 ? "s" : ""}
          </div>
          {people.length > 1 && (
            <button
              onClick={toggleAll}
              style={{ background: "none", border: "none", fontSize: 11, color: T.muted, cursor: "pointer", fontFamily: "inherit", fontWeight: 900 }}
            >
              {checked.size === people.length ? "Desmarcar todos" : "Selecionar todos"}
            </button>
          )}
        </div>

        {people.map((person, i) => (
          <PersonCard
            key={i}
            person={person}
            checked={checked.has(i)}
            onToggle={() => toggle(i)}
          />
        ))}

        {people.length === 0 && emails.length > 0 && (
          <div style={{ fontSize: 12, color: T.muted, paddingBottom: 8 }}>
            <div style={{ marginBottom: 4, fontWeight: 700 }}>Emails encontrados:</div>
            {emails.map((e) => (
              <div key={e} style={{ fontSize: 11, color: T.muted, display: "flex", alignItems: "center", gap: 5 }}><Mail size={12} /> {e}</div>
            ))}
          </div>
        )}
      </div>

      {/* Import section */}
      {selectedCount > 0 && (
        <div style={{
          margin: "8px 12px", background: T.card, borderRadius: 12,
          border: `1px solid ${T.border}`, padding: "12px 14px",
        }}>
          <div style={{ fontSize: 11, color: T.text, fontWeight: 700, marginBottom: 6 }}>
            Adicionar à lista:
          </div>
          <select
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            style={{
              width: "100%", padding: "7px 10px", borderRadius: 7,
              border: `1px solid ${T.border}`, fontFamily: "inherit",
              fontSize: 12, fontWeight: 700, color: T.navy,
              background: "#fff", marginBottom: 8, outline: "none",
            }}
          >
            <option value="">Selecione uma lista...</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.contactCount ?? 0})
              </option>
            ))}
          </select>

          <button
            onClick={importSelected}
            disabled={importing}
            style={{
              width: "100%", background: importResult !== null ? "#22c55e" : T.green,
              border: "none", color: T.navy, padding: 10, borderRadius: 8,
              cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 900,
            }}
          >
            {importing
              ? "Importando..."
              : importResult !== null
              ? `${importResult} importado${importResult !== 1 ? "s" : ""}!`
              : `Importar ${selectedCount} contato${selectedCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}

function PersonCard({
  person,
  checked,
  onToggle,
}: {
  person: SitePerson;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "flex-start", gap: 8,
        padding: "8px 10px", borderRadius: 10, marginBottom: 6, cursor: "pointer",
        background: checked ? "rgba(163,230,53,0.08)" : "#fff",
        border: `1px solid ${checked ? "rgba(163,230,53,0.35)" : "#dde4ee"}`,
        transition: "all 0.15s",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 14, height: 14, cursor: "pointer", flexShrink: 0, marginTop: 2, accentColor: "#a3e635" }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: "#1a2332", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {person.name}
        </div>
        {person.jobTitle && (
          <div style={{ fontSize: 11, color: "#4a5568", marginTop: 1, lineHeight: 1.3 }}>
            {person.jobTitle}
          </div>
        )}
        {person.email && (
          <div style={{ fontSize: 10, color: T.muted, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}><Mail size={11} /> {person.email}</div>
        )}
        {!person.email && person.emailCandidates && person.emailCandidates.length > 0 && (
          <div style={{ fontSize: 10, color: T.muted, marginTop: 2, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            <Mail size={11} /> {person.emailCandidates[0]}
            <span style={{ fontSize: 9, background: "rgba(140,140,140,0.12)", color: "#8898aa", padding: "1px 4px", borderRadius: 3, marginLeft: 4 }}>
              estimado
            </span>
          </div>
        )}
        {person.phone && (
          <div style={{ fontSize: 10, color: T.blue, marginTop: 1, display: "flex", alignItems: "center", gap: 4 }}><Phone size={11} /> {person.phone}</div>
        )}
      </div>
    </div>
  );
}
