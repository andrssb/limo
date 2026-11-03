// Pipeline do sprint de agosto/2026: CSV de empresas com vaga aberta de BDR/SDR
// → CSV de decisor comercial com CELULAR, pronto pra abordagem no WhatsApp.
//
// Por que um script separado e não o Garimpo: o worker do Garimpo exige persona,
// lista, plano, quota de personas, Redis e BullMQ. Aqui o insumo é uma lista
// manual (vagas copiadas do LinkedIn/Gupy/Sólides) e o alvo é um CSV, não o
// painel. Reusa as MESMAS peças do Garimpo — resolveCompany, findOfficialSite,
// findDecisionMakers, findSocios, enrichPersonPaid — sem duplicar regra.
//
// Regra de ouro deste sprint: UM decisor por empresa. São ~120 toques possíveis
// em 10 dias úteis; dois contatos na mesma empresa é desperdício de crédito da
// Assertiva e de toque no WhatsApp.
//
// ⚠️ COMPLIANCE Assertiva (7.5/7.6/7.9): o dado pago sai daqui pro CSV
// operacional e pro cache (paid_enrichments). NUNCA alimentar enr_people.
//
// Uso:
//   npx tsx scripts/sprint-vagas.ts entrada.csv saida.csv --team=<uuid> [flags]
//
// Flags:
//   --team=<uuid>       time dono do enriquecimento (obrigatório fora do --dry)
//   --max-assertiva=N   teto DURO de consultas pagas nesta rodada (padrão 150)
//   --dry               roda tudo menos a Assertiva (custo zero, pra conferir lista)
//   --exigir-site       descarta empresa sem site (padrão: segue via QSA da RF)
//   --limite=N          processa só as N primeiras empresas
//
// Entrada (cabeçalho obrigatório, `;` ou `,`): empresa[,cidade,uf,vaga_url,data_vaga]
// O CSV de saída é escrito linha a linha e a rodada é RETOMÁVEL: rodar de novo
// com o mesmo arquivo de saída pula as empresas já processadas.

import { readFileSync, appendFileSync, existsSync } from "fs";
import { resolve } from "path";

// ─── Env ──────────────────────────────────────────────────────────────────────
// apps/api/src/config.ts valida o env INTEIRO (DATABASE_URL, REDIS_URL, JWT_*,
// GROQ_API_KEY, ENCRYPTION_KEY) na hora do import e mata o processo se faltar
// algo. Como aqui só queremos ler um CSV, carregamos .env.sprint ANTES e só
// então importamos os módulos do app — por isso os imports abaixo são dinâmicos
// (import estático é içado e rodaria antes desta linha).

function carregarEnv(caminho = resolve(process.cwd(), ".env.sprint")) {
  if (!existsSync(caminho)) return;
  for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const chave = m[1]!;
    // Aspas ao redor do valor são delimitador, não conteúdo — a DATABASE_URL do
    // Railway vem com caracteres que pedem aspas no arquivo.
    const valor = m[2]!.trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
    if (!(chave in process.env)) process.env[chave] = valor;
  }
}

// ─── Alvo ─────────────────────────────────────────────────────────────────────

// Quem decide compra de inteligência comercial numa empresa que ACABOU de abrir
// vaga de BDR/SDR. Ordem importa: o crawler usa como termo de busca na SERP.
// "Sócio" e "CEO" no fim de propósito — na PME o dono decide, mas quando existe
// um head comercial ele é o interlocutor certo.
const CARGOS_ALVO = [
  "Head de Vendas",
  "Gerente Comercial",
  "Diretor Comercial",
  "Head de Pré-vendas",
  "Coordenador de Pré-vendas",
  "Gerente de Vendas",
  "Sócio",
  "CEO",
];

const DOR =
  "Acabou de abrir vaga de BDR/SDR para outbound. O time novo vai perder as " +
  "primeiras semanas montando lista na mão e ligando para telefone fixo que " +
  "ninguém atende, em vez de falar com decisor.";

const PRODUTO =
  "Inteligência comercial para pré-vendas: lista de empresas do perfil certo " +
  "com decisor identificado, celular e e-mail verificados.";

// ─── Args ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (nome: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${nome}=`))?.split("=").slice(1).join("=");
const tem = (nome: string): boolean => argv.includes(`--${nome}`);

const posicionais  = argv.filter((a) => !a.startsWith("--"));
const ENTRADA      = posicionais[0];
const SAIDA        = posicionais[1];
const TEAM_ID      = flag("team") ?? process.env.SPRINT_TEAM_ID;
const MAX_ASSERTIVA = Number(flag("max-assertiva") ?? 150);
const LIMITE       = flag("limite") ? Number(flag("limite")) : Infinity;
const DRY          = tem("dry");
const EXIGIR_SITE  = tem("exigir-site");

if (!ENTRADA || !SAIDA) {
  console.error("Uso: npx tsx scripts/sprint-vagas.ts entrada.csv saida.csv --team=<uuid> [--dry]");
  process.exit(1);
}
if (!DRY && !TEAM_ID) {
  console.error("Falta --team=<uuid> (ou SPRINT_TEAM_ID). Use --dry pra rodar sem Assertiva.");
  process.exit(1);
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

const COLUNAS = [
  "empresa", "cnpj", "cidade", "uf", "dominio",
  "decisor", "cargo", "celular", "whatsapp", "email", "linkedin",
  "confianca", "fonte_telefone", "vaga_url", "data_vaga", "observacao",
] as const;
type Linha = Record<(typeof COLUNAS)[number], string>;

// Parser mínimo com suporte a aspas — o nome fantasia costuma ter vírgula
// ("Acme Tecnologia, Serviços e Ltda") e quebraria um split ingênuo.
function parseCsv(texto: string): Record<string, string>[] {
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length === 0) return [];

  const sep = (linhas[0]!.match(/;/g)?.length ?? 0) > (linhas[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";

  const campos = (linha: string): string[] => {
    const out: string[] = [];
    let atual = "", dentroDeAspas = false;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i]!;
      if (c === '"') {
        if (dentroDeAspas && linha[i + 1] === '"') { atual += '"'; i++; }
        else dentroDeAspas = !dentroDeAspas;
      } else if (c === sep && !dentroDeAspas) { out.push(atual); atual = ""; }
      else atual += c;
    }
    out.push(atual);
    return out.map((s) => s.trim());
  };

  const cabecalho = campos(linhas[0]!).map((h) => h.toLowerCase());
  return linhas.slice(1).map((l) => {
    const vals = campos(l);
    return Object.fromEntries(cabecalho.map((h, i) => [h, vals[i] ?? ""]));
  });
}

const escapar = (v: string): string =>
  /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

const escreverLinha = (l: Partial<Linha>) =>
  appendFileSync(SAIDA!, COLUNAS.map((c) => escapar(l[c] ?? "")).join(";") + "\n", "utf8");

// ─── Telefone ─────────────────────────────────────────────────────────────────

const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

// Celular brasileiro: DDD (2) + 9 + 8 dígitos = 11. Fixo tem 10 e não serve pro
// WhatsApp — é a diferença entre este pipeline e um extrator de Google Maps.
function ehCelular(numero: string): boolean {
  const d = digitos(numero).replace(/^55/, "");
  return d.length === 11 && d[2] === "9";
}

// Prefere o que o provedor marcou como móvel; na dúvida, confia no formato.
// Entre dois celulares, o de maior confiança declarada.
function escolherCelular(phones: { number: string; kind?: string; confidence?: number }[]): string | null {
  const celulares = phones.filter(
    (p) => /mobile|celul|movel|móvel/i.test(p.kind ?? "") || ehCelular(p.number)
  );
  if (celulares.length === 0) return null;
  celulares.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  return digitos(celulares[0]!.number);
}

const paraWhatsApp = (celular: string | null): string => {
  if (!celular) return "";
  const d = digitos(celular).replace(/^55/, "");
  return d.length === 11 ? `55${d}` : "";
};

// ─── Execução ─────────────────────────────────────────────────────────────────

let gastosAssertiva = 0;

async function main() {
  carregarEnv();

  if (!process.env.DATABASE_URL) {
    console.error(
      "Falta DATABASE_URL. Crie um .env.sprint na raiz do repo com as variáveis do @limo/api\n" +
      "(DATABASE_URL apontando pro proxy TCP do Railway, REDIS_URL, JWT_SECRET,\n" +
      "JWT_REFRESH_SECRET, GROQ_API_KEY, ENCRYPTION_KEY, SERPER_API_KEY,\n" +
      "ASSERTIVA_CLIENT_ID, ASSERTIVA_CLIENT_SECRET). Não commite esse arquivo."
    );
    process.exit(1);
  }

  const { getDb }             = await import("@limo/db");
  const { resolveCompany }    = await import("../apps/api/src/services/enrichment/engine/company_resolver.js");
  const { findOfficialSite }  = await import("../apps/api/src/services/discovery/site_finder.js");
  const { findSocios }        = await import("../apps/api/src/services/enrichment/engine/socios_finder.js");
  const { findDecisionMakers } = await import("../apps/api/src/services/crawler/index.js");
  const { enrichPersonPaid }  = await import("../apps/api/src/services/enrichment/paid_enrich.js");

  const entradas = parseCsv(readFileSync(ENTRADA!, "utf8"));
  if (entradas.length === 0) {
    console.error(`${ENTRADA}: vazio ou sem cabeçalho.`);
    process.exit(1);
  }
  if (!("empresa" in entradas[0]!)) {
    console.error(`${ENTRADA}: falta a coluna "empresa". Cabeçalho lido: ${Object.keys(entradas[0]!).join(", ")}`);
    process.exit(1);
  }

  // Retomada: o que já está na saída não roda de novo (nem gasta Assertiva).
  const jaFeitas = new Set<string>();
  if (existsSync(SAIDA!)) {
    for (const l of parseCsv(readFileSync(SAIDA!, "utf8"))) {
      if (l.empresa) jaFeitas.add(l.empresa.toLowerCase());
    }
    console.log(`Retomando: ${jaFeitas.size} empresa(s) já processada(s) em ${SAIDA}.`);
  } else {
    // BOM + separador `;`: sem isso o Excel em português abre o arquivo como
    // ANSI e mostra "Serviços" como "ServiÃ§os". A lista é pra ser trabalhada
    // na planilha, então o arquivo tem que abrir certo com dois cliques.
    appendFileSync(SAIDA!, "﻿" + COLUNAS.join(";") + "\n", "utf8");
  }

  const fila = entradas.filter((e) => e.empresa && !jaFeitas.has(e.empresa.toLowerCase())).slice(0, LIMITE);
  console.log(
    `${fila.length} empresa(s) na fila | Assertiva: ${DRY ? "DESLIGADA (--dry)" : `teto ${MAX_ASSERTIVA}`} | ` +
    `sem site: ${EXIGIR_SITE ? "descarta" : "segue via QSA"}\n`
  );

  const db = getDb();
  let comCelular = 0, i = 0;

  for (const entrada of fila) {
    i++;
    const nome   = entrada.empresa!.trim();
    const cidade = entrada.cidade?.trim() || undefined;
    const uf     = entrada.uf?.trim().toUpperCase() || undefined;
    const base: Partial<Linha> = {
      empresa: nome, cidade: cidade ?? "", uf: uf ?? "",
      vaga_url: entrada.vaga_url ?? "", data_vaga: entrada.data_vaga ?? "",
    };

    process.stdout.write(`[${i}/${fila.length}] ${nome} … `);

    try {
      // 1. Empresa → CNPJ (base RF local; cai na BrasilAPI quando não temos).
      const empresa = await resolveCompany({ name: nome, city: cidade, state: uf });
      const cnpj = empresa?.cnpj ?? null;
      base.cnpj = cnpj ?? "";

      // 2. Site oficial pelo nome — é de onde o crawler tira gente de verdade.
      const site = await findOfficialSite(nome, { city: cidade, state: uf, cnpj });
      const dominio = site?.domain ?? empresa?.domain ?? undefined;
      base.dominio = dominio ?? "";

      if (!dominio && EXIGIR_SITE) {
        console.log("sem site — descartada");
        escreverLinha({ ...base, observacao: "sem site (--exigir-site)" });
        continue;
      }

      // 3. Decisor comercial. Crawler primeiro; QSA da RF como rede de segurança
      // (na PME o sócio costuma ser mesmo quem decide).
      let decisor: {
        firstName: string; lastName: string; jobTitle: string;
        email?: string; phone?: string; linkedinUrl?: string; confianca: string;
      } | null = null;

      if (dominio) {
        const res = await findDecisionMakers(
          { name: nome, cnpj: cnpj ?? undefined, domain: dominio, companyId: empresa?.id, city: cidade, state: uf },
          { roleName: CARGOS_ALVO[0]!, roleNames: CARGOS_ALVO, painPoint: DOR, productDescription: PRODUTO,
            sector: empresa?.sector ?? undefined }
        );
        if (res.status === "found" && res.decisionMakers[0]) {
          const dm = res.decisionMakers[0];
          decisor = {
            firstName: dm.firstName, lastName: dm.lastName, jobTitle: dm.jobTitle,
            email: dm.email, phone: dm.phone, linkedinUrl: dm.linkedinUrl,
            confianca: dm.confidenceLevel,
          };
        }
      }

      if (!decisor && cnpj) {
        const socios = await findSocios(cnpj);
        if (socios[0]) {
          decisor = {
            firstName: socios[0].firstName, lastName: socios[0].lastName,
            jobTitle: socios[0].cargo, confianca: "baixa (QSA)",
          };
        }
      }

      if (!decisor) {
        console.log("sem decisor");
        escreverLinha({ ...base, observacao: "nenhum decisor encontrado" });
        continue;
      }

      base.decisor   = `${decisor.firstName} ${decisor.lastName}`.trim();
      base.cargo     = decisor.jobTitle;
      base.linkedin  = decisor.linkedinUrl ?? "";
      base.confianca = decisor.confianca;

      let celular: string | null = decisor.phone && ehCelular(decisor.phone) ? digitos(decisor.phone) : null;
      let email = decisor.email ?? "";
      base.fonte_telefone = celular ? "crawler" : "";

      // 4. Assertiva — só quando ainda falta celular. O crédito é pré-pago mas é
      // finito: teto duro local além do teto mensal do enrichPersonPaid.
      if (!DRY && !celular) {
        if (gastosAssertiva >= MAX_ASSERTIVA) {
          console.log("teto da Assertiva atingido");
          escreverLinha({ ...base, email, observacao: "teto local da Assertiva atingido" });
          continue;
        }
        gastosAssertiva++;
        const pago = await enrichPersonPaid(db, {
          teamId: TEAM_ID!,
          firstName: decisor.firstName, lastName: decisor.lastName,
          companyName: nome, cnpj, city: cidade, state: uf,
        }).catch(() => null);

        if (pago?.status === "cap_reached") {
          console.log("teto MENSAL do time atingido — parando");
          escreverLinha({ ...base, email, observacao: "teto mensal do time atingido" });
          break;
        }
        if (pago?.fromCache) gastosAssertiva--; // cache não cobra
        celular = escolherCelular(pago?.phones ?? []);
        email = email || (pago?.emails[0]?.address ?? "");
        if (celular) base.fonte_telefone = pago?.fromCache ? "externa (cache)" : "externa";
      }

      base.celular  = celular ?? "";
      base.whatsapp = paraWhatsApp(celular);
      base.email    = email;
      if (celular) comCelular++;

      escreverLinha({
        ...base,
        observacao: celular ? "" : "sem celular — não abordar por WhatsApp",
      });
      console.log(celular ? `OK ${base.decisor} (${base.cargo}) ${celular}` : `${base.decisor} — sem celular`);
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 120) ?? "erro";
      console.log(`ERRO: ${msg}`);
      escreverLinha({ ...base, observacao: `erro: ${msg}` });
    }
  }

  const taxa = fila.length ? Math.round((comCelular / fila.length) * 100) : 0;
  console.log(
    `\n${comCelular}/${fila.length} com celular (${taxa}%) | ` +
    `${gastosAssertiva} consulta(s) paga(s) | saída: ${SAIDA}`
  );
  process.exit(0);
}

main().catch((e) => { console.error("ERRO FATAL:", e); process.exit(1); });
