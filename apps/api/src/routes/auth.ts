import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getDb } from "@limo/db";
import { users, teams, teamInvites, signupSurveys } from "@limo/db";
import { eq, and, gt, ilike, isNotNull } from "drizzle-orm";
import { config } from "../config.js";
import { sendWelcomeEmail, sendSignupAlert } from "../services/email.js";

const registerSchema = z.object({
  email:      z.string().email(),
  password:   z.string().min(8),
  name:       z.string().min(2),
  role:       z.enum(["sdr", "bdr", "manager"]).default("sdr"),
  teamName:   z.string().optional(),
  inviteCode: z.string().optional(),
  jobTitle:   z.string().max(200).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  fastify.post("/auth/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const existing = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (existing.length > 0) {
      return reply.code(409).send({ statusCode: 409, error: "Conflict", message: "E-mail já cadastrado" });
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    // Validate invite code before creating user
    let inviteRecord: typeof teamInvites.$inferSelect | null = null;
    if (body.inviteCode) {
      const [found] = await db.select().from(teamInvites)
        .where(and(eq(teamInvites.code, body.inviteCode.toUpperCase()), gt(teamInvites.expiresAt, new Date())))
        .limit(1);
      if (!found) return reply.code(400).send({ message: "Convite inválido ou expirado" });
      if (found.maxUses !== null && found.uses >= found.maxUses) {
        return reply.code(400).send({ message: "Este convite atingiu o limite de usos" });
      }
      inviteRecord = found;
    }

    const [user] = await db.insert(users).values({
      email:        body.email,
      name:         body.name,
      passwordHash,
      role:         body.role,
      teamId:       inviteRecord?.teamId ?? null,
      jobTitle:     body.jobTitle ?? null,
    }).returning();

    let teamId: string | null = inviteRecord?.teamId ?? null;

    if (inviteRecord) {
      await db.update(teamInvites)
        .set({ uses: inviteRecord.uses + 1 })
        .where(eq(teamInvites.id, inviteRecord.id));
    } else if (body.role === "manager" && body.teamName) {
      const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const [team] = await db.insert(teams).values({ name: body.teamName, managerId: user!.id, trialEndsAt }).returning();
      teamId = team!.id;
      await db.update(users).set({ teamId }).where(eq(users.id, user!.id));
    }

    // Fetch trialEndsAt from the team (may have been set above or via invite)
    let trialEndsAt: Date | null = null;
    let teamPlan: string | null = null;
    if (teamId) {
      const [team] = await db.select({ trialEndsAt: teams.trialEndsAt, plan: teams.plan }).from(teams).where(eq(teams.id, teamId)).limit(1);
      trialEndsAt = team?.trialEndsAt ?? null;
      teamPlan    = team?.plan ?? null;
    }

    const userWithTeam = { ...user!, teamId, trialEndsAt, teamPlan };
    const tokens = signTokens(fastify, userWithTeam);

    // Fire-and-forget — do not block the response
    sendWelcomeEmail({ name: user!.name, email: user!.email, role: body.role, teamName: body.teamName }).catch(console.error);
    sendSignupAlert({ kind: "account", name: user!.name, email: user!.email, company: body.teamName, role: body.role }).catch(console.error);

    return reply.code(201).send({ user: sanitizeUser(userWithTeam), tokens });
  });

  fastify.post("/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);

    if (!user) {
      return reply.code(401).send({ statusCode: 401, error: "Unauthorized", message: "Credenciais inválidas" });
    }

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ statusCode: 401, error: "Unauthorized", message: "Credenciais inválidas" });
    }

    let trialEndsAt: Date | null = null;
    let teamPlan: string | null = null;
    if (user.teamId) {
      const [team] = await db.select({ trialEndsAt: teams.trialEndsAt, plan: teams.plan }).from(teams).where(eq(teams.id, user.teamId)).limit(1);
      trialEndsAt = team?.trialEndsAt ?? null;
      teamPlan    = team?.plan ?? null;
    }

    const tokens = signTokens(fastify, user);
    return reply.send({ user: sanitizeUser({ ...user, trialEndsAt, teamPlan }), tokens });
  });

  fastify.post("/auth/refresh", async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string };
    try {
      const payload = fastify.jwt.verify<{ id: string; type: string }>(refreshToken);
      if (payload.type !== "refresh") throw new Error("Invalid token type");

      const [user] = await db.select().from(users).where(eq(users.id, payload.id)).limit(1);
      if (!user) return reply.code(401).send({ statusCode: 401, error: "Unauthorized", message: "Usuário não encontrado" });

      const tokens = signTokens(fastify, user);
      return reply.send({ tokens });
    } catch {
      return reply.code(401).send({ statusCode: 401, error: "Unauthorized", message: "Refresh token inválido" });
    }
  });

  fastify.get("/auth/me", { preHandler: [async (req, rep) => { try { await req.jwtVerify(); } catch { rep.code(401).send({}); } }] }, async (request, reply) => {
    const { id } = request.user as any;
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) return reply.code(404).send({});

    let trialEndsAt: Date | null = null;
    let teamPlan: string | null = null;
    if (user.teamId) {
      const [team] = await db.select({ trialEndsAt: teams.trialEndsAt, plan: teams.plan }).from(teams).where(eq(teams.id, user.teamId)).limit(1);
      trialEndsAt = team?.trialEndsAt ?? null;
      teamPlan    = team?.plan ?? null;
    }

    return reply.send({ user: sanitizeUser({ ...user, trialEndsAt, teamPlan }) });
  });

  // ─── POST /auth/check-team ──────────────────────────────────────────────────
  // Detecta se o time da pessoa já usa o Limo, pelo DOMÍNIO do email. Casa o
  // domínio corporativo com membros existentes vinculados a um time. Domínios
  // gratuitos (gmail, etc.) nunca casam — são ambíguos demais.
  fastify.post("/auth/check-team", async (request, reply) => {
    const { email } = z.object({ email: z.string().email() }).parse(request.body);
    const domain = email.split("@")[1]?.toLowerCase() ?? "";

    if (!domain || FREE_EMAIL_DOMAINS.has(domain)) {
      return reply.send({ hasTeam: false, reason: domain ? "free_domain" : "invalid" });
    }

    const [member] = await db.select({ id: users.id }).from(users)
      .where(and(ilike(users.email, `%@${domain}`), isNotNull(users.teamId)))
      .limit(1);

    return reply.send({ hasTeam: Boolean(member) });
  });

  // ─── POST /signup/survey ────────────────────────────────────────────────────
  // Salva o lead do mini-typeform. Público (roda antes de existir conta). Não
  // bloqueia o fluxo: se falhar, o front segue mesmo assim.
  fastify.post("/signup/survey", async (request, reply) => {
    // Endpoint público: validamos com safeParse e devolvemos um 400 enxuto, sem
    // expor a estrutura interna do schema (o `details` do handler global).
    const parsed = surveySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ statusCode: 400, error: "Bad Request", message: "Dados inválidos" });
    }
    const body = parsed.data;
    const [row] = await db.insert(signupSurveys).values({
      fullName:    body.fullName.trim(),
      company:     body.company?.trim() || null,
      website:     body.website?.trim() || null,
      email:       body.email.toLowerCase().trim(),
      phone:       body.phone?.trim() || null,
      accessType:  body.accessType,
      topFeature:  body.topFeature ?? null,
      teamHasLimo: body.teamHasLimo ?? null,
      peopleCount: body.peopleCount ?? null,
      peopleRoles: body.peopleRoles?.trim() || null,
      buyerRole:   body.buyerRole?.trim() || null,
      outcome:     body.outcome ?? null,
    }).returning({ id: signupSurveys.id });
    // Alerta o dono do novo lead (fire-and-forget — não bloqueia a resposta).
    sendSignupAlert({
      kind: "lead",
      name: body.fullName, email: body.email,
      company: body.company, phone: body.phone,
      accessType: body.accessType, outcome: body.outcome,
    }).catch(console.error);
    // Devolve o link do Calendly (config) — usado pelo fluxo de demo no front.
    return reply.code(201).send({ id: row!.id, calendlyUrl: config.CALENDLY_DEMO_URL });
  });
}

// Provedores de email gratuitos — nunca indicam "time corporativo no Limo".
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "outlook.com", "outlook.com.br", "live.com",
  "yahoo.com", "yahoo.com.br", "icloud.com", "bol.com.br", "uol.com.br",
  "terra.com.br", "globo.com", "msn.com", "me.com", "proton.me", "protonmail.com",
]);

const surveySchema = z.object({
  fullName:    z.string().min(2),
  company:     z.string().optional(),
  website:     z.string().optional(),
  email:       z.string().email(),
  phone:       z.string().optional(),
  accessType:  z.enum(["individual", "team"]),
  topFeature:  z.string().max(100).optional(),
  teamHasLimo: z.boolean().optional(),
  peopleCount: z.coerce.number().int().positive().optional(),
  peopleRoles: z.string().optional(),
  buyerRole:   z.string().optional(),
  outcome:     z.enum(["account", "ask_invite", "demo"]).optional(),
});

function signTokens(fastify: FastifyInstance, user: { id: string; email: string; role: string; teamId: string | null }) {
  const accessToken = fastify.jwt.sign(
    { id: user.id, email: user.email, role: user.role, teamId: user.teamId },
    { expiresIn: config.JWT_EXPIRES_IN }
  );
  const refreshToken = fastify.jwt.sign(
    { id: user.id, type: "refresh" },
    { expiresIn: config.JWT_REFRESH_EXPIRES_IN }
  );
  return { accessToken, refreshToken };
}

function sanitizeUser(user: { id: string; email: string; name: string; role: string; teamId: string | null; jobTitle?: string | null; avatarUrl: string | null; createdAt: Date; trialEndsAt?: Date | null; teamPlan?: string | null }) {
  return {
    id:          user.id,
    email:       user.email,
    name:        user.name,
    role:        user.role,
    teamId:      user.teamId,
    jobTitle:    user.jobTitle   ?? null,
    avatarUrl:   user.avatarUrl  ?? null,
    createdAt:   user.createdAt,
    trialEndsAt: user.trialEndsAt ?? null,
    teamPlan:    user.teamPlan    ?? null,
  };
}
