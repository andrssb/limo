import React, { useEffect, useState } from "react";
import { Medal, AlertTriangle, Phone, User } from "lucide-react";
import { cachedGet } from "../lib/api";

interface RankingEntry {
  position: number;
  userId: string;
  name: string;
  callsThisMonth: number;
  contactsAdded: number;
  goalProgress: number;
  atRisk: boolean;
}

const MEDAL: React.ReactNode[] = [
  <Medal size={26} style={{ color: "#eab308" }} />,
  <Medal size={26} style={{ color: "#94a3b8" }} />,
  <Medal size={26} style={{ color: "#cd7f32" }} />,
];

export function RankingPage() {
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cachedGet<{ ranking: RankingEntry[] }>("/analytics/ranking")
      .then((r) => setRanking(r.ranking))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: "32px 28px", maxWidth: 700 }}>
      <div className="topbar">
        <div className="page-title">Ranking do Time</div>
        <div className="page-subtitle">Performance dos BDRs no mês atual</div>
      </div>

      {loading ? (
        <div className="empty-state">Carregando ranking...</div>
      ) : ranking.length === 0 ? (
        <div className="empty-state">
          Nenhum BDR com meta ativa ainda. Configure metas primeiro.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {ranking.map((entry) => (
            <div
              key={entry.userId}
              style={{
                background: "var(--card-bg)",
                border: `1px solid ${entry.position === 1 ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 12,
                padding: "18px 22px",
                display: "flex",
                alignItems: "center",
                gap: 18,
              }}
            >
              <div style={{ fontSize: 28, width: 36, textAlign: "center", flexShrink: 0 }}>
                {MEDAL[entry.position - 1] ?? `#${entry.position}`}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 900, fontSize: 15, color: "var(--text)" }}>
                    {entry.name}
                  </span>
                  {entry.atRisk && (
                    <span style={{
                      background: "rgba(239,68,68,0.12)",
                      color: "#ef4444",
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 99,
                    }}>
                      <AlertTriangle size={11} style={{ verticalAlign: "middle" }} /> Em risco
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                <div style={{ background: "var(--border)", borderRadius: 4, height: 6, marginBottom: 8 }}>
                  <div style={{
                    height: 6,
                    borderRadius: 4,
                    background: entry.goalProgress >= 80 ? "var(--accent)" : entry.goalProgress >= 50 ? "#f59e0b" : "#ef4444",
                    width: `${entry.goalProgress}%`,
                    transition: "width 0.6s ease",
                  }} />
                </div>

                <div style={{ display: "flex", gap: 20, fontSize: 12, color: "var(--muted)" }}>
                  <span><Phone size={12} style={{ verticalAlign: "middle" }} /> {entry.callsThisMonth} ligações</span>
                  <span><User size={12} style={{ verticalAlign: "middle" }} /> {entry.contactsAdded} contatos</span>
                  <span style={{ fontWeight: 700, color: "var(--text)" }}>
                    {entry.goalProgress}% da meta
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
