import EmbeddedPostgres from "embedded-postgres";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pg = new EmbeddedPostgres({
  databaseDir: "C:/pgdata-embedded",
  user: "postgres",
  password: "postgres",
  port: 5432,
  persistent: true,
});

console.log("Iniciando PostgreSQL embutido...");
await pg.initialise();
await pg.start();
console.log("PostgreSQL rodando na porta 5432");

// Create database
try {
  await pg.createDatabase("limo_db");
  console.log("Banco limo_db criado");
} catch (e) {
  if (e.message?.includes("already exists")) {
    console.log("Banco limo_db já existe");
  } else {
    console.error("Erro ao criar banco:", e.message);
  }
}

// Run migration SQL
console.log("Rodando migration...");
const sql = postgres("postgresql://postgres:postgres@localhost:5432/limo_db");
const migrationSQL = readFileSync(
  join(__dirname, "../packages/db/src/migrations/0000_initial.sql"),
  "utf8"
);

try {
  // Check if already migrated
  const [already] = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = '_limo_migrations' AND table_schema = 'public'
  `;
  if (already) {
    const [done] = await sql`SELECT id FROM _limo_migrations WHERE name = '0000_initial'`;
    if (done) {
      console.log("Migration já aplicada");
      await sql.end();
      console.log("\n✅ PostgreSQL pronto em localhost:5432 (banco: limo_db)");
      process.exit(0);
    }
  }
} catch {}

await sql.unsafe(migrationSQL);
await sql`
  CREATE TABLE IF NOT EXISTS _limo_migrations (
    id serial PRIMARY KEY,
    name varchar(255) NOT NULL UNIQUE,
    applied_at timestamp DEFAULT now() NOT NULL
  )
`;
await sql`INSERT INTO _limo_migrations (name) VALUES ('0000_initial') ON CONFLICT DO NOTHING`;
await sql.end();

console.log("\n✅ Migrations aplicadas com sucesso!");
console.log("✅ PostgreSQL rodando em localhost:5432 (banco: limo_db)");
console.log("\nNão feche esta janela — o PostgreSQL ficará ativo.");
console.log("Para parar: Ctrl+C");

// Keep alive
process.on("SIGINT", async () => {
  console.log("Parando PostgreSQL...");
  await pg.stop();
  process.exit(0);
});
