/**
 * Baixa os arquivos de dados abertos da Receita Federal.
 *
 * Uso:
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/download-receita-federal.ts \
 *     --output /caminho/para/pasta/rf-data/ \
 *     [--only empresas]          # só baixa Empresas (menor)
 *     [--only estabelecimentos]  # só baixa Estabelecimentos (maior)
 *     [--only municipios]        # só baixa Municípios (pequeno)
 *
 * Tamanhos aproximados (comprimidos):
 *   Empresas:         ~2 GB  (10 arquivos × ~200 MB)
 *   Estabelecimentos: ~9 GB  (10 arquivos × ~900 MB)
 *   Municípios:       ~50 KB (1 arquivo)
 */

import { createWriteStream, mkdirSync, existsSync, statSync } from "fs";
import { pipeline } from "stream/promises";
import path from "path";
import { execSync } from "child_process";

const RF_BASE = "https://dadosabertos.rfb.gov.br/CNPJ";

const FILES = {
  municipios:       ["Municipios.zip"],
  empresas:         Array.from({ length: 10 }, (_, i) => `Empresas${i}.zip`),
  estabelecimentos: Array.from({ length: 10 }, (_, i) => `Estabelecimentos${i}.zip`),
  socios:           Array.from({ length: 10 }, (_, i) => `Socios${i}.zip`),   // QSA — nomes de sócios por CNPJ
};

function arg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] ?? null : null;
}

const OUTPUT_DIR = arg("--output") ?? "./rf-data";
const ONLY       = arg("--only");

mkdirSync(OUTPUT_DIR, { recursive: true });

async function downloadFile(url: string, destPath: string): Promise<void> {
  if (existsSync(destPath)) {
    const size = statSync(destPath).size;
    console.log(`  ⏭  ${path.basename(destPath)} já existe (${(size / 1024 / 1024).toFixed(1)} MB) — pulando`);
    return;
  }

  console.log(`  ↓  ${path.basename(url)}...`);
  const t0 = Date.now();

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; LimoImporter/1.0)" },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} para ${url}`);

  const fileStream = createWriteStream(destPath);
  await pipeline(res.body as any, fileStream);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const size    = statSync(destPath).size;
  console.log(`  ✓  ${path.basename(destPath)} — ${(size / 1024 / 1024).toFixed(1)} MB em ${elapsed}s`);
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const name = path.basename(zipPath, ".zip");
  const outPath = path.join(destDir, name + ".csv");
  if (existsSync(outPath)) {
    console.log(`  ⏭  ${name}.csv já extraído — pulando`);
    return;
  }
  console.log(`  📦 Extraindo ${path.basename(zipPath)}...`);
  try {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: "pipe" });
    // RF files often have no extension — rename to .csv
    execSync(`
      for f in "${destDir}"/*; do
        if [ -f "$f" ] && [[ "$f" != *.csv ]] && [[ "$f" != *.zip ]]; then
          mv "$f" "$f.csv"
        fi
      done
    `, { stdio: "pipe", shell: "/bin/bash" });
    console.log(`  ✓  ${name}.csv extraído`);
  } catch (e: any) {
    console.warn(`  ⚠️  Extração falhou (${e.message}) — use unzip manualmente`);
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Download — Dados Abertos Receita Federal (CNPJ)");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Destino: ${path.resolve(OUTPUT_DIR)}`);
  console.log("");

  const toDownload: string[] = [];

  if (!ONLY || ONLY === "municipios") toDownload.push(...FILES.municipios);
  if (!ONLY || ONLY === "empresas")   toDownload.push(...FILES.empresas);
  if (!ONLY || ONLY === "estabelecimentos") toDownload.push(...FILES.estabelecimentos);
  if (ONLY === "socios")              toDownload.push(...FILES.socios);

  const totalMB = toDownload.includes("Socios0.zip") ? 1_500
    : toDownload.length === FILES.municipios.length ? 0.05
    : toDownload.includes("Empresas0.zip") && toDownload.includes("Estabelecimentos0.zip") ? 11_000
    : toDownload.includes("Empresas0.zip") ? 2_000
    : 9_000;

  console.log(`  Arquivos a baixar: ${toDownload.length}`);
  if (totalMB > 0) console.log(`  Tamanho estimado: ~${(totalMB / 1024).toFixed(0)} GB\n`);

  for (const filename of toDownload) {
    const url      = `${RF_BASE}/${filename}`;
    const zipPath  = path.join(OUTPUT_DIR, filename);
    const lf       = filename.toLowerCase();
    const csvDir   = path.join(OUTPUT_DIR, filename.includes("Municipio") ? "" :
                       lf.includes("socio")   ? "socios" :
                       lf.includes("empresa") ? "empresas" :
                       "estabelecimentos");

    mkdirSync(csvDir || OUTPUT_DIR, { recursive: true });

    await downloadFile(url, zipPath);
    await extractZip(zipPath, csvDir || OUTPUT_DIR);
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("✅ Download concluído\n");
  console.log("Próximo passo — importar para o banco:");
  console.log(`
  # Produção (via DATABASE_URL do Railway):
  DATABASE_URL="postgresql://..." node --env-file=.env \\
    node_modules/tsx/dist/cli.mjs scripts/import-receita-federal.ts \\
    --empresas    ${path.resolve(OUTPUT_DIR)}/empresas/ \\
    --estabelecimentos ${path.resolve(OUTPUT_DIR)}/estabelecimentos/ \\
    --municipios  ${path.resolve(OUTPUT_DIR)}/Municipios.csv

  # Só SP (mais rápido para testar):
  DATABASE_URL="postgresql://..." node --env-file=.env \\
    node_modules/tsx/dist/cli.mjs scripts/import-receita-federal.ts \\
    --empresas    ${path.resolve(OUTPUT_DIR)}/empresas/ \\
    --estabelecimentos ${path.resolve(OUTPUT_DIR)}/estabelecimentos/ \\
    --uf SP --limit 500000
  `);
}

main().catch((e) => {
  console.error("Erro:", e.message);
  process.exit(1);
});
