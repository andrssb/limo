import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { getDb } from "@limo/db";
import { teams } from "@limo/db";
import { eq, sql } from "drizzle-orm";
import { config } from "../config.js";

// Plan → Stripe price ID mapping (populated from env vars)
function getPriceId(plan: string): string | null {
  const map: Record<string, string> = {
    start:    config.STRIPE_PRICE_START,
    metrics:  config.STRIPE_PRICE_METRICS,
    business: config.STRIPE_PRICE_BUSINESS,
  };
  return map[plan] || null;
}

// Stripe price ID → DB plan name
function planFromPriceId(priceId: string): "start" | "metrics" | "business" | null {
  if (priceId === config.STRIPE_PRICE_START)    return "start";
  if (priceId === config.STRIPE_PRICE_METRICS)  return "metrics";
  if (priceId === config.STRIPE_PRICE_BUSINESS) return "business";
  return null;
}

// One-time persona packs: size → Stripe price ID
const PERSONA_PACK_SIZES = [50, 80, 90, 100] as const;
type PersonaPackSize = (typeof PERSONA_PACK_SIZES)[number];

function getPersonaPackPriceId(size: PersonaPackSize): string | null {
  const map: Record<PersonaPackSize, string> = {
    50:  config.STRIPE_PRICE_PERSONA_PACK_50,
    80:  config.STRIPE_PRICE_PERSONA_PACK_80,
    90:  config.STRIPE_PRICE_PERSONA_PACK_90,
    100: config.STRIPE_PRICE_PERSONA_PACK_100,
  };
  return map[size] || null;
}

export async function billingRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── POST /billing/checkout ──────────────────────────────────────────────────
  // Creates a Stripe Checkout session and returns its URL.
  // The team ID is embedded in client_reference_id so the webhook can find it.

  fastify.post("/billing/checkout", { preHandler: [requireAuth] }, async (request, reply) => {
    if (!config.STRIPE_SECRET_KEY) {
      return reply.code(503).send({ message: "Pagamento não configurado" });
    }

    const { plan } = z.object({ plan: z.enum(["start", "metrics", "business"]) }).parse(request.body);
    const { teamId } = request.user as any;

    if (!teamId) return reply.code(400).send({ message: "Usuário sem time associado" });

    const priceId = getPriceId(plan);
    if (!priceId) {
      return reply.code(503).send({ message: `Plano '${plan}' não configurado no Stripe` });
    }

    const stripe = new Stripe(config.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      mode:                 "subscription",
      line_items:           [{ price: priceId, quantity: 1 }],
      client_reference_id:  teamId,
      success_url:          `${config.APP_URL}/dashboard?payment=success&plan=${plan}`,
      cancel_url:           `${config.APP_URL}/trial-expired`,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { teamId, plan },
      },
    });

    return reply.send({ url: session.url });
  });

  // ─── POST /billing/persona-pack/checkout ─────────────────────────────────────
  // One-time purchase of an extra persona pack (+50/+80/+90/+100).
  // Adds to teams.personas_extra_balance via the webhook on success.

  fastify.post("/billing/persona-pack/checkout", { preHandler: [requireAuth] }, async (request, reply) => {
    if (!config.STRIPE_SECRET_KEY) {
      return reply.code(503).send({ message: "Pagamento não configurado" });
    }

    const { size } = z.object({
      size: z.union([z.literal(50), z.literal(80), z.literal(90), z.literal(100)]),
    }).parse(request.body);
    const { teamId } = request.user as any;

    if (!teamId) return reply.code(400).send({ message: "Usuário sem time associado" });

    const priceId = getPersonaPackPriceId(size);
    if (!priceId) {
      return reply.code(503).send({ message: `Pacote de +${size} personas não configurado no Stripe` });
    }

    const stripe = new Stripe(config.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      mode:                "payment",
      line_items:          [{ price: priceId, quantity: 1 }],
      client_reference_id: teamId,
      success_url:         `${config.APP_URL}/garimpo?pack=success&size=${size}`,
      cancel_url:          `${config.APP_URL}/garimpo?pack=cancelled`,
      metadata: { teamId, kind: "persona-pack", size: String(size) },
    });

    return reply.send({ url: session.url });
  });

  // ─── POST /billing/webhook ───────────────────────────────────────────────────
  // Stripe sends events here. We handle:
  //   - checkout.session.completed  → activate plan immediately after first payment
  //   - invoice.paid                → keep plan active on renewal
  //   - customer.subscription.deleted → revert to trial / lock

  fastify.post("/billing/webhook", {
    config: { rawBody: true },    // Stripe requires the raw body for signature verification
  }, async (request, reply) => {
    if (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET) {
      return reply.code(503).send({ message: "Webhook não configurado" });
    }

    const stripe = new Stripe(config.STRIPE_SECRET_KEY);
    const sig = request.headers["stripe-signature"] as string;

    let event: Stripe.Event;
    try {
      // rawBody is attached by @fastify/rawbody (or we fall back to JSON body)
      const rawBody = (request as any).rawBody ?? JSON.stringify(request.body);
      event = stripe.webhooks.constructEvent(rawBody, sig, config.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      fastify.log.warn(`Stripe webhook signature invalid: ${(err as Error).message}`);
      return reply.code(400).send({ message: "Webhook signature inválida" });
    }

    const db = getDb();

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const teamId = session.client_reference_id;

      // Persona pack (one-time payment) — credit extra balance and stop here.
      const md = (session.metadata ?? {}) as Record<string, string>;
      if (session.mode === "payment" && md.kind === "persona-pack") {
        const sizeNum = Number(md.size);
        if (teamId && [50, 80, 90, 100].includes(sizeNum)) {
          await db.update(teams)
            .set({ personasExtraBalance: sql`${teams.personasExtraBalance} + ${sizeNum}` })
            .where(eq(teams.id, teamId));
          fastify.log.info(`Team ${teamId} purchased persona pack +${sizeNum}`);
        }
        return reply.send({ received: true });
      }

      const priceId = session.line_items?.data?.[0]?.price?.id
        ?? (session as any).subscription?.plan?.id  // fallback — may need expand
        ?? null;

      // Retrieve the subscription to get the price ID reliably
      let resolvedPlan: "start" | "metrics" | "business" | null = null;
      if (session.subscription && typeof session.subscription === "string") {
        try {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          const itemPriceId = sub.items.data[0]?.price?.id ?? null;
          if (itemPriceId) resolvedPlan = planFromPriceId(itemPriceId);
        } catch { /* ignore */ }
      }
      if (!resolvedPlan && priceId) resolvedPlan = planFromPriceId(priceId);
      // Fallback: read from subscription metadata set at checkout creation
      if (!resolvedPlan && session.subscription) {
        const metaPlan = (session as any).metadata?.plan as string | undefined;
        if (metaPlan === "start" || metaPlan === "metrics" || metaPlan === "business") {
          resolvedPlan = metaPlan;
        }
      }

      if (teamId && resolvedPlan) {
        await db.update(teams)
          .set({ plan: resolvedPlan, trialEndsAt: null })
          .where(eq(teams.id, teamId));
        fastify.log.info(`Team ${teamId} upgraded to plan '${resolvedPlan}'`);
      }
    }

    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      const sub = (invoice as Stripe.Invoice & {
        subscription?: string | Stripe.Subscription | null;
      }).subscription;
      if (sub && typeof sub === "string") {
        try {
          const subscription = await stripe.subscriptions.retrieve(sub);
          const teamId = subscription.metadata?.teamId;
          const priceId = subscription.items.data[0]?.price?.id ?? null;
          const plan = priceId ? planFromPriceId(priceId) : null;
          if (teamId && plan) {
            await db.update(teams)
              .set({ plan, trialEndsAt: null })
              .where(eq(teams.id, teamId));
          }
        } catch { /* ignore */ }
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const teamId = subscription.metadata?.teamId;
      if (teamId) {
        await db.update(teams)
          .set({ plan: "trial", trialEndsAt: new Date() })  // expired immediately
          .where(eq(teams.id, teamId));
        fastify.log.info(`Team ${teamId} subscription cancelled — reverted to trial`);
      }
    }

    return reply.send({ received: true });
  });
}
