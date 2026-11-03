-- Fase 0 do Coaching IA: camada de ingestão agnóstica ao canal.
-- Uma única entrada (calls) recebe áudio de qualquer fonte — navegador (tabCapture),
-- VoIP (gravação via webhook), upload — normalizada pelos campos abaixo.
--
-- channel        = de onde veio o áudio (define o tratamento na ingestão/diarização)
-- sdr_audio_url  = trilha SOMENTE do SDR (microfone). Quando presente junto da lead,
-- lead_audio_url = trilha SOMENTE do lead (aba/remoto), permite DIARIZAÇÃO REAL
--                  (transcreve cada trilha separada e rotula o falante de verdade).
-- source_meta    = metadados da pré-integração universal de VoIP (provedor, id externo
--                  da chamada, payload bruto do webhook) — preenchido pelo adaptador
--                  específico do cliente quando ele fechar.

ALTER TABLE calls ADD COLUMN IF NOT EXISTS channel        text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS sdr_audio_url  text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS lead_audio_url text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS source_meta    jsonb;

-- Reunião de qualificação (ex.: Meet) pode não ter contato do CRM vinculado.
-- Tornamos contact_id opcional pra permitir persistir a call mesmo sem contato.
ALTER TABLE calls ALTER COLUMN contact_id DROP NOT NULL;
