-- Renomeia a conta do dono para "André Sales" (pedido do user). Idempotente:
-- se o e-mail não bater, atualiza 0 linhas (sem erro).
UPDATE users SET name = 'André Sales' WHERE lower(email) = 'andressalessb@gmail.com';
