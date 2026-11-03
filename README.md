# Limo

Plataforma SaaS de prospecção B2B para times comerciais (BDR/SDR). Ela descobre empresas e decisores, enriquece os contatos com um motor próprio e usa LLMs para analisar ligações, qualificar leads e dar coaching ao vendedor em tempo real.

O Limo esteve em produção entre maio e outubro de 2026, com app web, site, API e extensão do Chrome publicada na Chrome Web Store. Hoje este repositório serve como portfólio.

## O que tem aqui

| Módulo | O que faz |
| --- | --- |
| `apps/api` | API em Fastify + TypeScript, filas BullMQ (Redis) e workers agendados |
| `apps/web` | Painel do time comercial (React + Vite) |
| `apps/extension` | Extensão do Chrome (Manifest V3, side panel, React + Zustand) |
| `apps/site` | Site institucional (React + Vite) |
| `packages/db` | Schema Drizzle ORM e 38 migrations SQL para PostgreSQL |
| `packages/types` | Tipos compartilhados entre API, web e extensão |
| `infra/sip-bridge` | Ponte SIP em Asterisk para o agente de voz |

São cerca de 30 mil linhas de TypeScript num monorepo com npm workspaces.

## IA generativa no produto

### Roteador de LLMs com fallback (`apps/api/src/lib/llm.ts`)
Toda chamada de LLM passa por um roteador com três níveis de custo e latência:

- **`askClaude`** usa Claude Sonnet no que o cliente paga: análise pós-ligação, qualificação, relatórios e conteúdo.
- **`askClaudeFast`** usa Claude Haiku no que precisa de baixa latência, como o coach ao vivo.
- **`askFast`** usa Llama 3.1 8B na Groq para tarefas descartáveis, como resumos internos.

Se a Claude falhar, devolver vazio ou estiver sem chave, a chamada cai automaticamente no modelo equivalente da Groq. Assim dá para fazer deploy antes de configurar a chave sem quebrar nada.

### Coach de vendas em tempo real (`apps/api/src/services/coaching.ts`)
Durante a ligação, o áudio é transcrito com Whisper (`whisper-large-v3-turbo`). A cada trecho novo, o modelo recebe:

- os últimos segundos da conversa;
- o histórico da ligação;
- o contexto do time: materiais de produto já resumidos em JSON estruturado (dores, diferenciais, objeções) e os insights mais recentes.

A partir disso ele devolve de 2 a 3 sugestões imediatas, baseadas em SPIN e AIDA.

### Análise de ligação e qualificação (`apps/api/src/prompts`, `apps/api/src/services/ai.ts`)
São prompts versionados em código para:

- análise de ligação com nota por critério;
- qualificação de lead (fit com o ICP, dores, momento de compra, decisor);
- plano de desenvolvimento do vendedor;
- relatório semanal do gestor;
- geração de conteúdo.

O modelo responde em JSON com formato definido no prompt, e a API extrai e converte essa resposta antes de gravar no banco.

### SDR de voz (`apps/api/src/routes/voice-sdr.ts`, `infra/sip-bridge`)
Agente de voz que liga para leads e agenda reuniões no Google Calendar. É feito com ElevenLabs Conversational AI, e a telefonia brasileira passa por uma ponte SIP em Asterisk: a operadora exige `REGISTER`, enquanto a ElevenLabs entrega `INVITE` autenticado.

Ele foi desenhado com várias travas de segurança:

- duas flags independentes para chamada real, e o executor sempre começa em dry-run;
- webhook com assinatura HMAC e janela de 5 minutos;
- eventos idempotentes, lista de supressão, limite em janela móvel de 24h e uma chamada simultânea.

## Motor de dados

- **Base da Receita Federal:** importação mensal (GitHub Actions) dos dados abertos de CNPJ, com 14,5 milhões de empresas e 27 milhões de sócios no PostgreSQL, com índices trigram e por CNAE.
- **Enriquecimento próprio** (`apps/api/src/services/enrichment/engine`), em vez de depender de API paga por crédito:
  - acha o domínio da empresa e extrai telefones do site;
  - detecta o padrão de e-mail da empresa e verifica os endereços;
  - casa a identidade da pessoa entre fontes;
  - dá a cada dado uma nota de confiança e registra de onde ele veio.
- **Descoberta de empresas** (`apps/api/src/services/discovery`): mapeia setor para CNAE, encontra o site oficial e estima porte e faturamento.

## Outras integrações

- WhatsApp via Baileys, com sessão em Redis e resolução do JID real (o "nono dígito" do Brasil).
- CRMs: HubSpot, Pipedrive e Salesforce.
- Pagamento com Stripe (planos e quotas por time), e-mail transacional com Resend e storage S3.
- Autenticação JWT, rate limit, criptografia das credenciais de integração e telemetria do funil da extensão.

## Rodando localmente

Requisitos: Node 20+, Docker.

```bash
cp .env.example .env          # preencha as chaves (Groq, Anthropic etc.)
docker compose up -d          # PostgreSQL, Redis e MinIO (S3 local)
npm install
npm run db:migrate
npm run dev:api               # API em http://localhost:3001
npm run dev:web               # painel
```

Testes do módulo de voz:

```bash
npm run test:voice-sdr --workspace=apps/api
```

## Stack

TypeScript, Node.js, Fastify, React, Vite, PostgreSQL, Drizzle ORM, Redis, BullMQ, Claude (Anthropic), Groq (Llama, Whisper), ElevenLabs, Asterisk, Docker, GitHub Actions, Railway, Vercel e Cloudflare.
