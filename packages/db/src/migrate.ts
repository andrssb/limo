import postgres from "postgres";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

const MIGRATIONS = [
  "0000_initial",
  "0001_team_invites",
  "0002_enrichment_pool",
  "0003_lists_personas_goals",
  "0004_coaching_playbook",
  "0005_coaching_knowledge",
  "0006_enrichment_engine",
  "0007_company_discovery",
  "0008_rf_improvements",
  "0009_plans",
  "0010_sector_cnae_expanded",
  "0011_apollo_people_cache",
  "0012_list_companies",
  "0013_enr_people_match",
  "0014_enr_people_cnpj",
  "0015_evidence_bank",
  "0016_pg_trgm",
  "0017_trial_and_job",
  "0018_persona_quota",
  "0019_passive_engine_runs",
  "0020_engine_pass",
  "0021_engine_pass_disc",
  "0022_paid_enrichments",
  "0023_signup_surveys",
  "0024_rf_socios",
  "0025_disc_companies_cnae4_idx",
  "0026_call_channels",
  "0027_call_scoring",
  "0028_lead_qualifications",
  "0029_member_skills",
  "0030_team_plan_tester",
  "0031_set_manager_tester",
  "0032_assertiva_toggle",
  "0033_rename_manager",
  "0034_voip_api_key",
  "0035_extension_events",
  "0036_lia_leads",
  "0037_voice_sdr",
];

async function migrate() {
  console.log("Conectando ao banco...");

  await sql`
    CREATE TABLE IF NOT EXISTS _limo_migrations (
      id serial PRIMARY KEY,
      name varchar(255) NOT NULL UNIQUE,
      applied_at timestamp DEFAULT now() NOT NULL
    )
  `;

  for (const name of MIGRATIONS) {
    const [already] = await sql`SELECT id FROM _limo_migrations WHERE name = ${name}`;

    if (already) {
      console.log(`✓ Migration '${name}' já aplicada — pulando`);
      continue;
    }

    console.log(`→ Aplicando migration '${name}'...`);
    const migrationSQL = readFileSync(join(__dirname, "migrations", `${name}.sql`), "utf8");
    await sql.unsafe(migrationSQL);
    await sql`INSERT INTO _limo_migrations (name) VALUES (${name})`;
    console.log(`✓ Migration '${name}' aplicada com sucesso`);
  }

  await sql.end();
  console.log("Migrations concluídas.");
}

migrate().catch((err) => {
  console.error("Erro na migration:", err.message);
  process.exit(1);
});
