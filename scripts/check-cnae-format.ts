import postgres from "../node_modules/postgres/src/index.js";
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
async function main() {
  const rows = await sql`SELECT cnae_code FROM disc_sector_cnae_map LIMIT 5`;
  console.log("Formato no mapa:", rows.map((r: any) => r.cnae_code));
  await sql.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
