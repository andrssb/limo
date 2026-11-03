/**
 * Monitor automático do servidor da Receita Federal.
 * Roda em loop, verifica a cada hora se dadosabertos.rfb.gov.br voltou.
 * Quando o servidor responder, baixa os arquivos e roda o import automaticamente.
 *
 * Uso:
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/rf-auto-retry.ts \
 *     [--uf SP] [--cnaes 6201,6202] [--limit 500000] [--output C:\rf-data]
 *
 * Mantenha o terminal aberto. Quando a RF voltar, o download inicia sozinho.
 */

import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync, statSync } from "fs";
import https from "https";
import path from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

function arg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] ?? null : null;
}

const UF        = arg("--uf");
const CNAES     = arg("--cnaes");
const LIMIT     = arg("--limit") ?? "500000";
const OUTPUT    = arg("--output") ?? "C:\\rf-data";
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hora

const RF_TEST_URL  = "https://dadosabertos.rfb.gov.br/CNPJ/Municipios.zip";
const RF_BASE_URL  = "https://dadosabertos.rfb.gov.br/CNPJ";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function log(msg: string) {
  console.log(`[${now()}] ${msg}`);
}

function checkRFServer(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.request(RF_TEST_URL, {
      method: "HEAD",
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 302);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = require("fs").createWriteStream(dest);
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://dadosabertos.rfb.gov.br/CNPJ/",
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const totalBytes = parseInt(res.headers["content-length"] ?? "0");
      let downloaded = 0;
      let lastPct = -1;

      res.on("data", (chunk) => {
        downloaded += chunk.length;
        if (totalBytes > 0) {
          const pct = Math.floor((downloaded / totalBytes) * 100);
          if (pct !== lastPct && pct % 10 === 0) {
            process.stdout.write(`\r    ${pct}% (${(downloaded / 1024 / 1024).toFixed(0)} MB)`);
            lastPct = pct;
          }
        }
      });

      res.pipe(file);
      file.on("finish", () => { file.close(); console.log(""); resolve(); });
    }).on("error", reject);
  });
}

function unzip(zipPath: string, destDir: string): void {
  try {
    execSync(`powershell -Command "Expand-Archive -Force '${zipPath}' '${destDir}'"`, { stdio: "pipe" });
  } catch {
    // Try 7zip if available
    try {
      execSync(`7z x "${zipPath}" -o"${destDir}" -y`, { stdio: "pipe" });
    } catch {
      log(`⚠️  Não foi possível extrair ${path.basename(zipPath)} automaticamente.`);
      log(`   Extraia manualmente para: ${destDir}`);
    }
  }
}

// ─── Download all RF files ────────────────────────────────────────────────────

async function downloadRFFiles(): Promise<boolean> {
  const empDir   = path.join(OUTPUT, "empresas");
  const estabDir = path.join(OUTPUT, "estabelecimentos");
  mkdirSync(empDir,   { recursive: true });
  mkdirSync(estabDir, { recursive: true });

  const filesToDownload = [
    { name: "Municipios.zip", destDir: OUTPUT },
    ...Array.from({ length: 10 }, (_, i) => ({ name: `Empresas${i}.zip`,       destDir: empDir })),
    ...Array.from({ length: 10 }, (_, i) => ({ name: `Estabelecimentos${i}.zip`, destDir: estabDir })),
  ];

  for (const { name, destDir } of filesToDownload) {
    const zipPath = path.join(destDir, name);
    const csvName = name.replace(".zip", ".csv");
    const csvPath = path.join(destDir, csvName);

    if (existsSync(csvPath) && statSync(csvPath).size > 1024) {
      log(`  ⏭  ${name} já extraído — pulando`);
      continue;
    }

    if (!existsSync(zipPath) || statSync(zipPath).size < 1024) {
      log(`  ↓  Baixando ${name}...`);
      try {
        await downloadFile(`${RF_BASE_URL}/${name}`, zipPath);
        log(`  ✓  ${name} baixado`);
      } catch (e: any) {
        log(`  ✗  Falha em ${name}: ${e.message}`);
        return false;
      }
    }

    log(`  📦 Extraindo ${name}...`);
    unzip(zipPath, destDir);
  }

  return true;
}

// ─── Run import script ────────────────────────────────────────────────────────

async function runImport(): Promise<void> {
  const scriptPath = path.join(process.cwd(), "scripts", "import-receita-federal.ts");

  const args = [
    "--env-file=.env",
    path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
    scriptPath,
    "--empresas",       path.join(OUTPUT, "empresas"),
    "--estabelecimentos", path.join(OUTPUT, "estabelecimentos"),
    "--municipios",     path.join(OUTPUT, "Municipios.csv"),
  ];

  if (UF)     args.push("--uf",    UF);
  if (CNAES)  args.push("--cnaes", CNAES);
  if (LIMIT)  args.push("--limit", LIMIT);

  log("🚀 Iniciando import para o banco...");
  log(`   Comando: node ${args.join(" ")}`);

  return new Promise((resolve, reject) => {
    const proc = spawn("node", args, { stdio: "inherit", cwd: process.cwd() });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Import terminou com código ${code}`));
    });
  });
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  const config = [
    UF     && `UF: ${UF}`,
    CNAES  && `CNAEs: ${CNAES}`,
    LIMIT  && `Limite: ${parseInt(LIMIT).toLocaleString()}`,
    `Output: ${OUTPUT}`,
  ].filter(Boolean).join(" | ");

  console.log("═══════════════════════════════════════════════════════");
  console.log("  Monitor automático — Dados Abertos Receita Federal");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Config: ${config}`);
  console.log(`  Verificando servidor a cada 1 hora.`);
  console.log(`  Pressione Ctrl+C para parar.\n`);

  let attempt = 0;

  while (true) {
    attempt++;
    log(`🔍 Tentativa ${attempt} — verificando dadosabertos.rfb.gov.br...`);

    const online = await checkRFServer();

    if (!online) {
      const nextCheck = new Date(Date.now() + CHECK_INTERVAL_MS);
      log(`❌ Servidor offline. Próxima verificação: ${nextCheck.toLocaleTimeString("pt-BR")}\n`);
      await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
      continue;
    }

    log("✅ Servidor RF online! Iniciando download automático...\n");

    try {
      const ok = await downloadRFFiles();
      if (!ok) {
        log("⚠️  Download incompleto — tentando novamente em 1h\n");
        await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
        continue;
      }

      await runImport();

      log("\n🎉 Import concluído com sucesso!");
      log("   A busca em Descobrir agora usa dados reais da Receita Federal.");
      log("   Você pode fechar este terminal.\n");
      process.exit(0);

    } catch (e: any) {
      log(`❌ Erro durante download/import: ${e.message}`);
      log("   Tentando novamente em 1h...\n");
      await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
    }
  }
}

main().catch((e) => {
  console.error("Erro fatal:", e.message);
  process.exit(1);
});
