import postgres from "../node_modules/postgres/src/index.js";
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
async function main() {
  const runs = await sql`
    SELECT id, status, completed_at, contacts_found, companies_scanned, log
    FROM garimpo_runs
    ORDER BY id DESC
    LIMIT 5
  `;
  if (runs.length === 0) { console.log("Nenhum run encontrado."); }
  for (const r of runs) {
    console.log(`\nRun ${r.id.slice(0,8)} | ${r.status} | completedAt: ${r.completed_at}`);
    console.log(`  contacts: ${r.contacts_found} | companies: ${r.companies_scanned}`);
    const log = Array.isArray(r.log) ? r.log : [];
    for (const line of log.slice(-5)) console.log(" ", line);
  }
  await sql.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
