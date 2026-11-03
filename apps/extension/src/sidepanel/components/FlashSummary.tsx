import React from "react";
import { CheckCircle2, XCircle, MinusCircle, HelpCircle, Zap, X } from "lucide-react";
import type { CallAnalysis } from "@limo/types";
import { useStore } from "../../store.js";
import { T } from "../theme.js";

interface Props {
  analysis: CallAnalysis;
}

const resultMeta: Record<string, { label: string; color: string; Icon: typeof CheckCircle2 }> = {
  positive:     { label: "CONVERTIDA",   color: T.greenInk, Icon: CheckCircle2 },
  negative:     { label: "PERDIDA",      color: T.red,      Icon: XCircle },
  neutral:      { label: "NEUTRO",       color: T.yellow,   Icon: MinusCircle },
  inconclusive: { label: "INCONCLUSIVO", color: T.muted,    Icon: HelpCircle },
};

export function FlashSummary({ analysis }: Props) {
  const { setFlashSummary, setView } = useStore();
  const meta = resultMeta[analysis.result] ?? resultMeta.inconclusive;
  const ResultIcon = meta.Icon;

  return (
    <div style={{
      background: T.card,
      border: `1px solid ${T.border}`,
      borderLeft: `3px solid ${meta.color}`,
      borderRadius: "10px",
      margin: "12px",
      padding: "14px",
      position: "relative",
      boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
    }}>
      <button
        onClick={() => setFlashSummary(null)}
        style={{ position: "absolute", top: "8px", right: "10px", background: "none", border: "none", color: T.muted, cursor: "pointer", display: "inline-flex" }}
      >
        <X size={15} />
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "10px", color: T.text, fontWeight: 900, letterSpacing: "1px" }}>
          <Zap size={12} style={{ color: T.green }} /> FLASH SUMMARY
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "10px", color: meta.color, border: `1px solid ${meta.color}`, padding: "1px 6px", borderRadius: "4px", fontWeight: 900 }}>
          <ResultIcon size={11} /> {meta.label}
        </span>
      </div>

      <p style={{ fontSize: "12px", color: T.secondary, lineHeight: "1.6", marginBottom: "10px" }}>
        {analysis.flashSummary}
      </p>

      <div style={{ background: T.surface, borderRadius: "6px", padding: "8px 10px", marginBottom: "10px" }}>
        <div style={{ fontSize: "10px", color: T.muted, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px", fontWeight: 900 }}>
          Próximo passo
        </div>
        <div style={{ fontSize: "12px", color: T.text }}>{analysis.nextStep}</div>
      </div>

      <div style={{ display: "flex", gap: "6px" }}>
        <button
          onClick={() => { setView("contact"); setFlashSummary(null); }}
          style={{
            flex: 1, background: T.navy, border: "none", color: "#fff",
            padding: "7px", borderRadius: "6px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 900,
          }}
        >
          Ver diagnóstico completo
        </button>
        <button
          onClick={() => setFlashSummary(null)}
          style={{
            background: T.card, border: `1px solid ${T.border}`, color: T.muted,
            padding: "7px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 900,
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
