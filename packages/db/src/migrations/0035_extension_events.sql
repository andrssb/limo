-- Telemetria mínima e ANÔNIMA do funil da extensão (instalou → abriu → viu
-- login → tentou logar). Sem PII: só um id anônimo gerado na instalação. Serve
-- pra medir o meio do funil, que hoje é cego (logs do Railway são voláteis e
-- não há tabela de eventos). É best-effort: o ping nunca bloqueia a UI.
CREATE TABLE IF NOT EXISTS extension_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        varchar(40) NOT NULL,   -- 'app_open' | 'login_view' | 'login_attempt'
  anon_id     varchar(64) NOT NULL,   -- id anônimo gerado na instalação (chrome.storage)
  ok          boolean,                -- só p/ login_attempt: sucesso do login?
  ext_version varchar(20),            -- versão da extensão que emitiu o evento
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS extension_events_type_idx    ON extension_events (type);
CREATE INDEX IF NOT EXISTS extension_events_created_idx ON extension_events (created_at);
CREATE INDEX IF NOT EXISTS extension_events_anon_idx    ON extension_events (anon_id);
