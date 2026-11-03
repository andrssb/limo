import postgres from "../node_modules/postgres/src/index.js";
const sql = postgres(process.env.DATABASE_URL!, { max: 1, connect_timeout: 30 });

async function main() {
  console.log("Deletando empresas fora do mapa de setores...");
  const r = await sql`
    DELETE FROM disc_companies
    WHERE main_cnae IS NULL
       OR main_cnae NOT IN (
         SELECT cnae_code FROM disc_sector_cnae_map WHERE active = TRUE
       )
  `;
  console.log(`Deletadas: ${(r as any).count} linhas`);

  const [c] = await sql`SELECT COUNT(*) as n FROM disc_companies`;
  console.log(`Restaram: ${c.n} empresas com CNAE mapeado`);

  console.log("Rodando VACUUM ANALYZE para liberar espaço...");
  await sql`VACUUM ANALYZE disc_companies`;
  console.log("Concluído.");
  await sql.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
