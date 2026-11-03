// Verifica estado da tabela disc_companies no banco apontado por DATABASE_URL.
// Uso: npx railway run --service "@limo/api" node scripts/check-disc.mjs
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL não definida"); process.exit(1); }

const sql = postgres(url, { connect_timeout: 10, ssl: "require", max: 1 });

try {
  const tabs = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'disc_%'
    ORDER BY table_name
  `;
  console.log("Tabelas disc_*:", tabs.map(t => t.table_name).join(", ") || "(nenhuma)");

  if (tabs.length === 0) {
    console.log("Migration 0007 não foi rodada ainda.");
    process.exit(0);
  }

  const [r]   = await sql`SELECT COUNT(*) as n FROM disc_companies`;
  console.log(`disc_companies: ${r.n} linhas`);

  if (parseInt(r.n) === 0) {
    console.log("Tabela vazia — nunca importou nada.");
    process.exit(0);
  }

  const [r2]  = await sql`SELECT COUNT(*) as n FROM disc_companies WHERE registration_status = 'ATIVA'`;
  console.log(`  ATIVA: ${r2.n}`);

  const states = await sql`
    SELECT state, COUNT(*) as n FROM disc_companies
    WHERE state IS NOT NULL
    GROUP BY state ORDER BY n DESC LIMIT 5
  `;
  console.log("  Top 5 estados:", states.map(s => `${s.state}=${s.n}`).join(", "));

  const sample = await sql`
    SELECT cnpj, legal_name, state, city, main_cnae, company_size
    FROM disc_companies LIMIT 3
  `;
  console.log("  Amostra:");
  sample.forEach(r => console.log(`    ${r.cnpj} | ${(r.legal_name||"").slice(0,40)} | ${r.state} | ${r.city} | ${r.main_cnae} | ${r.company_size}`));

  const [r3]  = await sql`SELECT COUNT(*) as n FROM disc_company_domains`;
  console.log(`disc_company_domains: ${r3.n} linhas`);

  const [r4]  = await sql`SELECT COUNT(*) as n FROM disc_sector_cnae_map WHERE active`;
  console.log(`disc_sector_cnae_map: ${r4.n} mapeamentos ativos`);
} catch (e) {
  console.error("ERRO:", e.code || "", e.message);
} finally {
  await sql.end({ timeout: 3 });
}
