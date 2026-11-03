import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { getRedis } from "./lib/redis.js";
import { authRoutes } from "./routes/auth.js";
import { contactsRoutes } from "./routes/contacts.js";
import { callsRoutes } from "./routes/calls.js";
import { whatsappRoutes } from "./routes/whatsapp.js";
import { crmRoutes } from "./routes/crm.js";
import { contentRoutes } from "./routes/content.js";
import { teamsRoutes } from "./routes/teams.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { listsRoutes } from "./routes/lists.js";
import { personasRoutes } from "./routes/personas.js";
import { discoveryRoutes } from "./routes/discovery.js";
import { garimpoRoutes } from "./routes/garimpo.js";
import { goalsRoutes } from "./routes/goals.js";
import { coachingRoutes } from "./routes/coaching.js";
import { qualificationRoutes } from "./routes/qualification.js";
import { developmentRoutes } from "./routes/development.js";
import { voipRoutes } from "./routes/voip.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { billingRoutes } from "./routes/billing.js";
import { adminRoutes } from "./routes/admin.js";
import { eventsRoutes } from "./routes/events.js";
import { liaRoutes } from "./routes/lia.js";
import { voiceSdrRoutes } from "./routes/voice-sdr.js";

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "debug",
      transport: config.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
    },
  });

  // ── Plugins ───────────────────────────────────────────────────────────────

  const allowedOrigins = config.FRONTEND_URL.split(",").map(s => s.trim());
  await fastify.register(fastifyCors, {
    origin: (origin, cb) => {
      if (
        !origin ||
        allowedOrigins.some(o => origin === o) ||
        origin.endsWith(".vercel.app") ||
        origin.endsWith(".limoapp.com.br") ||
        origin === "https://limoapp.com.br" ||
        origin.endsWith(".up.railway.app") ||
        origin.startsWith("chrome-extension://") ||
        origin.startsWith("http://localhost") ||
        origin.startsWith("http://127.0.0.1")
      ) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
    credentials: true,
  });

  await fastify.register(fastifyJwt, {
    secret: config.JWT_SECRET,
  });

  await fastify.register(fastifyMultipart, {
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB for call recordings
  });

  // Raw body access needed for Stripe webhook signature verification
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  await fastify.register((await import("fastify-raw-body")).default, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
  });

  await fastify.register(fastifyRateLimit, {
    global: false,
    redis: getRedis() as any,
  });

  // ── Health ────────────────────────────────────────────────────────────────

  fastify.get("/health", async () => ({ status: "ok", version: "0.3.0" }));

  // ── Error handler ─────────────────────────────────────────────────────────
  // Precisa ser registrado ANTES das rotas: handlers definidos depois de um
  // `register` encapsulado não se aplicam às rotas já registradas (elas ficam
  // com o handler default do Fastify — devolvendo 500 cru em erro de validação).
  fastify.setErrorHandler((error, _request, reply) => {
    fastify.log.error(error);
    if (error.name === "ZodError") {
      return reply.code(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Dados inválidos",
        details: (error as any).errors,
      });
    }
    const statusCode = error.statusCode ?? 500;
    return reply.code(statusCode).send({
      statusCode,
      error: error.name,
      message: error.message,
    });
  });

  // ── Routes ────────────────────────────────────────────────────────────────

  const V1_PREFIX = "/v1";

  await fastify.register(authRoutes, { prefix: V1_PREFIX });
  await fastify.register(contactsRoutes, { prefix: V1_PREFIX });
  await fastify.register(callsRoutes, { prefix: V1_PREFIX });
  await fastify.register(whatsappRoutes, { prefix: V1_PREFIX });
  await fastify.register(crmRoutes, { prefix: V1_PREFIX });
  await fastify.register(contentRoutes, { prefix: V1_PREFIX });
  await fastify.register(teamsRoutes, { prefix: V1_PREFIX });
  await fastify.register(feedbackRoutes, { prefix: V1_PREFIX });
  await fastify.register(listsRoutes, { prefix: V1_PREFIX });
  await fastify.register(personasRoutes, { prefix: V1_PREFIX });
  await fastify.register(discoveryRoutes, { prefix: V1_PREFIX });
  await fastify.register(garimpoRoutes, { prefix: V1_PREFIX });
  await fastify.register(goalsRoutes, { prefix: V1_PREFIX });
  await fastify.register(coachingRoutes, { prefix: V1_PREFIX });
  await fastify.register(qualificationRoutes, { prefix: V1_PREFIX });
  await fastify.register(developmentRoutes, { prefix: V1_PREFIX });
  await fastify.register(voipRoutes, { prefix: V1_PREFIX });
  await fastify.register(analyticsRoutes, { prefix: V1_PREFIX });
  await fastify.register(billingRoutes, { prefix: V1_PREFIX });
  await fastify.register(adminRoutes,   { prefix: V1_PREFIX });
  await fastify.register(eventsRoutes,  { prefix: V1_PREFIX });
  await fastify.register(liaRoutes,     { prefix: V1_PREFIX });
  await fastify.register(voiceSdrRoutes, { prefix: V1_PREFIX });

  return fastify;
}
