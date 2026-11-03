// Calibração da Assertiva Localize: faz UMA consulta real por nome e dumpa a
// resposta CRUA, pra descobrir os nomes reais dos campos (telefone/celular/email)
// e ajustar o adapter (assertiva.ts). O spec não documenta o corpo da resposta.
//
// Endpoint correto (confirmado no swagger /v3/swagger/localize/swagger.json):
//   GET /localize/v3/nome-endereco
//     buscarPor=pessoas | nomeOuRazaoSocial=<nome> | uf=<uf> | cidade=<cidade>
//     idFinalidade=5  (5 = Legítimo interesse → base LGPD pra prospecção/marketing;
//                      NUNCA 2=ciclo de crédito, que viola o contrato/finalidade)
//
// Uso (com env do Railway @limo/api):
//   railway run --service @limo/api -- node node_modules/tsx/dist/cli.mjs \
//     scripts/calibrate-assertiva.ts "NOME COMPLETO" [UF] [CIDADE]
//
// É UMA consulta paga. Não rodar em loop.

const BASE_URL = process.env.ASSERTIVA_BASE_URL ?? "https://api.assertivasolucoes.com.br";
const ID_FINALIDADE = "5"; // Legítimo interesse

const [, , nome, uf, cidade] = process.argv;
if (!nome) {
  console.error('Uso: ... calibrate-assertiva.ts "NOME COMPLETO" [UF] [CIDADE]');
  process.exit(1);
}

async function token(): Promise<string> {
  const id = process.env.ASSERTIVA_CLIENT_ID;
  const secret = process.env.ASSERTIVA_CLIENT_SECRET;
  if (!id || !secret) throw new Error("ASSERTIVA_CLIENT_ID/SECRET ausentes no ambiente");
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(`${BASE_URL}/oauth2/v3/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`auth ${res.status}: ${await res.text()}`);
  return (await res.json() as any).access_token;
}

async function main() {
  const t = await token();

  // Modo CPF: se o 1º arg só tem dígitos/pontos/traços, consulta /localize/v3/cpf
  const isCpf = /^[\d.\-]+$/.test(nome.trim());
  let url: string;
  if (isCpf) {
    const cpf = nome.replace(/\D/g, "");
    console.log(`\n🔎 cpf: ${cpf} | idFinalidade=${ID_FINALIDADE}\n`);
    url = `${BASE_URL}/localize/v3/cpf?${new URLSearchParams({ cpf, idFinalidade: ID_FINALIDADE }).toString()}`;
  } else {
  console.log(`\n🔎 nome-endereco: "${nome}"${uf ? ` / ${uf}` : ""}${cidade ? ` / ${cidade}` : ""} | idFinalidade=${ID_FINALIDADE}\n`);
  const params = new URLSearchParams({
    buscarPor: "pessoas",
    nomeOuRazaoSocial: nome,
    idFinalidade: ID_FINALIDADE,
  });
  if (uf) params.set("uf", uf);
  if (cidade) params.set("cidade", cidade);
  url = `${BASE_URL}/localize/v3/nome-endereco?${params.toString()}`;
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${t}`, Accept: "application/json" } });
  console.log(`HTTP ${res.status}`);
  console.log("protocolo (header):", res.headers.get("protocolo") ?? res.headers.get("x-protocolo") ?? "—");

  const text = await res.text();
  let raw: any;
  try { raw = JSON.parse(text); } catch { raw = text; }
  console.log("\n===== RESPOSTA CRUA =====");
  console.log(JSON.stringify(raw, null, 2).slice(0, 8000));
}

main().catch((e) => { console.error("ERRO:", e); process.exit(1); });
