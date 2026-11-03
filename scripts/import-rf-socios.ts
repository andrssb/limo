/**
 * Importador do QSA (Sócios) da Receita Federal → rf_socios
 *
 * Popula a tabela rf_socios com os SÓCIOS PESSOA FÍSICA (nomes de decisores)
 * por CNPJ. O Garimpo consulta essa tabela sob demanda (join por cnpj_basico).
 *
 * Uso:
 *   DATABASE_URL="postgresql://..." node --env-file=.env \
 *     node_modules/tsx/dist/cli.mjs scripts/import-rf-socios.ts \
 *     --socios /caminho/para/pasta/socios/ \
 *     [--truncate]        # limpa rf_socios antes (reimport limpo)
 *     [--limit 100000]    # limita total (teste)
 *
 * Formato RF (Socios*.csv): delimitador ';', Latin-1, sem cabeçalho, posicional.
 */

import { createReadStream, readdirSync } from "fs";
import { createInterface } from "readline";
import postgres from "../node_modules/postgres/src/index.js";
import path from "path";

// ─── Colunas do arquivo Socios ────────────────────────────────────────────────
const SOC = {
  CNPJ_BASICO:          0,
  IDENTIFICADOR_SOCIO:  1,   // 1=PJ 2=PF 3=estrangeiro
  NOME_SOCIO:           2,
  CNPJ_CPF_SOCIO:       3,   // CPF mascarado ***NNNNNN** para PF
  QUALIFICACAO:         4,
  DATA_ENTRADA:         5,   // YYYYMMDD
  FAIXA_ETARIA:        10,
};

// Qualificação RF (código → rótulo) — só os papéis de decisor mais comuns.
const QUALIF: Record<string, string> = {
  "05": "Administrador",
  "08": "Conselheiro de Administração",
  "10": "Diretor",
  "16": "Presidente",
  "17": "Procurador",
  "20": "Sociedade Consorciada",
  "22": "Sócio",
  "23": "Sócio Capitalista",
  "24": "Sócio Comanditado",
  "28": "Sócio-Gerente",
  "29": "Sócio Incapaz ou Relat.(exceto menor)",
  "30": "Sócio Menor (Assistido/Representado)",
  "31": "Sócio Ostensivo",
  "37": "Sócio Pessoa Física Residente no Brasil",
  "49": "Sócio-Administrador",
  "52": "Sócio com Capital",
  "54": "Fundador",
  "65": "Titular Pessoa Física (Empresário)",
};

function arg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] ?? null : null;
}

const SOCIOS_DIR = arg("--socios");
const LIMIT      = parseInt(arg("--limit") ?? "0") || 0;
const TRUNCATE   = process.argv.includes("--truncate");

if (!SOCIOS_DIR) { console.error("Uso: --socios <dir>"); process.exit(1); }

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL não definida"); process.exit(1); }
const sql = postgres(DATABASE_URL, { max: 3 });

// ─── Helpers (mesmo padrão do import-receita-federal) ─────────────────────────
function parseCsv(line: string): string[] {
  const fields: string[] = [];
  let inQuote = false, current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ";" && !inQuote) { fields.push(current.trim()); current = ""; }
    else current += ch;
  }
  fields.push(current.trim());
  return fields;
}

function csvFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => {
      const l = f.toLowerCase();
      return l.endsWith(".csv") || l.endsWith(".txt") || !l.includes(".") || !!l.match(/\d+$/);
    })
    .map((f) => path.join(dir, f))
    .sort();
}

// for-await aplica backpressure: espera cada onLine (e seus flushes) antes de
// puxar a próxima linha. Sem isso, o readline-com-handler-async acumula batch +
// promises sem limite e estoura a heap (ainda mais pelo proxy lento).
async function streamLines(filePath: string, onLine: (fields: string[]) => Promise<boolean | void>): Promise<void> {
  // Latin-1 decodificado no nível do stream (correto); for-await dá backpressure.
  const rl = createInterface({ input: createReadStream(filePath, { encoding: "latin1" }), crlfDelay: Infinity, terminal: false });
  for await (const line of rl) {
    const stop = await onLine(parseCsv(line)).catch((e) => { console.error(`  linha: ${e.message}`); });
    if (stop === false) break;
  }
}

function toDate(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  return /^\d{8}$/.test(s) && s !== "00000000" ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  Importador QSA Receita Federal → rf_socios");
  console.log("═══════════════════════════════════════");
  console.log(`  Sócios dir: ${SOCIOS_DIR}`);
  console.log(`  Limite:     ${LIMIT > 0 ? LIMIT.toLocaleString() : "(sem limite)"}`);
  console.log(`  Truncate:   ${TRUNCATE}\n`);

  if (TRUNCATE) {
    console.log("  Limpando rf_socios...");
    await sql`TRUNCATE rf_socios`;
  }

  const files = csvFiles(SOCIOS_DIR!);
  console.log(`  ${files.length} arquivo(s) em ${SOCIOS_DIR}\n`);

  let total = 0, skipped = 0;
  let batch: any[] = [];

  async function flush() {
    if (batch.length === 0) return;
    try {
      await sql`
        INSERT INTO rf_socios
          (cnpj_basico, nome_socio, cpf_mascarado, qualificacao, cargo, faixa_etaria, data_entrada)
        VALUES ${sql(batch.map((r) => [
          r.cnpj_basico, r.nome_socio, r.cpf_mascarado, r.qualificacao, r.cargo, r.faixa_etaria, r.data_entrada,
        ]))}
      `;
    } catch (e: any) {
      console.error(`  batch error: ${e.message}`);
    }
    batch = [];
  }

  for (const file of files) {
    console.log(`  → ${path.basename(file)}`);
    let fileCount = 0;

    await streamLines(file, async (fields) => {
      if (fields.length < 6) return;
      if (LIMIT > 0 && total >= LIMIT) return false; // stop

      // Só pessoa física (identificador 2) — queremos nomes de gente, não PJ sócia.
      if (fields[SOC.IDENTIFICADOR_SOCIO]?.trim() !== "2") { skipped++; return; }

      const cnpjBasico = (fields[SOC.CNPJ_BASICO] ?? "").trim().padStart(8, "0");
      const nome       = (fields[SOC.NOME_SOCIO] ?? "").trim();
      if (!cnpjBasico || cnpjBasico.length !== 8 || !nome) { skipped++; return; }

      const qualif = (fields[SOC.QUALIFICACAO] ?? "").trim();

      batch.push({
        cnpj_basico:   cnpjBasico,
        nome_socio:    nome.slice(0, 200),
        cpf_mascarado: (fields[SOC.CNPJ_CPF_SOCIO] ?? "").trim() || null,
        qualificacao:  qualif || null,
        cargo:         QUALIF[qualif] ?? "Sócio",
        faixa_etaria:  (fields[SOC.FAIXA_ETARIA] ?? "").trim() || null,
        data_entrada:  toDate(fields[SOC.DATA_ENTRADA]),
      });

      total++; fileCount++;
      if (batch.length >= 5000) await flush();
      if (total % 50_000 === 0) process.stdout.write(`\r  ${total.toLocaleString()} sócios inseridos...`);
    });

    await flush();
    console.log(`\r  ✓ ${path.basename(file)}: ${fileCount.toLocaleString()} sócios PF`);
  }

  console.log(`\n  Total: ${total.toLocaleString()} sócios PF | Pulados (PJ/inválidos): ${skipped.toLocaleString()}`);

  const [row]: any[] = await sql`SELECT COUNT(*) AS n, COUNT(DISTINCT cnpj_basico) AS empresas FROM rf_socios`;
  console.log(`\n✅ rf_socios: ${parseInt(row?.n ?? "0").toLocaleString()} sócios de ${parseInt(row?.empresas ?? "0").toLocaleString()} empresas`);
  await sql.end();
}

main().catch((e) => { console.error("Erro fatal:", e.message); process.exit(1); });
