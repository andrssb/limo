-- ============================================================================
-- Métricas de adoção — separa instalações de revisor/dev do USO REAL.
--
-- Contexto: o número de "downloads" da Chrome Web Store NÃO é atribuível
-- (a loja só dá o total agregado) e mistura dev + revisores do Google +
-- curiosos. Logo, a métrica honesta de tração vem do backend: contas e
-- atividade reais, excluindo as contas internas/de teste.
--
-- "Interno" = email na lista abaixo OU pertence a um time de plano 'tester'.
-- Edite INTERNAL_EMAILS conforme novas contas de teste forem criadas.
--
-- Como rodar:
--   PGPASSWORD=... psql -h <host> -p <port> -U postgres -d railway -f scripts/adoption-metrics.sql
-- ============================================================================

\set QUIET on
\pset footer off

WITH internal_emails(email) AS (
  VALUES
    ('dono@exemplo.com'),  -- dono / dev
    ('sdr.teste@exemplo.com'),  -- SDR de teste
    ('teste1@exemplo.com'), -- conta de teste
    ('teste2@exemplo.com')      -- conta de teste
),
flagged_users AS (
  SELECT
    u.id, u.email, u.name, u.team_id, u.created_at,
    (
      u.email IN (SELECT email FROM internal_emails)
      OR t.plan = 'tester'
    ) AS is_internal
  FROM users u
  LEFT JOIN teams t ON t.id = u.team_id
)

-- 1) CONTAS: interno vs real ------------------------------------------------
SELECT '1. CONTAS' AS secao,
       count(*)                                  AS total,
       count(*) FILTER (WHERE is_internal)       AS internas_dev_teste,
       count(*) FILTER (WHERE NOT is_internal)   AS reais
FROM flagged_users;

-- 2) TIMES por plano (tester = interno) -------------------------------------
SELECT '2. TIMES' AS secao, plan AS plano, count(*) AS qtd,
       CASE WHEN plan = 'tester' THEN 'interno' ELSE 'real' END AS tipo
FROM teams
GROUP BY plan
ORDER BY plan;

-- 3) USO REAL: atividade atribuída a contas NÃO internas --------------------
WITH internal_emails(email) AS (
  VALUES ('dono@exemplo.com'),('sdr.teste@exemplo.com'),
         ('teste1@exemplo.com'),('teste2@exemplo.com')
),
real_users AS (
  SELECT u.id FROM users u
  LEFT JOIN teams t ON t.id = u.team_id
  WHERE u.email NOT IN (SELECT email FROM internal_emails)
    AND coalesce(t.plan::text, '') <> 'tester'
)
SELECT '3. USO REAL' AS secao, metrica, qtd FROM (
  SELECT 'ligacoes'        AS metrica, count(*) AS qtd, 1 ord FROM calls        WHERE user_id IN (SELECT id FROM real_users)
  UNION ALL
  SELECT 'garimpos'        AS metrica, count(*),        2     FROM garimpo_runs WHERE user_id IN (SELECT id FROM real_users)
  UNION ALL
  SELECT 'contatos'        AS metrica, count(*),        3     FROM contacts     WHERE user_id IN (SELECT id FROM real_users)
  UNION ALL
  SELECT 'leads do typeform (signup_surveys)' AS metrica, count(*), 4 FROM signup_surveys
) s ORDER BY ord;
