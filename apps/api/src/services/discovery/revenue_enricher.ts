// ─── Revenue enricher ─────────────────────────────────────────────────────────
// Estimates annual revenue from porte, capital social and employee range.
// Never presents an estimate as a certain value — always marks type clearly.

export type RevenueType = "exact" | "estimated" | "inferred" | "licensed" | "unavailable";

export type RevenueRange =
  | "até R$ 360 mil"
  | "R$ 360 mil – R$ 4,8 milhões"
  | "R$ 4,8 milhões – R$ 10 milhões"
  | "R$ 10 milhões – R$ 50 milhões"
  | "R$ 50 milhões – R$ 100 milhões"
  | "R$ 100 milhões – R$ 500 milhões"
  | "acima de R$ 500 milhões";

export interface RevenueEnrichResult {
  revenue:        number | null;
  revenue_range:  RevenueRange | null;
  revenue_type:   RevenueType;
  revenue_confidence: number;    // 0-100
  source_type:    string;
}

// Porte → revenue range (Simples Nacional / BNDES classification)
const PORTE_TO_REVENUE: Record<string, RevenueRange> = {
  "MEI":    "até R$ 360 mil",
  "ME":     "R$ 360 mil – R$ 4,8 milhões",
  "EPP":    "R$ 4,8 milhões – R$ 10 milhões",
  "MEDIO":  "R$ 10 milhões – R$ 50 milhões",
  "GRANDE": "R$ 50 milhões – R$ 100 milhões",
};

// Employee range → revenue range (rough proxy, sector-agnostic)
const EMPLOYEES_TO_REVENUE: Record<string, RevenueRange> = {
  "1-10":    "até R$ 360 mil",
  "11-50":   "R$ 360 mil – R$ 4,8 milhões",
  "51-100":  "R$ 4,8 milhões – R$ 10 milhões",
  "101-200": "R$ 10 milhões – R$ 50 milhões",
  "201-500": "R$ 50 milhões – R$ 100 milhões",
  "501-1000":"R$ 100 milhões – R$ 500 milhões",
  "1000+":   "acima de R$ 500 milhões",
};

export function enrichRevenue(params: {
  companySize?:    string | null;
  capitalSocial?:  number | null;
  employeeRange?:  string | null;
}): RevenueEnrichResult {
  // Priority 1: porte from Receita Federal
  if (params.companySize) {
    const size  = params.companySize.toUpperCase().trim();
    const range = PORTE_TO_REVENUE[size];
    if (range) {
      return {
        revenue:             null,
        revenue_range:       range,
        revenue_type:        "estimated",
        revenue_confidence:  60,
        source_type:         "estimativa_por_porte_receita_federal",
      };
    }
  }

  // Priority 2: employee range
  if (params.employeeRange) {
    const range = EMPLOYEES_TO_REVENUE[params.employeeRange];
    if (range) {
      return {
        revenue:             null,
        revenue_range:       range,
        revenue_type:        "inferred",
        revenue_confidence:  40,
        source_type:         "inferencia_por_faixa_funcionarios",
      };
    }
  }

  // Priority 3: capital social as very low-confidence proxy
  if (params.capitalSocial && params.capitalSocial > 0) {
    const cap = params.capitalSocial;
    let range: RevenueRange = "até R$ 360 mil";
    if (cap >= 1_000_000)  range = "R$ 360 mil – R$ 4,8 milhões";
    if (cap >= 5_000_000)  range = "R$ 4,8 milhões – R$ 10 milhões";
    if (cap >= 20_000_000) range = "R$ 10 milhões – R$ 50 milhões";
    return {
      revenue:             null,
      revenue_range:       range,
      revenue_type:        "inferred",
      revenue_confidence:  25,
      source_type:         "inferencia_por_capital_social",
    };
  }

  return {
    revenue:             null,
    revenue_range:       null,
    revenue_type:        "unavailable",
    revenue_confidence:  0,
    source_type:         "nenhuma_fonte",
  };
}
