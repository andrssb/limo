-- Pré-integração universal de VoIP: chave de API por time para o webhook de
-- ingestão de gravações (server-to-server, sem login do usuário). O provedor de
-- VoIP do cliente manda a gravação pro nosso webhook autenticado por essa chave.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS voip_api_key text;

-- Única quando preenchida (permite vários NULL).
CREATE UNIQUE INDEX IF NOT EXISTS teams_voip_api_key_uniq ON teams (voip_api_key) WHERE voip_api_key IS NOT NULL;
