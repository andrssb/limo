import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  GROQ_API_KEY: z.string(),
  ANTHROPIC_API_KEY: z.string().default("sk-ant-placeholder"),
  OPENAI_API_KEY: z.string().default("sk-placeholder"),
  STORAGE_ENDPOINT: z.string().default(""),
  STORAGE_ACCESS_KEY: z.string().default(""),
  STORAGE_SECRET_KEY: z.string().default(""),
  STORAGE_BUCKET: z.string().default("limo-audio"),
  STORAGE_REGION: z.string().default("us-east-1"),
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default("Limo <noreply@limo.app>"),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_PRICE_START: z.string().default(""),
  STRIPE_PRICE_METRICS: z.string().default(""),
  STRIPE_PRICE_BUSINESS: z.string().default(""),
  STRIPE_PRICE_PERSONA_PACK_50: z.string().default(""),
  STRIPE_PRICE_PERSONA_PACK_80: z.string().default(""),
  STRIPE_PRICE_PERSONA_PACK_90: z.string().default(""),
  STRIPE_PRICE_PERSONA_PACK_100: z.string().default(""),
  HUBSPOT_CLIENT_ID: z.string().optional(),
  HUBSPOT_CLIENT_SECRET: z.string().optional(),
  HUBSPOT_REDIRECT_URI: z.string().optional(),
  PIPEDRIVE_CLIENT_ID: z.string().optional(),
  PIPEDRIVE_CLIENT_SECRET: z.string().optional(),
  PIPEDRIVE_REDIRECT_URI: z.string().optional(),
  SALESFORCE_CLIENT_ID: z.string().optional(),
  SALESFORCE_CLIENT_SECRET: z.string().optional(),
  SALESFORCE_REDIRECT_URI: z.string().optional(),
  PORT: z.coerce.number().default(3001),
  API_PORT: z.coerce.number().optional(),
  API_HOST: z.string().default("0.0.0.0"),
  FRONTEND_URL: z.string().default("http://localhost:3000"),
  // App (dashboard) origin used for post-checkout redirects. Distinct from
  // FRONTEND_URL, which also feeds CORS and points at the marketing site.
  APP_URL: z.string().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  ENCRYPTION_KEY: z.string().min(32),
  ESCAVADOR_API_KEY: z.string().default(""),
  PROXYCURL_API_KEY: z.string().default(""),
  // Serper.dev — Google SERP API. Descobre o líder de cada setor parseando o
  // snippet do LinkedIn no Google (nome+cargo) sem abrir o LinkedIn. Camada que
  // mais reduz consulta paga: resolve o "quem lidera" antes de chegar no bureau.
  SERPER_API_KEY: z.string().default(""),
  // Scrapfly — render de JS + proxy + anti-bot pro crawler de site. Usado em
  // CASCATA: só quando o fetch cru volta magro (site SPA Wix/React). Cobra crédito
  // só quando aciona (render ~6, anti-bot ~30). Sem chave = fica só no fetch cru.
  SCRAPFLY_API_KEY: z.string().default(""),
  // Abstract Email Reputation — verifica se o e-mail do padrão MX é entregável.
  // Sobe a confiança de "baixa" (palpite) p/ "alta" (deliverable) ou "media"
  // (catch-all). Sem chave = cai no palpite antigo. Free tier = 1 req/s.
  ABSTRACT_EMAIL_API_KEY: z.string().default(""),
  // Enriquecimento pago plugável. Provedor ativo (default assertiva).
  ENRICHMENT_PROVIDER: z.string().default("assertiva"),
  // Assertiva Localize — OAuth2 client_credentials (Basic auth → bearer token).
  ASSERTIVA_CLIENT_ID: z.string().default(""),
  ASSERTIVA_CLIENT_SECRET: z.string().default(""),
  ASSERTIVA_BASE_URL: z.string().default("https://api.assertivasolucoes.com.br"),
  // Pool da Assertiva: parâmetros do consumo estimado (oficial quando houver
  // endpoint de saldo). Custo/consulta em LOTE = R$0,25 (Rafael, 2026-06-09).
  ASSERTIVA_MONTHLY_POOL_BRL:    z.coerce.number().default(550),
  ASSERTIVA_COST_PER_QUERY_BRL:  z.coerce.number().default(0.25),
  // Dono (vê o painel do pool da Assertiva). Gate por email do JWT.
  OWNER_EMAIL: z.string().default("andressalessb@gmail.com"),
  // Destino dos alertas de novo cadastro. Separado do OWNER_EMAIL (que é o gate
  // do painel) — vazio = cai no OWNER_EMAIL.
  SIGNUP_ALERT_EMAIL: z.string().default(""),
  // Link do Calendly pra agendar demo (fluxo de time sem Limo no cadastro).
  CALENDLY_DEMO_URL: z.string().default("https://calendly.com/limo/demo"),
  // BigDataCorp — mantido como fallback atrás da camada plugável.
  BIGDATACORP_ACCESS_TOKEN: z.string().default(""),
  BIGDATACORP_TOKEN_ID: z.string().default(""),
  GOOGLE_PLACES_API_KEY: z.string().default(""),
  BING_SEARCH_API_KEY: z.string().default(""),
  // Descobrir: quantas empresas da RF tentar resolver o site (fonte extra pelo
  // nome) por execução. Cada tentativa é 1 consulta (Google Places/Serper), então
  // é o teto de custo/latência da busca. Só as que TÊM site voltam qualificadas.
  DISCOVERY_SITE_BUDGET: z.coerce.number().default(200),
  // SDR de voz: permanece desligado até o piloto, revisão jurídica e
  // configuração explícita do provedor. Nenhum segredo é exposto pela API.
  VOICE_SDR_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  VOICE_SDR_LIVE_CALLS: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  VOICE_SDR_DAILY_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
  // Numeros proprios autorizados a receber ligacao em modo teste fora do
  // horario comercial, separados por virgula. Vazio = modo teste desligado.
  VOICE_SDR_TEST_PHONES: z.string().default(""),
  ELEVENLABS_API_KEY: z.string().default(""),
  ELEVENLABS_WEBHOOK_SECRET: z.string().default(""),
  ELEVENLABS_TOOL_SECRET: z.string().default(""),
  ELEVENLABS_AGENT_ID: z.string().default(""),
  ELEVENLABS_PHONE_NUMBER_ID: z.string().default(""),
  SIP_BRIDGE_HEALTH_URL: z.string().url().or(z.literal("")).default(""),
  SIP_BRIDGE_HEALTH_TIMEOUT_MS: z.coerce.number().int().min(500).max(10_000).default(3_000),
  GOOGLE_CALENDAR_CLIENT_ID: z.string().default(""),
  GOOGLE_CALENDAR_CLIENT_SECRET: z.string().default(""),
  GOOGLE_CALENDAR_REDIRECT_URI: z.string().default(""),
  GOOGLE_CALENDAR_ACCOUNT: z.string().default(""),
  GOOGLE_CALENDAR_ID: z.string().default("primary"),
  GOOGLE_CALENDAR_MEETING_MINUTES: z.coerce.number().int().min(15).max(120).default(45),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
