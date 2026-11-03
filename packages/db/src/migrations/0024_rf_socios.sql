-- QSA da Receita Federal: sócios/administradores (pessoas físicas) por CNPJ.
-- Fonte RF de NOMES de decisores, igual disc_companies é a fonte de empresas.
-- Consumida sob demanda pelo Garimpo (join por cnpj_basico), NÃO despejada na
-- enr_people (que é cache operacional). Só pessoas físicas (identificador 2).

CREATE TABLE IF NOT EXISTS rf_socios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj_basico    varchar(8)   NOT NULL,          -- 8 primeiros dígitos do CNPJ (chave de join)
  nome_socio     varchar(200) NOT NULL,          -- nome completo do sócio (PF)
  cpf_mascarado  varchar(14),                    -- CPF mascarado ***XXXXXX** (RF não dá completo)
  qualificacao   varchar(5),                     -- código de qualificação RF (ex: 49 = sócio-administrador)
  cargo          varchar(60),                    -- rótulo legível derivado da qualificação
  faixa_etaria   varchar(2),                     -- código de faixa etária RF (opcional)
  data_entrada   date,                           -- data de entrada na sociedade
  created_at     timestamp NOT NULL DEFAULT now()
);

-- Lookup principal do Garimpo: sócios de um CNPJ.
CREATE INDEX IF NOT EXISTS rf_socios_cnpj_basico_idx ON rf_socios (cnpj_basico);
