-- Plano interno "tester" — tudo liberado, sem limites. Só para a conta do dono
-- (manager). Adiciona o valor ao enum team_plan. Em migration separada da que o
-- usa (0031), pois o Postgres só permite usar o novo valor após o ADD VALUE commitar.
ALTER TYPE team_plan ADD VALUE IF NOT EXISTS 'tester';
