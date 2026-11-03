import postgres from "../node_modules/postgres/src/index.js";
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const runId = process.argv[2];
async function main() {
  const [r] = await sql`SELECT id, status, contacts_found, companies_scanned, log FROM garimpo_runs WHERE id = ${runId}`;
  if (!r) { console.log("Run não encontrado:", runId); await sql.end(); return; }
  console.log(`Run ${r.id.slice(0,8)} | ${r.status} | contacts: ${r.contacts_found} | companies: ${r.companies_scanned}`);
  const log = Array.isArray(r.log) ? r.log : [];
  for (const line of log) console.log(" ", line);
  await sql.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
