-- Respostas do mini-typeform de cadastro. Captura todo lead, inclusive os que
-- não viram conta na hora (fluxo de time sem Limo → agenda demo). Serve pra
-- comercial ter contexto antes da call. Não é dado de produção, é lead/CRM-lite.
CREATE TABLE IF NOT EXISTS signup_surveys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     varchar(200) NOT NULL,
  company       varchar(200),
  website       varchar(300),
  email         varchar(320) NOT NULL,
  phone         varchar(50),
  access_type   varchar(20)  NOT NULL,        -- 'individual' | 'team'
  -- individual:
  top_feature   varchar(100),                 -- funcionalidade mais buscada
  -- team:
  team_has_limo boolean,                       -- detectado por domínio do email
  people_count  integer,                       -- quantas pessoas usarão
  people_roles  text,                          -- cargos dessas pessoas (texto livre)
  buyer_role    varchar(200),                  -- cargo de quem quer contratar
  outcome       varchar(30),                   -- 'account' | 'ask_invite' | 'demo'
  created_at    timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signup_surveys_email_idx   ON signup_surveys (email);
CREATE INDEX IF NOT EXISTS signup_surveys_created_idx ON signup_surveys (created_at);
