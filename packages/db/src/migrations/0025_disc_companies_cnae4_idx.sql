-- Performance: a descoberta de empresas filtra por left(main_cnae,4)=ANY(...)
-- (prefixo de 4 dígitos do CNAE) + state. A função left() no índice puro de
-- main_cnae IMPEDE o uso de índice → o planejador fazia Seq Scan na disc_companies
-- (~6,6GB / 14,5M linhas), deixando Descobrir/Garimpo lentíssimos.
--
-- Índice FUNCIONAL composto (left(main_cnae,4), state) torna o filtro indexável:
-- o plano vira Bitmap Index Scan (custo ~500k → ~68k no EXPLAIN; ganho real maior
-- por evitar ler a tabela inteira do disco).

CREATE INDEX IF NOT EXISTS disc_companies_cnae4_state_idx
  ON disc_companies (left(main_cnae, 4), state);
