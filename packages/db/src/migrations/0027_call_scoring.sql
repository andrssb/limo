-- Fase 3 do Coaching IA: score detalhado por interação, detecção de frameworks
-- (SPIN/BANT/GPCT/MEDDIC/...) e análise de conversão/perda na análise pós-call.
--
-- score      = { overall, opening, painDiscovery, solutionClarity, frameworkUsage, advanceToDemo, rationale }
-- frameworks = [ { name, detected, completeness, stepsCovered[], stepsMissed[], note } ]
-- outcome    = { converted, conversionFactors[], lossReasons[], objections[], improvements[] }
-- Nullable: análises geradas antes da Fase 3 não os têm.

ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS score      jsonb;
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS frameworks jsonb;
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS outcome    jsonb;
