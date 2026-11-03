import postgres from "../node_modules/postgres/src/index.js";
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
async function main() {
  const runs = await sql`
    SELECT id, status, persona_id, contacts_found, companies_scanned, log
    FROM garimpo_runs
    WHERE status IN ('pending', 'running')
    ORDER BY id DESC LIMIT 5
  `;
  console.log("Runs pendentes/rodando:", runs.length);
  for (const r of runs) {
    console.log(`  ${r.id.slice(0,8)} | ${r.status} | persona: ${r.persona_id?.slice(0,8)}`);
    const log = Array.isArray(r.log) ? r.log : [];
    for (const line of log.slice(-3)) console.log("   ", line);
  }
  await sql.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
