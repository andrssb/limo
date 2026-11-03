// Camada de enriquecimento pago plugável. A fonte (BigDataCorp, Assertiva, ...)
// fica escondida atrás desta interface — a API e o front nunca expõem o provedor.

export interface PersonQuery {
  firstName:    string;
  lastName:     string;
  companyName?: string;
  cnpj?:        string;
  city?:        string;
  state?:       string;
}

export interface EnrichedPhone {
  number:     string;
  confidence?: number;   // 0-100, quando o provedor dá um score
  kind?:      string;    // mobile / landline / commercial...
}

export interface EnrichedEmail {
  address:     string;
  confidence?: number;
}

export interface EnrichmentResult {
  matched:         boolean;
  matchConfidence?: number;          // o quão confiante foi o match nome→pessoa
  phones:          EnrichedPhone[];
  emails:          EnrichedEmail[];
  raw?:            unknown;          // payload bruto (guardado só internamente)
}

export interface EnrichmentProvider {
  /** Identificador interno (nunca exposto ao usuário final). */
  readonly id: string;
  /** True quando as credenciais estão configuradas no ambiente. */
  isConfigured(): boolean;
  /** Busca telefones/emails da pessoa. Não cobra se não houver match. */
  enrichPerson(q: PersonQuery): Promise<EnrichmentResult>;
}
