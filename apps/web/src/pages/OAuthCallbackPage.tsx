import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { apiFetch } from "../lib/api";

export function OAuthCallbackPage() {
  const { provider } = useParams<{ provider: string }>();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const code  = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      setStatus("error");
      setMessage(`Autorização negada: ${error}`);
      return;
    }

    if (!code || !provider) {
      setStatus("error");
      setMessage("Código de autorização não encontrado.");
      return;
    }

    apiFetch(`/crm/${provider}/callback`, {
      method: "POST",
      body: JSON.stringify({ code }),
    })
      .then(() => {
        setStatus("success");
        setMessage(`${provider} conectado com sucesso!`);
        // Close popup after a brief moment
        setTimeout(() => window.close(), 1500);
      })
      .catch((err: Error) => {
        setStatus("error");
        setMessage(err.message);
      });
  }, []);

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "var(--bg)", fontFamily: "-apple-system, sans-serif",
    }}>
      <div style={{
        background: "var(--bg-card)", border: "1px solid var(--border)",
        borderRadius: 14, padding: "32px 40px", textAlign: "center", maxWidth: 380,
      }}>
        {status === "loading" && (
          <>
            <Loader2 size={32} className="spin" style={{ marginBottom: 16, color: "var(--text-muted)" }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Conectando...</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
              Finalizando autorização com {provider}
            </div>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle size={32} style={{ marginBottom: 16, color: "var(--green)" }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--green)" }}>{message}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
              Esta janela vai fechar automaticamente.
            </div>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle size={32} style={{ marginBottom: 16, color: "var(--red)" }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--red)" }}>Erro na conexão</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>{message}</div>
            <button
              onClick={() => window.close()}
              style={{ marginTop: 16, background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-secondary)", padding: "8px 20px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
            >
              Fechar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
