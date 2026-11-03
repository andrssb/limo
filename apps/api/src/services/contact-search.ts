import { contacts } from "@limo/db";
import { ilike, or, sql, type SQL } from "drizzle-orm";

// Filtros de busca de contatos usados pela listagem do CRM e pela janela
// "Adicionar leads" do SDR de voz. Ficam isolados aqui para serem testáveis
// sem subir rota, banco ou fila.

/** Remove espaços nas pontas e colapsa espaços internos ("  Andre   Sales " -> "Andre Sales"). */
export function normalizeContactSearchTerm(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Busca por nome, sobrenome, nome completo, e-mail ou empresa.
 * O nome completo entra via concat_ws porque "Andre Teste Voz" nunca casa
 * com firstName nem com lastName isoladamente.
 */
export function buildContactSearchFilter(raw: string): SQL | null {
  const term = normalizeContactSearchTerm(raw);
  if (!term) return null;
  const pattern = `%${term}%`;
  return or(
    ilike(contacts.firstName, pattern),
    ilike(contacts.lastName, pattern),
    sql`concat_ws(' ', ${contacts.firstName}, ${contacts.lastName}) ilike ${pattern}`,
    ilike(contacts.email, pattern),
    ilike(contacts.companyName, pattern)
  )!;
}

/**
 * Só contatos discáveis. Precisa ser filtro de banco: filtrar no navegador
 * depois de paginar esconde quem tem telefone atrás de quem não tem.
 */
export function buildContactHasPhoneFilter(): SQL {
  return sql`${contacts.phone} is not null and length(btrim(${contacts.phone})) > 0`;
}
