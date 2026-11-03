import postgres from "../node_modules/postgres/src/index.js";
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
async function main() {
  const [total] = await sql`SELECT COUNT(*) as n FROM disc_companies`;
  const [matrizAtiva] = await sql`SELECT COUNT(*) as n FROM disc_companies WHERE registration_status = 'ATIVA'`;
  const sample = await sql`SELECT cnpj, legal_name, main_cnae, registration_status, state FROM disc_companies LIMIT 5`;
  const [withCnae] = await sql`
    SELECT COUNT(*) as n FROM disc_companies d
    WHERE d.main_cnae IS NOT NULL
      AND LEFT(d.main_cnae, 4) IN (SELECT cnae_code FROM disc_sector_cnae_map WHERE active = TRUE)
  `;
  console.log("Total rows:", total.n);
  console.log("Ativas:", matrizAtiva.n);
  console.log("Com CNAE mapeado:", withCnae.n);
  console.log("\nAmostra:");
  for (const r of sample) console.log(" ", r.cnpj, "|", r.main_cnae, "|", r.registration_status, "|", r.state, "|", r.legal_name?.slice(0,40));
  await sql.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
