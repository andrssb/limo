/**
 * Importador Brasil.io → disc_companies
 *
 * Fonte: https://data.brasil.io/dataset/socios-brasil/empresa.csv.gz
 * Arquivo único ~2.5 GB comprimido, UTF-8, com header.
 *
 * Uso:
 *   node node_modules/tsx/dist/cli.mjs scripts/import-brasil-io.ts
 *   node node_modules/tsx/dist/cli.mjs scripts/import-brasil-io.ts --uf SP
 */

import { createWriteStream, existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { createReadStream } from "fs";
import { createGunzip } from "zlib";
import { createInterface } from "readline";
import { pipeline } from "stream/promises";
import https from "https";
import postgres from "../node_modules/postgres/src/index.js";

const URL_EMPRESA = "https://data.brasil.io/dataset/socios-brasil/empresa.csv.gz";
const DEST_GZ     = `${tmpdir()}/empresa.csv.gz`;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL nao definida"); process.exit(1); }

const ufArg = process.argv.includes("--uf")
  ? process.argv[process.argv.indexOf("--uf") + 1]?.toUpperCase()
  : undefined;

let sql = postgres(DATABASE_URL, { max: 1, idle_timeout: 0, connect_timeout: 30 });

async function loadValidCnaes(): Promise<Set<string>> {
  const rows = await sql`SELECT cnae_code FROM disc_sector_cnae_map WHERE active = TRUE`;
  // cnae_code is stored as 4-digit class (e.g. "6201"); Brasil.io has full 7-digit subclass (e.g. "6201500")
  // We match on the first 4 digits of the full code
  const codes = new Set(rows.map((r: any) => String(r.cnae_code).replace(/[^0-9]/g, "").slice(0, 4)));
  console.log(`  ${codes.size} CNAEs válidos carregados do mapa de setores`);
  return codes;
}

async function reconnect() {
  try { await sql.end({ timeout: 5 }); } catch {}
  sql = postgres(DATABASE_URL!, { max: 1, idle_timeout: 0, connect_timeout: 30 });
}

// ─── CNPJ helpers ─────────────────────────────────────────────────────────────

function formatCnpj(raw: string): string {
  const d = raw.replace(/\D/g, "").padStart(14, "0");
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12,14)}`;
}

// ─── Porte map ────────────────────────────────────────────────────────────────

const PORTE: Record<string, string> = {
  "00": "NAO_INFORMADO",
  "01": "ME",
  "03": "EPP",
  "05": "DEMAIS",    // MEDIO or GRANDE — enriched later by employee count
};

// ─── Download ─────────────────────────────────────────────────────────────────

async function download(url: string, dest: string): Promise<void> {
  if (existsSync(dest)) {
    console.log(`  Arquivo ja existe: ${dest}`);
    return;
  }
  console.log(`  Baixando ${url} ...`);
  await new Promise<void>((resolve, reject) => {
    const file = createWriteStream(dest);
    https.get(url, { headers: { "User-Agent": "LimoImporter/2.0" } }, (res) => {
      const total = parseInt(res.headers["content-length"] ?? "0");
      let received = 0;
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (total) process.stdout.write(`\r  ${(received/1e9).toFixed(2)}/${(total/1e9).toFixed(2)} GB`);
      });
      res.pipe(file);
      file.on("finish", () => { process.stdout.write("\n"); resolve(); });
      file.on("error", reject);
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ─── Import ───────────────────────────────────────────────────────────────────

const BATCH = 500;
const RECONNECT_EVERY = 100_000;

async function importData(validCnaes: Set<string>): Promise<void> {
  let headers: string[] = [];
  let inserted = 0;
  let skipped  = 0;
  let batch: any[] = [];
  let sinceReconnect = 0;

  async function flush() {
    if (batch.length === 0) return;
    const rows = batch.map(r => ({
      cnpj:                r.cnpj,
      legal_name:          r.legal_name ?? "",
      trade_name:          r.trade_name,
      registration_status: r.registration_status,
      main_cnae:           r.main_cnae,
      state:               r.state,
      city:                r.city,
      company_size:        r.company_size,
      capital_social:      r.capital_social,
      opening_date:        r.opening_date,
      public_phone:        r.public_phone,
      confidence_score:    r.confidence_score,
    }));

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await sql`
          INSERT INTO disc_companies ${sql(rows)}
          ON CONFLICT (cnpj) DO NOTHING
        `;
        break;
      } catch (err: any) {
        const msg = String(err.message ?? "");
        const isConnErr = err.code === "ECONNRESET"
          || msg.includes("ECONNRESET")
          || msg.includes("Connection terminated")
          || msg.includes("CONNECTION_CLOSED")
          || msg.includes("write CONNECTION")
          || msg.includes("connection closed");
        if (attempt < 3 && isConnErr) {
          console.log(`  Conexao perdida, reconectando (tentativa ${attempt})...`);
          await reconnect();
          continue;
        }
        throw err;
      }
    }

    inserted += batch.length;
    sinceReconnect += batch.length;
    batch = [];

    if (inserted % 10000 === 0) console.log(`  ${inserted.toLocaleString()} inseridos...`);

    if (sinceReconnect >= RECONNECT_EVERY) {
      process.stdout.write(`  [reconexao preventiva em ${inserted.toLocaleString()}]\n`);
      await reconnect();
      sinceReconnect = 0;
    }
  }

  const gunzip = createGunzip();
  const fileStream = createReadStream(DEST_GZ);
  const rl = createInterface({ input: fileStream.pipe(gunzip), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    // Parse CSV respeitando aspas
    const cols = parseCsvLine(line);

    if (headers.length === 0) {
      headers = cols;
      continue;
    }

    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ""; });

    // Filtros
    if (row["identificador_matriz_filial"] !== "1") { skipped++; continue; } // apenas MATRIZ
    if (row["situacao_cadastral"] !== "2")           { skipped++; continue; } // apenas ATIVA
    if (ufArg && row["uf"] !== ufArg)               { skipped++; continue; }

    const rawCnae = (row["cnae_fiscal"] ?? "").replace(/[^0-9]/g, "");
    if (!validCnaes.has(rawCnae.slice(0, 4)))       { skipped++; continue; } // apenas CNAEs mapeados

    const cnpj = formatCnpj(row["cnpj"] ?? "");
    if (!cnpj || cnpj.length < 14) { skipped++; continue; }

    const phone = buildPhone(row["ddd_telefone_1"] ?? "");
    const capital = parseFloat(row["capital_social"]?.replace(",", ".") ?? "0") || null;
    const openingDate = parseDate(row["data_inicio_atividade"] ?? "");

    batch.push({
      cnpj,
      legal_name:          (row["razao_social"] ?? "").trim() || null,
      trade_name:          (row["nome_fantasia"] ?? "").trim() || null,
      registration_status: "ATIVA",
      main_cnae:           (row["cnae_fiscal"] ?? "").replace(/[^0-9]/g, "") || null,
      secondary_cnaes:     [],
      state:               (row["uf"] ?? "").trim() || null,
      city:                (row["municipio"] ?? "").trim() || null,
      company_size:        PORTE[row["porte"] ?? ""] ?? "NAO_INFORMADO",
      capital_social:      capital,
      opening_date:        openingDate,
      public_phone:        phone || null,
      public_email:        null,
      confidence_score:    80,
    });

    if (batch.length >= BATCH) await flush();
  }

  await flush();
  console.log(`\nConcluido: ${inserted.toLocaleString()} inseridos | ${skipped.toLocaleString()} pulados`);
}

// ─── CSV parser (handles quoted fields with commas) ───────────────────────────

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      result.push(cur); cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function buildPhone(ddd: string): string {
  const d = ddd.replace(/\D/g, "");
  if (d.length >= 10) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length > 0)   return d;
  return "";
}

function parseDate(s: string): string | null {
  if (!s || s === "0" || s.length < 8) return null;
  // Brasil.io format: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Import Brasil.io -> disc_companies ${ufArg ? `(UF: ${ufArg})` : "(Brasil todo)"} ===\n`);
  const validCnaes = await loadValidCnaes();
  await download(URL_EMPRESA, DEST_GZ);
  console.log("Importando (apenas CNAEs do mapa de setores)...");
  await importData(validCnaes);
  await sql.end();
}

main().catch((err) => { console.error("Erro:", err.message); process.exit(1); });
