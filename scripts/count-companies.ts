import postgres from "../node_modules/postgres/src/index.js";
const sql = postgres(process.env.DATABASE_URL!);
async function main() {
  const r = await sql`SELECT COUNT(*) as n, COUNT(DISTINCT state) as states FROM disc_companies`;
  console.log(`Total: ${r[0].n} empresas em ${r[0].states} estados`);
  await sql.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
