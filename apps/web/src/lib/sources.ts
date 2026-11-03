// Rótulos de origem voltados ao CLIENTE. Nunca expõe o provedor real dos dados
// (Receita Federal, Assertiva, QSA, MX pattern, etc.). Tudo que vem de base
// externa/enriquecimento aparece genericamente como "Base de dados Limo".
// LinkedIn e site da empresa não são "fontes secretas" — podem aparecer.
const FRIENDLY_SOURCE: Record<string, string> = {
  manual: "Manual",
  import: "Importação",
  crm: "CRM",
  linkedin: "LinkedIn",
  linkedin_extension: "LinkedIn",
  extension: "LinkedIn",
  company_site: "Site da empresa",
};

export const LIMO_DB = "Base de dados Limo";

export function friendlySource(source?: string | null): string {
  if (!source) return LIMO_DB;
  return FRIENDLY_SOURCE[source] ?? LIMO_DB;
}

// Para listas de proveniência: traduz cada item e remove duplicatas
// (evita repetir "Base de dados Limo" várias vezes).
export function friendlySources(sources: string[]): string[] {
  return [...new Set(sources.map(friendlySource))];
}
