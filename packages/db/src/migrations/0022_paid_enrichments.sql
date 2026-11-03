-- Cache + auditoria de enriquecimentos pagos (camada "Enriquecer Contato").
-- Serve pra: (1) não pagar 2x pela mesma pessoa dentro do TTL; (2) contar uso por
-- time pra aplicar teto mensal. NÃO é base própria — é cache operacional com prazo.
CREATE TABLE IF NOT EXISTS paid_enrichments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL,
  contact_id  uuid,
  cache_key   varchar(200) NOT NULL,
  provider    varchar(50)  NOT NULL,
  matched     boolean      NOT NULL DEFAULT false,
  result      jsonb,
  created_at  timestamp    NOT NULL DEFAULT now(),
  expires_at  timestamp    NOT NULL
);
CREATE INDEX IF NOT EXISTS paid_enrich_cache_idx ON paid_enrichments (cache_key, expires_at);
CREATE INDEX IF NOT EXISTS paid_enrich_team_idx  ON paid_enrichments (team_id, created_at);
