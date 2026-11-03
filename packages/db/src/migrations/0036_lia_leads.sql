-- Persistência da Lia (assistente de SDR do Limo) no Postgres.
--
-- A Lia é um motor de cadência que roda LOCAL na minha máquina (e-mail +
-- WhatsApp precisam da sessão local), mas até aqui guardava o estado num
-- .xlsx. Estas tabelas levam esse estado pro banco do Limo pra que o painel
-- nativo (manager-only, dentro do app) leia do mesmo lugar. O motor continua
-- local; só a PERSISTÊNCIA muda.
--
-- IDs são bigserial (não uuid como o resto do schema) de propósito: o motor da
-- Lia em Python referencia o lead por inteiro sequencial (interface load_leads /
-- update_lead(id) / append_event(lead_id)). Manter inteiro evita reescrever o
-- motor inteiro. As tabelas são escopadas a um time (o meu manager) por
-- team_id, pro painel filtrar; nullable porque o motor pode rodar antes do
-- LIA_TEAM_ID estar setado.

CREATE TABLE IF NOT EXISTS lia_leads (
  id                  bigserial PRIMARY KEY,
  team_id             uuid REFERENCES teams(id) ON DELETE CASCADE,
  nome                text    NOT NULL DEFAULT '',
  empresa             text    NOT NULL DEFAULT '',
  num_funcionarios    integer,
  cargo               text    NOT NULL DEFAULT '',
  email               text    NOT NULL DEFAULT '',
  whatsapp            text    NOT NULL DEFAULT '',
  origem              text    NOT NULL DEFAULT '',   -- origem do lead (Lead frio / Trial / Cadastro frio / ...)
  link_crm            text    NOT NULL DEFAULT '',
  etapa               text    NOT NULL DEFAULT 'Novo',
  dia_cadencia        integer NOT NULL DEFAULT 0,
  proxima_acao        date,
  ultimo_toque        date,
  canal_ultimo_toque  text,
  respondeu           boolean NOT NULL DEFAULT false,
  objecao             text    NOT NULL DEFAULT '',
  closer              text    NOT NULL DEFAULT '',
  data_reuniao        date,
  observacoes         text    NOT NULL DEFAULT '',
  motivo_perdido      text    NOT NULL DEFAULT '',
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lia_events (
  id          bigserial PRIMARY KEY,
  lead_id     bigint REFERENCES lia_leads(id) ON DELETE CASCADE,
  team_id     uuid REFERENCES teams(id) ON DELETE CASCADE,
  occurred_at timestamp NOT NULL DEFAULT now(),   -- quando o toque aconteceu (Event.timestamp)
  tipo        text NOT NULL,                       -- email_enviado | whatsapp_enviado | resposta_recebida | ...
  canal       text,                                -- E-mail | WhatsApp | Ligação
  variante    text NOT NULL DEFAULT '',
  resultado   text NOT NULL DEFAULT '',
  objecao     text NOT NULL DEFAULT '',
  detalhe     text NOT NULL DEFAULT '',
  created_at  timestamp NOT NULL DEFAULT now()
);

-- Dedup por e-mail (o importador faz append-only por e-mail). Parcial: ignora
-- leads sem e-mail, que podem coexistir.
CREATE UNIQUE INDEX IF NOT EXISTS lia_leads_email_uniq ON lia_leads (lower(email)) WHERE email <> '';
CREATE INDEX IF NOT EXISTS lia_leads_team_idx  ON lia_leads (team_id);
CREATE INDEX IF NOT EXISTS lia_leads_etapa_idx ON lia_leads (etapa);
CREATE INDEX IF NOT EXISTS lia_events_lead_idx ON lia_events (lead_id);
CREATE INDEX IF NOT EXISTS lia_events_team_idx ON lia_events (team_id);
CREATE INDEX IF NOT EXISTS lia_events_when_idx ON lia_events (occurred_at);
