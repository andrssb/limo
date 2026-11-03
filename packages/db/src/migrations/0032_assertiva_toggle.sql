-- Liga/desliga do enriquecimento pago (Assertiva) por time. Em demo, liga-se pra
-- trazer o telefone/e-mail real da pessoa; em teste, desliga-se pra não gastar.
-- Default: ligado (clientes pagos usam). O time interno "tester" nasce DESLIGADO.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS assertiva_enabled boolean NOT NULL DEFAULT true;

UPDATE teams SET assertiva_enabled = false WHERE plan = 'tester';
