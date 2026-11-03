-- Coluna pra rastrear quando o motor passivo "passou" em cada empresa.
-- Usada pra medir cobertura por estado (passadas / total) e priorizar não-passadas.
ALTER TABLE enr_companies ADD COLUMN IF NOT EXISTS last_engine_pass timestamp;
CREATE INDEX IF NOT EXISTS enr_companies_state_pass_idx ON enr_companies (state, last_engine_pass);
