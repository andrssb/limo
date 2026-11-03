// Teste isolado da autenticação Assertiva OAuth2.
// Bate em POST /oauth2/v3/token (Basic auth + grant_type=client_credentials),
// exatamente como o adapter de produção, e mostra o token/expires_in/scope reais.
//
// Uso (PowerShell), qualquer uma das formas:
//   node scripts/test-assertiva-token.mjs <CLIENT_ID> <CLIENT_SECRET>
//   $env:ASSERTIVA_CLIENT_ID="..."; $env:ASSERTIVA_CLIENT_SECRET="..."; node scripts/test-assertiva-token.mjs
//
// Opcional: $env:ASSERTIVA_BASE_URL para apontar pra outro host.

const BASE_URL = process.env.ASSERTIVA_BASE_URL ?? "https://api.assertivasolucoes.com.br";
const id = process.argv[2] ?? process.env.ASSERTIVA_CLIENT_ID ?? "";
const secret = process.argv[3] ?? process.env.ASSERTIVA_CLIENT_SECRET ?? "";

if (!id || !secret) {
  console.error("✗ Faltam credenciais.");
  console.error("  node scripts/test-assertiva-token.mjs <CLIENT_ID> <CLIENT_SECRET>");
  console.error("  ou defina ASSERTIVA_CLIENT_ID / ASSERTIVA_CLIENT_SECRET no ambiente.");
  process.exit(1);
}

const url = `${BASE_URL}/oauth2/v3/token`;
const basic = Buffer.from(`${id}:${secret}`).toString("base64");

console.log(`→ POST ${url}`);
console.log(`  client_id: ${id.slice(0, 4)}…${id.slice(-2)}  (Basic auth)\n`);

const started = Date.now();
let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
} catch (err) {
  console.error(`✗ Falha de rede/timeout: ${err.message}`);
  process.exit(2);
}

const elapsed = Date.now() - started;
const text = await res.text();
let data;
try { data = JSON.parse(text); } catch { data = null; }

console.log(`← HTTP ${res.status} ${res.statusText}  (${elapsed}ms)\n`);

if (!res.ok) {
  // Respostas de erro do swagger: { error, error_description }
  console.error("✗ Autenticação NÃO passou.");
  if (data?.error) console.error(`  error: ${data.error}`);
  if (data?.error_description) console.error(`  detalhe: ${data.error_description}`);
  if (!data) console.error(`  body: ${text.slice(0, 300)}`);
  console.error("\n  Dicas: 401 = credenciais erradas · 403 = empresa sem liberação de API (falar c/ suporte).");
  process.exit(3);
}

const token = data?.access_token;
if (!token) {
  console.error("✗ HTTP 200 mas sem access_token na resposta:");
  console.error(`  ${text.slice(0, 300)}`);
  process.exit(4);
}

console.log("✓ Autenticação OK — token gerado.");
console.log(`  access_token: ${String(token).slice(0, 8)}…${String(token).slice(-4)}`);
console.log(`  token_type:   ${data.token_type ?? "(ausente)"}`);
console.log(`  expires_in:   ${data.expires_in ?? "(ausente)"} s` +
  (data.expires_in ? `  (~${Math.round(Number(data.expires_in) / 60)} min)` : ""));
console.log(`  scope:        ${data.scope ?? "(ausente)"}`);

if (Number(data.expires_in) > 0 && Number(data.expires_in) < 120) {
  console.log("\n  ⚠ Token curto (<2min). O cache do adapter renova com 30s de folga — ok, mas fique de olho.");
}
