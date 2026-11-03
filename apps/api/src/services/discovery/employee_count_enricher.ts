// ─── Employee count enricher ──────────────────────────────────────────────────
// Estimates employee count from company size (porte) when no exact data available.
// Rules follow Brazilian SEBRAE / Receita Federal classification.

export type EmployeeCountType = "exact" | "estimated" | "inferred" | "licensed" | "unavailable";

export type EmployeeRange =
  | "1-10" | "11-50" | "51-100" | "101-200"
  | "201-500" | "501-1000" | "1000+";

export interface EmployeeEnrichResult {
  employee_count:       number | null;
  employee_count_range: EmployeeRange | null;
  employee_count_type:  EmployeeCountType;
  employee_confidence:  number;           // 0-100
  source_type:          string;
}

// Porte → employee range mapping (Receita Federal / SEBRAE criteria)
// MEDIO/GRANDE cover wide bands — we use capital social to refine within each band.
const PORTE_TO_RANGE: Record<string, EmployeeRange> = {
  "MEI":    "1-10",
  "ME":     "1-10",
  "EPP":    "11-50",
  "MEDIO":  "101-200",  // 51-200 band; capital social refines to "51-100" when < R$360k
  "GRANDE": "501-1000", // 200+ band; capital social refines further
};

// Capital social → rough employee range (very rough proxy, low confidence)
function capitalToRange(capital: number): EmployeeRange | null {
  if (capital <= 0)          return null;
  if (capital < 30_000)      return "1-10";
  if (capital < 360_000)     return "11-50";
  if (capital < 2_000_000)   return "51-100";
  if (capital < 10_000_000)  return "101-200";
  if (capital < 50_000_000)  return "201-500";
  if (capital < 200_000_000) return "501-1000";
  return "1000+";
}

export function enrichEmployeeCount(params: {
  companySize?:   string | null;
  capitalSocial?: number | null;
}): EmployeeEnrichResult {
  // Priority 1: porte from Receita Federal
  if (params.companySize) {
    const size  = params.companySize.toUpperCase().trim();
    const range = PORTE_TO_RANGE[size];
    if (range) {
      return {
        employee_count:       null,
        employee_count_range: range,
        employee_count_type:  "estimated",
        employee_confidence:  65,
        source_type:          "estimativa_por_porte_receita_federal",
      };
    }
  }

  // Priority 2: capital social (very rough)
  if (params.capitalSocial && params.capitalSocial > 0) {
    const range = capitalToRange(params.capitalSocial);
    if (range) {
      return {
        employee_count:       null,
        employee_count_range: range,
        employee_count_type:  "inferred",
        employee_confidence:  35,
        source_type:          "inferencia_por_capital_social",
      };
    }
  }

  return {
    employee_count:       null,
    employee_count_range: null,
    employee_count_type:  "unavailable",
    employee_confidence:  0,
    source_type:          "nenhuma_fonte",
  };
}
