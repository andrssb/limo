// Coleta vagas ABERTAS de BDR/SDR no portal público da Gupy e escreve o CSV de
// entrada do scripts/sprint-vagas.ts.
//
// Por que existe: o gancho da cadência de agosto é "vocês abriram vaga de
// BDR/SDR" — fato público e datado. Buscar isso no Google não serve: o índice
// guarda a página da vaga muito depois de encerrar (numa amostra de 7 vagas
// achadas pelo Google em 29/07, 6 estavam com "Candidaturas encerradas"). Aqui a
// leitura é da MESMA tela que um humano vê, então só entra vaga que está no ar,
// com a data de publicação que a própria Gupy mostra.
//
// A busca do portal é client-side (o HTML vem com "0 resultado"), por isso
// Playwright e não fetch. Usa o Chrome instalado na máquina (channel: "chrome")
// porque o browser que o playwright 1.60 baixaria não está na versão local.
//
// Volume: uma passada é ~4 termos x ~3 páginas = ~12 telas, sequencial e com
// pausa entre elas. É leitura de página pública no mesmo ritmo de uma pessoa.
//
// Uso:
//   npx tsx scripts/vagas-gupy.ts [flags]
//
// Flags:
//   --dias=N       só vaga publicada nos últimos N dias (padrão 14)
//   --uf=MG,SP     só essas UFs (padrão: todas; MG sempre vem primeiro na saída)
//   --termos=a,b   termos de busca (padrão: BDR, SDR, pré-vendas, prospecção)
//   --saida=x.csv  padrão: vagas-gupy-<hoje>.csv
//   --paginas=N    teto de páginas por termo (padrão 10)
//   --headful      abre o navegador na tela, pra depurar
//
// A saída tem as 5 colunas que o sprint-vagas.ts lê (empresa, cidade, uf,
// vaga_url, data_vaga) e mais algumas de triagem, que ele ignora.

import { appendFileSync, existsSync } from "fs";
import { chromium, type Page } from "playwright";

// ─── Args ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (n: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const tem = (n: string): boolean => argv.includes(`--${n}`);

const DIAS = Number(flag("dias") ?? 14);
const UFS = (flag("uf") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const TERMOS = (flag("termos") ?? "BDR,SDR,pré-vendas,prospecção").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_PAGINAS = Number(flag("paginas") ?? 10);
const HEADFUL = tem("headful");

const hoje = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const SAIDA = flag("saida") ?? `vagas-gupy-${iso(hoje)}.csv`;

// ─── Triagem ──────────────────────────────────────────────────────────────────

// Quem vende inteligência comercial / sales engagement não compra o Limo: é
// concorrente. Deixar entrar na lista queima toque e credibilidade.
const CONCORRENTES = [
  "cortex", "leads2b", "ramper", "meetime", "reev", "exact sales", "exactspotter",
  "snov", "apollo", "lusha", "econodata", "speedio", "neoway", "serasa experian",
  "assertiva", "bigdata corp", "informa", "zoho", "hubspot", "salesforce", "rd station",
  "evolua prospect",
];

// Empresa de RH publica vaga do CLIENTE dela, não dela. O gancho "vocês abriram
// vaga de BDR" não se aplica: quem contrata é um terceiro que não sabemos quem é.
// Não descarta — marca, porque parte delas contrata pra si mesma.
const PADRAO_RH = /consultoria|recrutamento|recruiter|\brh\b|talent|people|selecao|seleção|gente e gest|staffing|outsourc/i;

// Banco de talentos não é vaga aberta — é cadastro de curriculo.
const PADRAO_NAO_VAGA = /banco de talentos|talent pool|cadastro reserva/i;

// Buscar pelo termo "SDR" pega SDR de qualquer negócio, e boa parte prospecta
// PESSOA FÍSICA: imobiliária captando imóvel, construtora vendendo apartamento,
// solar residencial, venda direta, call center. Pra essas o Limo não serve — a
// entrega é decisor B2B. Não descarta (o nome pode enganar): marca e joga pro fim
// da lista, pra eu decidir em 10 segundos em vez de descobrir no toque 1.
//
// É PALPITE, não veredito: regex em nome de empresa acerta o setor umas 7 em 10
// vezes. Erra pra menos quando o nome não diz o ramo ("Rôgga" é construtora,
// "Cidadania4u" é B2C). A coluna atencao existe pra ser lida, não pra ser confiada.
const FORA_DO_ICP: [RegExp, string][] = [
  [/constru(tora|ção)|incorporad|empreendiment|engenharia|imobili|predial|corretor|captador de im/i, "vende imóvel (B2C)"],
  [/energia solar|solar|fotovoltaic/i, "solar, costuma ser residencial (B2C)"],
  [/venda direta|revendedor|consultora de beleza|boticário|natura|avon/i, "venda direta (B2C)"],
  [/contact center|call center|telemarketing|atento|teleperformance/i, "contact center (volume, não decisor)"],
  [/faculdade|universidade|graduação|ensino|edtech|escola|colégio|vestibular|fmu|estácio/i, "educação, aluno é pessoa física"],
  [/turismo|viagem|hotel|restaurante|sorvet|gelato|pizza|food|padaria/i, "consumo final, verificar se é B2B"],
  [/infoproduto|high ticket|mentoria|curso online|coach/i, "infoproduto (B2C)"],
  [/banco|sicredi|cooperativa de crédito|consórcio|seguradora de vida/i, "varejo financeiro"],
];

// A Gupy mostra o nome da PÁGINA DE CARREIRA, que às vezes é slogan ("Bora fazer
// acontecer com a gente", "Novas oportunidades na Onfly!") e não o nome da
// empresa. Nesses casos o subdomínio do link é mais confiável.
const PADRAO_SLOGAN = /!|#|\bvem\b|\bbora\b|carreira|oportunidade|trabalhe|venha|faça parte|seja\b|somos\b/i;

// Vaga anônima: sem nome de empresa não há CNPJ pra resolver nem gancho pra citar.
const PADRAO_ANONIMA = /^(confidencial|empresa confidencial|sigilos[ao]|n[ãa]o divulgad[ao])$/i;

// ─── CSV ──────────────────────────────────────────────────────────────────────

const COLUNAS = [
  "empresa", "cidade", "uf", "vaga_url", "data_vaga",
  "cargo", "modelo", "contrato", "local_gupy", "termo", "empresa_slug", "atencao",
] as const;
type Linha = Record<(typeof COLUNAS)[number], string>;

const escapar = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// ─── Coleta ───────────────────────────────────────────────────────────────────

type Vaga = {
  empresa: string; cargo: string; localGupy: string; modelo: string;
  contrato: string; url: string; publicadaEm: string; termo: string;
};

// Roda DENTRO da página. Os nomes de classe da Gupy são hasheados (sc-aea9ebc9-5)
// e mudam a cada build, então ancora em data-testid e na tag: li > a[href gupy],
// primeiro <p> = empresa, <h3> = cargo, spans de listing-details = local, modelo
// e contrato, footer = "Publicada em: dd/mm/aaaa".
const extrair = (termo: string) =>
  [...document.querySelectorAll("li")]
    .map((li) => {
      const a = li.querySelector<HTMLAnchorElement>("a[href*='.gupy.io']");
      if (!a) return null;
      const txt = (el: Element | null | undefined) => el?.textContent?.trim() ?? "";
      const detalhes = [...li.querySelectorAll('[data-testid="listing-details"] span')]
        .map((s) => txt(s))
        .filter(Boolean);
      const local = txt(li.querySelector('[data-testid="job-location"]'));
      // local é o primeiro dos detalhes; modelo e contrato vêm depois dele
      const resto = detalhes.filter((d) => d !== local);
      const footer = txt(li.querySelector('[data-testid="listing-card-footer"]'));
      return {
        empresa: txt(li.querySelector("p")),
        cargo: txt(li.querySelector("h3")),
        localGupy: local,
        modelo: resto[0] ?? "",
        contrato: resto[1] ?? "",
        url: a.href,
        publicadaEm: footer.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? "",
        termo,
      };
    })
    .filter((v): v is Vaga => !!v && !!v.empresa && !!v.cargo);

// O tsx compila com esbuild keepNames, que injeta um helper `__name` nas funções
// que declaram nome. A função `extrair` é serializada e roda no navegador, onde
// esse helper não existe — sem este shim o evaluate morre com
// "ReferenceError: __name is not defined".
async function shimEsbuild(page: Page) {
  await page.addInitScript(() => {
    (globalThis as unknown as { __name: unknown }).__name = <T,>(fn: T) => fn;
  });
}

async function coletarTermo(page: Page, termo: string): Promise<Vaga[]> {
  const url = `https://portal.gupy.io/job-search/term=${encodeURIComponent(termo)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // A lista chega depois do JS. Se der timeout, ou é 0 resultado ou a Gupy mudou
  // a tela — nos dois casos seguir sem quebrar a rodada inteira.
  try {
    await page.waitForSelector('[data-testid="job-location"]', { timeout: 25_000 });
  } catch {
    const corpo = await page.locator("body").innerText().catch(() => "");
    console.log(`  "${termo}": nenhum resultado renderizado${/0 resultado/.test(corpo) ? " (0 resultado)" : ""}`);
    return [];
  }

  const out: Vaga[] = [];

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const daPagina = await page.evaluate(extrair, termo);
    out.push(...daPagina);
    process.stdout.write(`  "${termo}" pág ${pagina}: ${daPagina.length} vaga(s)\n`);

    const proxima = page.locator('button[aria-label="Próxima página"]');
    if ((await proxima.count()) === 0 || (await proxima.first().isDisabled())) break;
    await proxima.first().click();
    // Espera o conteúdo trocar de verdade — a paginação não navega, só re-renderiza.
    await page.waitForTimeout(2500);
  }

  console.log(`  "${termo}": ${out.length} coletada(s)`);
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Triada = Vaga & { empresa: string; slug: string; uf: string; data: Date; ressalvas: string[] };

// dd/mm/aaaa -> Date (o construtor do JS leria como mm/dd/aaaa)
function parseData(br: string): Date | null {
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

// https://teknisa.gupy.io/job/... -> "teknisa"
const slugDaUrl = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/\.gupy\.io$/, "").toLowerCase();
  } catch {
    return "";
  }
};

// O nome exibido é o da página de carreira. Quando ele é slogan ("Bora fazer
// acontecer com a gente"), o subdomínio é mais próximo do nome real da empresa —
// e é o nome que o resolveCompany vai procurar na base da Receita.
function nomeLimpo(exibido: string, slug: string): string {
  // "Saipos | Sistema para Restaurantes" -> "Saipos". O que vem depois do pipe é
  // descrição, e atrapalha duas vezes: polui a busca do CNPJ e faz a triagem de
  // setor casar no slogan ("Restaurantes") em vez de na empresa.
  const nome = (exibido.split("|")[0] ?? "").trim() || exibido.trim();
  if (!nome) return slug;
  if (!PADRAO_SLOGAN.test(nome) && nome.split(/\s+/).length <= 5) return nome;
  // "Novas oportunidades na Onfly!" -> se o slug aparece no meio da frase, ele é
  // a empresa; senão devolve o slug puro, que ao menos é um identificador.
  return slug || nome;
}

async function main() {
  if (existsSync(SAIDA)) {
    console.error(`${SAIDA} já existe. Apague ou passe --saida=outro.csv (não vou sobrescrever sua lista).`);
    process.exit(1);
  }

  console.log(
    `Gupy | termos: ${TERMOS.join(", ")} | últimos ${DIAS} dia(s)` +
    `${UFS.length ? ` | UF: ${UFS.join(",")}` : ""}\n`
  );

  const browser = await chromium.launch({ headless: !HEADFUL, channel: "chrome" });
  const page = await browser.newPage({ locale: "pt-BR" });
  await shimEsbuild(page);

  const todas: Vaga[] = [];
  try {
    for (const termo of TERMOS) {
      todas.push(...(await coletarTermo(page, termo)));
      await page.waitForTimeout(1500); // ritmo de leitura humana entre buscas
    }
  } finally {
    await browser.close();
  }

  // ─── Filtros ────────────────────────────────────────────────────────────────

  const limite = new Date(hoje);
  limite.setDate(limite.getDate() - DIAS);

  const descartes: Record<string, number> = {};
  const conta = (motivo: string) => { descartes[motivo] = (descartes[motivo] ?? 0) + 1; };

  // Uma empresa aparece em vários termos e com várias vagas. A regra do sprint é
  // UM toque por empresa, então fica a vaga mais recente de cada uma.
  const porEmpresa = new Map<string, Triada>();

  for (const v of todas) {
    const slug = slugDaUrl(v.url);
    const empresa = nomeLimpo(v.empresa, slug);
    const chave = (empresa || slug).toLowerCase().trim();
    const nomeECargo = `${empresa} ${v.cargo}`.toLowerCase();

    if (!chave) { conta("sem nome de empresa"); continue; }
    if (PADRAO_ANONIMA.test(empresa.trim())) { conta("vaga anônima"); continue; }
    if (CONCORRENTES.some((c) => chave.includes(c))) { conta("concorrente"); continue; }
    if (PADRAO_NAO_VAGA.test(nomeECargo)) { conta("banco de talentos"); continue; }

    const data = parseData(v.publicadaEm);
    if (!data) { conta("sem data"); continue; }
    if (data < limite) { conta(`mais de ${DIAS} dias`); continue; }

    const uf = v.localGupy.match(/-\s*([A-Z]{2})\s*$/)?.[1] ?? "";
    if (UFS.length && !UFS.includes(uf)) { conta("fora da UF"); continue; }

    // Casa setor no NOME DA EMPRESA, nunca no título da vaga. Setor no título
    // costuma significar o contrário: "SDR - Soluções em Construção Civil" é
    // software B2B que VENDE pra construtora (Viasoft, Saipos) — bom fit, não B2C.
    // Motivos acumulam: uma imobiliária que também é RH merece as duas ressalvas.
    const ressalvas = FORA_DO_ICP.filter(([re]) => re.test(empresa)).map(([, m]) => m);
    if (PADRAO_RH.test(empresa)) ressalvas.push("possível RH: a vaga pode ser de um cliente, confirmar antes de citar");

    const triada: Triada = { ...v, empresa, slug, uf, data, ressalvas };
    const anterior = porEmpresa.get(chave);
    if (!anterior || anterior.data < data) porEmpresa.set(chave, triada);
  }

  // Ordem de trabalho, não alfabética: MG primeiro (é onde o número 31 do Victor
  // gera rapport), depois quem passou limpo na triagem, depois vaga mais recente.
  const finais = [...porEmpresa.values()].sort((a, b) => {
    if ((a.uf === "MG") !== (b.uf === "MG")) return a.uf === "MG" ? -1 : 1;
    if ((a.ressalvas.length === 0) !== (b.ressalvas.length === 0)) return a.ressalvas.length === 0 ? -1 : 1;
    return b.data.getTime() - a.data.getTime();
  });

  // ─── Saída ──────────────────────────────────────────────────────────────────

  // BOM + ';' pro Excel em português abrir com dois cliques sem virar "ServiÃ§os".
  appendFileSync(SAIDA, "﻿" + COLUNAS.join(";") + "\n", "utf8");

  for (const v of finais) {
    // A Gupy trunca a cidade no próprio texto ("Belo Horiz... - MG") e não guarda
    // o valor cheio em atributo nenhum. Cidade pela metade faria o resolveCompany
    // casar o CNPJ errado, então só vai cidade quando vier íntegra.
    const cidadeBruta = v.localGupy.replace(/\s*-\s*[A-Z]{2}\s*$/, "").trim();
    const cidade = cidadeBruta.includes("...") ? "" : cidadeBruta;

    const linha: Linha = {
      empresa: v.empresa, cidade, uf: v.uf, vaga_url: v.url, data_vaga: v.publicadaEm,
      cargo: v.cargo, modelo: v.modelo, contrato: v.contrato,
      local_gupy: v.localGupy, termo: v.termo, empresa_slug: v.slug,
      atencao: v.ressalvas.join(" | "),
    };
    appendFileSync(SAIDA, COLUNAS.map((c) => escapar(linha[c])).join(";") + "\n", "utf8");
  }

  const mg = finais.filter((v) => v.uf === "MG").length;
  const limpas = finais.filter((v) => v.ressalvas.length === 0).length;

  console.log(
    `\n${todas.length} vaga(s) lida(s) -> ${finais.length} empresa(s) na lista\n` +
    `${limpas} sem ressalva | ${finais.length - limpas} com ressalva (vão no fim do CSV) | ${mg} em MG`
  );
  if (Object.keys(descartes).length) {
    console.log("descartes: " + Object.entries(descartes).map(([k, n]) => `${k} ${n}`).join(" | "));
  }
  console.log(`saída: ${SAIDA}`);
}

main().catch((e) => { console.error("ERRO:", e); process.exit(1); });
