import React, { useEffect, useState } from "react";
import { useStore } from "../../store.js";
import { T } from "../theme.js";
import { track } from "../../lib/telemetry.js";

const API_BASE = "https://api.limoapp.com.br/v1";
const SIGNUP_URL = "https://app.limoapp.com.br/register";

export function LoginView() {
  const { setAuth } = useStore();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  // Telemetria anônima do funil: tela de login exibida.
  useEffect(() => { track("login_view"); }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await res.json();
      track("login_attempt", res.ok); // funil: tentou logar (com desfecho)
      if (!res.ok) throw new Error(data.message ?? "Erro ao fazer login");
      setAuth(data.tokens.accessToken, data.user);
      chrome.storage.local.set({ user: data.user, refreshToken: data.tokens.refreshToken });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const logoUrl = chrome.runtime.getURL("logo_oficial.png");

  // Abre o cadastro na web já passando o ID desta extensão. Ao final do cadastro,
  // a web devolve a sessão pra cá (handoff) e o painel loga sozinho.
  function openSignup() {
    const url = `${SIGNUP_URL}?ext=${encodeURIComponent(chrome.runtime.id)}`;
    chrome.tabs.create({ url });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", minHeight: "100vh", padding: "24px", background: T.bg }}>
      <div style={{ marginBottom: "20px", textAlign: "center" }}>
        <img src={logoUrl} alt="Limo" style={{ width: 140, height: "auto", objectFit: "contain", marginBottom: 8 }} />
      </div>

      {/* Cadastro em primeiro plano: quase todo mundo que instala ainda NÃO tem
          conta. O botão principal cria conta; o login fica como opção secundária. */}
      <div style={{ width: "100%", textAlign: "center", marginBottom: "6px" }}>
        <div style={{ fontSize: "15px", fontWeight: 900, color: "#1a2332" }}>Comece agora</div>
        <div style={{ fontSize: "12px", color: "#8898aa", marginTop: "3px" }}>Crie sua conta em menos de um minuto</div>
      </div>

      <button
        type="button"
        onClick={openSignup}
        style={{ width: "100%", background: T.green, border: "none", color: "#1a2332", padding: "11px", borderRadius: "8px", cursor: "pointer", fontFamily: "inherit", fontSize: "13px", fontWeight: 900, marginTop: "12px" }}
      >
        Criar conta
      </button>

      <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", margin: "16px 0 12px" }}>
        <div style={{ flex: 1, height: 1, background: "#e4e9f0" }} />
        <span style={{ fontSize: "11px", color: "#8898aa" }}>ou entre na sua conta</span>
        <div style={{ flex: 1, height: 1, background: "#e4e9f0" }} />
      </div>

      <form onSubmit={handleLogin} style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px" }}>
        <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
        <input type="password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required style={inputStyle} />
        {error && <div style={{ color: T.red, fontSize: "12px", textAlign: "center" }}>{error}</div>}
        <button type="submit" disabled={loading} style={{ background: "transparent", border: "1px solid #dde4ee", color: "#1a2332", padding: "9px", borderRadius: "8px", cursor: loading ? "wait" : "pointer", fontFamily: "inherit", fontSize: "13px", fontWeight: 900, marginTop: "4px" }}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#ffffff", border: "1px solid #dde4ee", color: "#1a2332",
  padding: "9px 12px", borderRadius: "8px", fontFamily: "inherit",
  fontSize: "12px", fontWeight: 900, outline: "none", width: "100%",
};
