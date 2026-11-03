-- ─── Company Discovery Engine ────────────────────────────────────────────────

-- Core company table — populated from Receita Federal open data
CREATE TABLE disc_companies (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj                VARCHAR(18) UNIQUE,                        -- formatted: XX.XXX.XXX/0001-XX
  legal_name          VARCHAR(400) NOT NULL,
  trade_name          VARCHAR(400),
  state               CHAR(2),
  city                VARCHAR(200),
  main_cnae           VARCHAR(10),
  secondary_cnaes     TEXT[]      NOT NULL DEFAULT '{}',
  registration_status VARCHAR(50) NOT NULL DEFAULT 'ATIVA',      -- ATIVA | BAIXADA | INAPTA
  company_size        VARCHAR(20),                               -- MEI | ME | EPP | MEDIO | GRANDE
  capital_social      NUMERIC(18,2),
  created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX disc_companies_cnpj_idx        ON disc_companies (cnpj);
CREATE INDEX disc_companies_state_idx       ON disc_companies (state);
CREATE INDEX disc_companies_city_idx        ON disc_companies (city);
CREATE INDEX disc_companies_main_cnae_idx   ON disc_companies (main_cnae);
CREATE INDEX disc_companies_cnaes_gin_idx   ON disc_companies USING GIN (secondary_cnaes);
CREATE INDEX disc_companies_status_idx      ON disc_companies (registration_status);
CREATE INDEX disc_companies_name_idx        ON disc_companies (lower(legal_name));

-- Domain per company with confidence scoring
CREATE TABLE disc_company_domains (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES disc_companies(id) ON DELETE CASCADE,
  domain          VARCHAR(300) NOT NULL,
  website_url     VARCHAR(500),
  source_type     VARCHAR(100) NOT NULL,   -- 'google_places' | 'cnpj_email' | 'web_search' | 'name_guess' | 'licensed'
  source_url      VARCHAR(500),
  confidence      INTEGER     NOT NULL DEFAULT 0,  -- 0-100
  last_verified_at TIMESTAMP,
  created_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
  CONSTRAINT disc_domains_uniq UNIQUE (company_id, domain)
);

CREATE INDEX disc_domains_company_idx ON disc_company_domains (company_id);
CREATE INDEX disc_domains_conf_idx    ON disc_company_domains (confidence DESC);

-- Firmographics: employees + revenue with type tracking
CREATE TABLE disc_company_firmographics (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID    NOT NULL REFERENCES disc_companies(id) ON DELETE CASCADE,

  employee_count        INTEGER,                    -- exact number or NULL
  employee_count_range  VARCHAR(20),                -- '1-10' | '11-50' | '51-100' | '101-200' | '201-500' | '501-1000' | '1000+'
  employee_count_type   VARCHAR(20) NOT NULL DEFAULT 'estimated',  -- 'exact' | 'estimated' | 'inferred' | 'licensed' | 'unavailable'
  employee_confidence   INTEGER NOT NULL DEFAULT 0,

  revenue               NUMERIC(18,2),              -- exact annual revenue or NULL
  revenue_range         VARCHAR(60),                -- 'até R$ 360mil' | 'R$ 360mil - R$ 4,8M' | ...
  revenue_type          VARCHAR(20) NOT NULL DEFAULT 'estimated',   -- 'exact' | 'estimated' | 'inferred' | 'licensed' | 'unavailable'
  revenue_confidence    INTEGER NOT NULL DEFAULT 0,

  source_type           VARCHAR(100),
  source_url            VARCHAR(500),
  last_verified_at      TIMESTAMP   NOT NULL DEFAULT NOW(),

  CONSTRAINT disc_firmographics_company_uniq UNIQUE (company_id)
);

CREATE INDEX disc_firmographics_company_idx ON disc_company_firmographics (company_id);

-- Per-field source audit trail
CREATE TABLE disc_company_sources (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES disc_companies(id) ON DELETE CASCADE,
  field_name      VARCHAR(100) NOT NULL,   -- 'cnpj' | 'city' | 'state' | 'website' | 'employee_count' | 'revenue'
  value           TEXT        NOT NULL,
  source_type     VARCHAR(100) NOT NULL,   -- 'receita_federal' | 'google_places' | 'estimated' | 'licensed' | 'inferred'
  source_url      VARCHAR(500),
  confidence      INTEGER     NOT NULL DEFAULT 0,
  collected_at    TIMESTAMP   NOT NULL DEFAULT NOW(),
  last_verified_at TIMESTAMP
);

CREATE INDEX disc_sources_company_idx ON disc_company_sources (company_id);
CREATE INDEX disc_sources_field_idx   ON disc_company_sources (field_name);

-- Sector → CNAE mapping table (queryable, updatable without code deploy)
CREATE TABLE disc_sector_cnae_map (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_name      VARCHAR(200) NOT NULL,
  sector_slug      VARCHAR(200) NOT NULL,           -- normalised for matching
  cnae_code        VARCHAR(10)  NOT NULL,
  cnae_description VARCHAR(400) NOT NULL DEFAULT '',
  is_primary       BOOLEAN     NOT NULL DEFAULT FALSE,
  weight           INTEGER     NOT NULL DEFAULT 1,  -- higher = more relevant
  active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP   NOT NULL DEFAULT NOW(),
  CONSTRAINT sector_cnae_uniq UNIQUE (sector_slug, cnae_code)
);

CREATE INDEX disc_sector_cnae_slug_idx ON disc_sector_cnae_map (sector_slug);
CREATE INDEX disc_sector_cnae_code_idx ON disc_sector_cnae_map (cnae_code);

-- Discovery jobs — track async searches
CREATE TABLE disc_discovery_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sector          VARCHAR(200) NOT NULL,
  state           CHAR(2),
  city            VARCHAR(200),
  employee_range  VARCHAR(20),
  limit_requested INTEGER     NOT NULL DEFAULT 100,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',   -- 'pending' | 'running' | 'done' | 'failed'
  total_found     INTEGER     NOT NULL DEFAULT 0,
  total_returned  INTEGER     NOT NULL DEFAULT 0,
  error_message   TEXT,
  created_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMP
);

CREATE INDEX disc_jobs_status_idx ON disc_discovery_jobs (status);
CREATE INDEX disc_jobs_created_idx ON disc_discovery_jobs (created_at DESC);

-- Enrichment jobs — per-company async enrichment tasks
CREATE TABLE disc_enrichment_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES disc_companies(id) ON DELETE CASCADE,
  enrichment_type VARCHAR(50) NOT NULL,   -- 'domain' | 'employees' | 'revenue' | 'full'
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts        INTEGER     NOT NULL DEFAULT 0,
  error_message   TEXT,
  created_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMP
);

CREATE INDEX disc_enrichment_company_idx ON disc_enrichment_jobs (company_id);
CREATE INDEX disc_enrichment_status_idx  ON disc_enrichment_jobs (status);

-- ─── Seed sector_cnae_map ─────────────────────────────────────────────────────

INSERT INTO disc_sector_cnae_map (sector_name, sector_slug, cnae_code, cnae_description, is_primary, weight) VALUES
-- Tecnologia
('Tecnologia', 'tecnologia', '6201', 'Desenvolvimento de programas de computador sob encomenda', true, 10),
('Tecnologia', 'tecnologia', '6202', 'Desenvolvimento e licenciamento de programas de computador customizáveis', false, 9),
('Tecnologia', 'tecnologia', '6203', 'Desenvolvimento e licenciamento de programas de computador não-customizáveis', false, 9),
('Tecnologia', 'tecnologia', '6204', 'Consultoria em tecnologia da informação', false, 8),
('Tecnologia', 'tecnologia', '6209', 'Suporte técnico, manutenção e outros serviços em tecnologia da informação', false, 7),
('Tecnologia', 'tecnologia', '6311', 'Tratamento de dados, provedores de serviços de aplicação e serviços de hospedagem', false, 8),
('Tecnologia', 'tecnologia', '6319', 'Portais, provedores de conteúdo e outros serviços de informação na internet', false, 7),
('Tecnologia', 'tecnologia', '6399', 'Outras atividades de prestação de serviços de informação não especificadas', false, 5),
-- Saúde
('Saúde', 'saude', '8610', 'Atividades de atendimento hospitalar', true, 10),
('Saúde', 'saude', '8621', 'Serviços móveis de atendimento a urgências e emergências', false, 8),
('Saúde', 'saude', '8622', 'Serviços de remoção de pacientes', false, 7),
('Saúde', 'saude', '8630', 'Atividades de atenção ambulatorial executadas por médicos e odontólogos', false, 9),
('Saúde', 'saude', '8640', 'Atividades de serviços de complementação diagnóstica e terapêutica', false, 8),
('Saúde', 'saude', '8650', 'Atividades de profissionais da área de saúde', false, 7),
('Saúde', 'saude', '8660', 'Atividades de apoio à gestão de saúde', false, 6),
('Saúde', 'saude', '4644', 'Comércio atacadista de medicamentos e drogas de uso humano', false, 7),
-- Logística e Transporte
('Logística', 'logistica', '4930', 'Transporte rodoviário de carga', true, 10),
('Logística', 'logistica', '4921', 'Transporte rodoviário coletivo de passageiros', false, 6),
('Logística', 'logistica', '4922', 'Transporte rodoviário coletivo de passageiros com itinerário fixo, municipal', false, 5),
('Logística', 'logistica', '4923', 'Transporte rodoviário de escolares', false, 4),
('Logística', 'logistica', '4929', 'Transporte rodoviário coletivo de passageiros, não especificado', false, 5),
('Logística', 'logistica', '5012', 'Transporte marítimo de cabotagem', false, 6),
('Logística', 'logistica', '5091', 'Transporte por navegação de travessia', false, 4),
('Logística', 'logistica', '5211', 'Armazéns gerais - emissão de warrant', false, 8),
('Logística', 'logistica', '5212', 'Guarda-móveis e armazéns, sem emissão de warrant', false, 7),
('Logística', 'logistica', '5229', 'Atividades auxiliares dos transportes terrestres', false, 8),
-- Financeiro
('Financeiro', 'financeiro', '6411', 'Banco Central', true, 5),
('Financeiro', 'financeiro', '6422', 'Bancos múltiplos, com carteira comercial', false, 10),
('Financeiro', 'financeiro', '6431', 'Bancos múltiplos, sem carteira comercial', false, 9),
('Financeiro', 'financeiro', '6432', 'Bancos de investimento', false, 8),
('Financeiro', 'financeiro', '6450', 'Sociedades de capitalização', false, 7),
('Financeiro', 'financeiro', '6461', 'Holdings de instituições financeiras', false, 8),
('Financeiro', 'financeiro', '6499', 'Atividades de serviços financeiros não especificadas', false, 7),
-- Construção
('Construção', 'construcao', '4110', 'Incorporação de empreendimentos imobiliários', true, 10),
('Construção', 'construcao', '4120', 'Construção de edifícios', false, 10),
('Construção', 'construcao', '4211', 'Construção de rodovias e ferrovias', false, 9),
('Construção', 'construcao', '4212', 'Construção de obras de arte especiais', false, 8),
('Construção', 'construcao', '4221', 'Obras para geração e distribuição de energia elétrica', false, 8),
('Construção', 'construcao', '4291', 'Obras portuárias, marítimas e fluviais', false, 7),
('Construção', 'construcao', '4299', 'Obras de engenharia civil não especificadas', false, 8),
('Construção', 'construcao', '4311', 'Demolição e preparação de canteiros de obras', false, 6),
('Construção', 'construcao', '4321', 'Instalação e manutenção elétrica', false, 7),
-- Varejo
('Varejo', 'varejo', '4711', 'Comércio varejista de mercadorias em geral - hipermercados e supermercados', true, 10),
('Varejo', 'varejo', '4712', 'Comércio varejista de mercadorias em geral - lojas de departamentos ou magazines', false, 9),
('Varejo', 'varejo', '4721', 'Comércio varejista de produtos de padaria', false, 6),
('Varejo', 'varejo', '4722', 'Comércio varejista de carnes e pescados', false, 6),
('Varejo', 'varejo', '4723', 'Comércio varejista de bebidas', false, 6),
('Varejo', 'varejo', '4729', 'Comércio varejista de produtos alimentícios em geral', false, 8),
('Varejo', 'varejo', '4741', 'Comércio varejista de tintas', false, 5),
('Varejo', 'varejo', '4754', 'Comércio varejista de artigos de iluminação', false, 5),
-- Educação
('Educação', 'educacao', '8511', 'Educação infantil - creche', true, 8),
('Educação', 'educacao', '8512', 'Educação infantil - pré-escola', false, 8),
('Educação', 'educacao', '8520', 'Ensino fundamental', false, 9),
('Educação', 'educacao', '8531', 'Educação média - curso regular', false, 9),
('Educação', 'educacao', '8541', 'Educação profissional de nível técnico', false, 8),
('Educação', 'educacao', '8542', 'Educação profissional de nível tecnológico', false, 8),
('Educação', 'educacao', '8550', 'Atividades de apoio à educação', false, 7),
('Educação', 'educacao', '8599', 'Outras atividades de ensino não especificadas', false, 7),
-- Marketing / Publicidade
('Marketing', 'marketing', '7311', 'Agências de publicidade', true, 10),
('Marketing', 'marketing', '7312', 'Agenciamento de espaços para publicidade', false, 8),
('Marketing', 'marketing', '7319', 'Atividades de publicidade não especificadas', false, 9),
('Marketing', 'marketing', '7320', 'Pesquisas de mercado e de opinião pública', false, 8),
('Marketing', 'marketing', '6391', 'Agências de notícias', false, 5),
-- RH / Recursos Humanos
('RH', 'rh', '7810', 'Seleção e agenciamento de mão de obra', true, 10),
('RH', 'rh', '7820', 'Locação de mão de obra temporária', false, 9),
('RH', 'rh', '7830', 'Fornecimento e gestão de recursos humanos para terceiros', false, 9),
-- Agronegócio
('Agronegócio', 'agronegocio', '0111', 'Cultivo de cereais', true, 9),
('Agronegócio', 'agronegocio', '0112', 'Cultivo de algodão herbáceo e de outras fibras de lavoura temporária', false, 7),
('Agronegócio', 'agronegocio', '0113', 'Cultivo de cana-de-açúcar', false, 8),
('Agronegócio', 'agronegocio', '0119', 'Cultivo de outras plantas de lavoura temporária', false, 7),
('Agronegócio', 'agronegocio', '0151', 'Criação de bovinos para corte', false, 9),
('Agronegócio', 'agronegocio', '0152', 'Criação de bovinos para leite', false, 8),
('Agronegócio', 'agronegocio', '0311', 'Pesca de peixes em água salgada', false, 7),
-- Imobiliário
('Imobiliário', 'imobiliario', '6810', 'Atividades imobiliárias de imóveis próprios', true, 10),
('Imobiliário', 'imobiliario', '6821', 'Corretagem na compra e venda e avaliação de imóveis', false, 9),
('Imobiliário', 'imobiliario', '6822', 'Gestão e administração da propriedade imobiliária', false, 9),
-- Indústria
('Indústria', 'industria', '2811', 'Fabricação de motores e turbinas', true, 8),
('Indústria', 'industria', '2812', 'Fabricação de equipamentos hidráulicos e pneumáticos', false, 8),
('Indústria', 'industria', '2891', 'Fabricação de equipamentos para irrigação agrícola', false, 7),
('Indústria', 'industria', '3011', 'Construção de embarcações e estruturas flutuantes', false, 7),
('Indústria', 'industria', '2211', 'Fabricação de pneumáticos e câmaras de ar', false, 8),
-- Alimentação
('Alimentação', 'alimentacao', '5611', 'Restaurantes e outros estabelecimentos de serviços de alimentação', true, 10),
('Alimentação', 'alimentacao', '5612', 'Serviços ambulantes de alimentação', false, 7),
('Alimentação', 'alimentacao', '5620', 'Serviços de catering e de fornecimento de alimentos preparados', false, 8),
('Alimentação', 'alimentacao', '1011', 'Abate de reses, exceto suínos', false, 7),
('Alimentação', 'alimentacao', '1031', 'Fabricação de conservas de frutas', false, 6),
-- Consultoria
('Consultoria', 'consultoria', '7020', 'Atividades de consultoria em gestão empresarial', true, 10),
('Consultoria', 'consultoria', '7111', 'Serviços de arquitetura', false, 7),
('Consultoria', 'consultoria', '7112', 'Serviços de engenharia', false, 8),
('Consultoria', 'consultoria', '7119', 'Atividades técnicas relacionadas à engenharia', false, 7),
('Consultoria', 'consultoria', '6911', 'Atividades jurídicas', false, 8),
-- Seguros
('Seguros', 'seguros', '6511', 'Seguros de vida', true, 10),
('Seguros', 'seguros', '6512', 'Seguros não-vida', false, 9),
('Seguros', 'seguros', '6520', 'Seguros-saúde', false, 9),
('Seguros', 'seguros', '6530', 'Resseguros', false, 8),
('Seguros', 'seguros', '6541', 'Previdência complementar fechada', false, 7);
