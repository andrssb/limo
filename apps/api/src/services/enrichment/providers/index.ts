import type { EnrichmentProvider } from "./types.js";
import { assertiva } from "./assertiva.js";
import { bigDataCorp } from "./bigdatacorp.js";

export * from "./types.js";

// Provedores disponíveis atrás da camada plugável — o resto do sistema não muda
// ao trocar de fonte. A Assertiva é o provedor ativo; BigDataCorp fica de reserva.
const PROVIDERS: Record<string, EnrichmentProvider> = {
  assertiva,
  bdc: bigDataCorp,
};

// Provedor ativo, escolhido por env (default assertiva). Retorna null se nenhum
// estiver configurado (sem credenciais) — o endpoint responde "não configurado".
export function getEnrichmentProvider(): EnrichmentProvider | null {
  const preferred = process.env.ENRICHMENT_PROVIDER ?? "assertiva";
  const p = PROVIDERS[preferred];
  return p && p.isConfigured() ? p : null;
}
