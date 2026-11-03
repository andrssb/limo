-- Coloca a conta do dono (André) no plano "tester" (ilimitado). Idempotente:
-- se o e-mail/time não bater, atualiza 0 linhas (sem erro). Roda depois da 0030.
UPDATE teams
SET    plan = 'tester'
WHERE  manager_id IN (SELECT id FROM users WHERE lower(email) = 'andressalessb@gmail.com');
