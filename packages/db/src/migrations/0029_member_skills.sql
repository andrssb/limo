-- Fase 5 do Coaching IA: desenvolvimento individual.
-- O gestor/Head define quais hard skills e soft skills cada profissional precisa
-- desenvolver; a IA acompanha a evolução (scores de ligação da Fase 3) com esse foco.
-- Uma linha por membro (user_id único) — upsert.

CREATE TABLE IF NOT EXISTS member_skills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hard_skills jsonb NOT NULL DEFAULT '[]',
  soft_skills jsonb NOT NULL DEFAULT '[]',
  note        text,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamp NOT NULL DEFAULT now(),
  CONSTRAINT member_skills_user_uniq UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS member_skills_team_idx ON member_skills (team_id);
