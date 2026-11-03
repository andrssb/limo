-- ============================================================================
-- Funil da extensão a partir da telemetria anônima (tabela extension_events).
--
-- Responde a pergunta que os logs voláteis do Railway não respondiam:
--   instalou → abriu o painel → viu a tela de login → tentou logar → logou.
--
-- "Instalação ativa" = anon_id distinto (o id é gerado na 1a execução).
--
-- A partir da 0.3.5 o evento 'install' dispara no onInstalled, então instalar já
-- conta mesmo se a pessoa nunca abrir o painel — é o que separa "instalou e
-- sumiu" de número inflado da CWS. Em versões anteriores esse evento não existe:
-- ali 'instalaram' aparece zerado e o piso real é quem ABRIU algo.
--
-- Como rodar:
--   PGPASSWORD=... psql -h <host> -p <port> -U postgres -d railway \
--     -v days=30 -f scripts/extension-funnel.sql
-- ============================================================================

\if :{?days}
\else
  \set days 30
\endif

\echo '— Funil agregado (janela em dias acima) —'
WITH ev AS (
  SELECT * FROM extension_events
  WHERE created_at > now() - (:'days' || ' days')::interval
)
SELECT
  count(DISTINCT anon_id)                                              AS dispositivos_ativos,
  count(DISTINCT anon_id) FILTER (WHERE type = 'install')              AS instalaram,
  count(DISTINCT anon_id) FILTER (WHERE type = 'app_open')             AS abriram_painel,
  count(DISTINCT anon_id) FILTER (WHERE type = 'login_view')           AS viram_login,
  count(DISTINCT anon_id) FILTER (WHERE type = 'login_attempt')        AS tentaram_logar,
  count(DISTINCT anon_id) FILTER (WHERE type = 'login_attempt' AND ok) AS logaram_ok
FROM ev;

\echo '— Eventos brutos por tipo —'
SELECT type, count(*) AS eventos, count(DISTINCT anon_id) AS dispositivos
FROM extension_events
WHERE created_at > now() - (:'days' || ' days')::interval
GROUP BY type
ORDER BY type;

\echo '— Versões da extensão vistas —'
SELECT coalesce(ext_version, '(desconhecida)') AS versao,
       count(DISTINCT anon_id) AS dispositivos
FROM extension_events
WHERE created_at > now() - (:'days' || ' days')::interval
GROUP BY ext_version
ORDER BY dispositivos DESC;
