// E2E: a função real que o crawler do Garimpo chama (findSocios) retornando os
// decisores do QSA da RF por CNPJ. Sem Assertiva, sem config do app — só o banco.
import { findSocios } from "../apps/api/src/services/enrichment/engine/socios_finder.js";

const cnpj = process.argv[2] ?? "00000042000100";

async function main() {
  const socios = await findSocios(cnpj);
  console.log(`findSocios("${cnpj}") → ${socios.length} decisor(es):`);
  for (const s of socios) {
    console.log(`  - firstName="${s.firstName}" lastName="${s.lastName}" cargo="${s.cargo}"`);
  }
  process.exit(0);
}
main().catch((e) => { console.error("ERRO:", e); process.exit(1); });
