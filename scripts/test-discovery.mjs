// Quick smoke test for /discovery/search
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL não definida"); process.exit(1); }

const sql = postgres(DATABASE_URL, { max: 1 });

// Check disc_companies count
const [count] = await sql`SELECT COUNT(*) as n FROM disc_companies WHERE registration_status = 'ATIVA'`;
const [spCount] = await sql`SELECT COUNT(*) as n FROM disc_companies WHERE registration_status = 'ATIVA' AND state = 'SP'`;
const [viewCheck] = await sql`SELECT COUNT(*) as n FROM information_schema.views WHERE table_name = 'companies_search'`;
const [sectorRows] = await sql`SELECT COUNT(*) as n FROM disc_sector_cnae_map`;

console.log("=== disc_companies (ATIVA):", count.n);
console.log("=== disc_companies SP (ATIVA):", spCount.n);
console.log("=== companies_search view existe:", viewCheck.n > 0 ? "SIM" : "NÃO");
console.log("=== disc_sector_cnae_map rows:", sectorRows.n);

if (parseInt(count.n) === 0) {
  console.log("\n⚠️  Base local vazia — discovery usará fallback de IA (Groq)");
  console.log("   Para SP: ~100–160 empresas geradas por IA");
  console.log("   Para Brasil todo: ~100–160 empresas geradas por IA");
  console.log("   Para popular a base: executar o GitHub Action 'RF Monthly Import'");
} else {
  // Sample some results
  const techCnaes = await sql`SELECT cnae_code FROM disc_sector_cnae_map WHERE sector_slug ILIKE '%tecnologia%' LIMIT 5`;
  const cnaes = techCnaes.map(r => r.cnae_code);
  console.log("\nCNAEs para tecnologia:", cnaes);

  const [spResult] = await sql`
    SELECT COUNT(*) as n FROM companies_search
    WHERE registration_status = 'ATIVA' AND state = 'SP'
      AND (main_cnae = ANY(${cnaes}::text[]) OR secondary_cnaes && ${cnaes}::text[])
  `;
  const [brResult] = await sql`
    SELECT COUNT(*) as n FROM companies_search
    WHERE registration_status = 'ATIVA'
      AND (main_cnae = ANY(${cnaes}::text[]) OR secondary_cnaes && ${cnaes}::text[])
  `;
  console.log("\n=== Tecnologia em SP:", spResult.n, "empresas");
  console.log("=== Tecnologia Brasil:", brResult.n, "empresas");
}

await sql.end();
