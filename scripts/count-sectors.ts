import postgres from "../node_modules/postgres/src/index.js";
const sql = postgres(process.env.DATABASE_URL!);
async function main() {
  const [total] = await sql`SELECT COUNT(*) as n FROM disc_sector_cnae_map WHERE active = TRUE`;
  const rows = await sql`SELECT sector_name, COUNT(*) as n FROM disc_sector_cnae_map WHERE active = TRUE GROUP BY sector_name ORDER BY sector_name`;
  console.log(`\nTotal: ${total.n} entradas\n`);
  for (const r of rows) console.log(`  ${String(r.sector_name).padEnd(20)} ${r.n} CNAEs`);
  await sql.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
