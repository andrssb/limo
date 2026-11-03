-- Motor passivo passa a varrer a base completa da Receita (disc_companies, 14,5M),
-- não mais a enr_companies (curada, ~750). Rastreia varredura por empresa.
-- (O índice (state, last_engine_pass) é criado CONCURRENTLY fora da migration.)
ALTER TABLE disc_companies ADD COLUMN IF NOT EXISTS last_engine_pass timestamp;
