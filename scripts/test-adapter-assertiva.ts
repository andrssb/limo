// Testa o adapter real (assertiva.enrichPerson) ponta a ponta: nome → CPF →
// telefones/emails. Faz 2 consultas pagas. Uso:
//   railway run --service @limo/api -- node node_modules/tsx/dist/cli.mjs \
//     scripts/test-adapter-assertiva.ts "Primeiro" "Resto Do Nome" [UF] [Cidade]
import { assertiva } from "../apps/api/src/services/enrichment/providers/assertiva.js";

const [, , firstName, lastName, state, city] = process.argv;
async function main() {
  const out = await assertiva.enrichPerson({
    firstName: firstName ?? "", lastName: lastName ?? "", state, city,
  });
  console.log(JSON.stringify({
    matched: out.matched,
    matchConfidence: out.matchConfidence,
    phones: out.phones,
    emails: out.emails,
  }, null, 2));
}
main().catch((e) => { console.error("ERRO:", e); process.exit(1); });
