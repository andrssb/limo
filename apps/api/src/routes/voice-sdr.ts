import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, asc, count, desc, eq, gte, inArray } from "drizzle-orm";
import {
  contacts,
  getDb,
  googleCalendarConnections,
  voiceCallAttempts,
  voiceCampaignContacts,
  voiceCampaigns,
  voiceMeetingRequests,
  voiceSuppressions,
} from "@limo/db";
import { config } from "../config.js";
import { requireManager } from "../middleware/auth.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { isConnected as isWhatsAppConnected, sendWhatsAppText } from "../services/whatsapp.js";
import {
  createGoogleCalendarMeeting,
  updateGoogleCalendarAttendee,
  exchangeGoogleCalendarCode,
  getGoogleAccountEmail,
  getGoogleCalendarAuthUrl,
  GoogleCalendarError,
  isGoogleCalendarSlotAvailable,
  refreshGoogleCalendarToken,
} from "../services/google-calendar.js";
import {
  extractAttemptId,
  extractVoiceOutcome,
  evaluateVoiceEligibility,
  getSipBridgeHealth,
  getVoiceDateContext,
  getVoiceDateSpeechContext,
  formatVoiceTimeSpoken,
  evaluateMeetingAttemptAssociation,
  reconcileVoiceOutcome,
  parseAuthorizedTestPhones,
  isAuthorizedTestPhone,
  normalizeBrazilianPhone,
  startElevenLabsSipCall,
  validateVoiceMeetingTime,
  VoiceProviderError,
  verifyElevenLabsSignature,
  verifyToolBearer,
} from "../services/voice-sdr.js";

const createCampaignSchema = z.object({
  name: z.string().trim().min(3).max(200),
  timezone: z.string().trim().min(3).max(80).default("America/Sao_Paulo"),
  businessHourStart: z.number().int().min(8).max(17).default(9),
  businessHourEnd: z.number().int().min(9).max(20).default(18),
  dailyLimit: z.number().int().min(1).max(50).optional(),
  maxAttemptsPerLead: z.number().int().min(1).max(3).default(2),
  minRetryHours: z.number().int().min(24).max(720).default(48),
  recordingEnabled: z.boolean().default(false),
}).refine((body) => body.businessHourStart < body.businessHourEnd, {
  message: "O horário inicial deve ser anterior ao horário final",
});

const addContactsSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(500),
});

const suppressionSchema = z.object({
  phone: z.string().min(8).max(50),
  reason: z.string().trim().min(2).max(80).default("do_not_call"),
});

const campaignStatusSchema = z.object({
  status: z.enum(["active", "paused"]),
  confirmVoiceRights: z.boolean().optional(),
  confirmCallingCompliance: z.boolean().optional(),
  confirmation: z.string().optional(),
});

const runNextSchema = z.object({
  dryRun: z.boolean().default(true),
  // Modo teste: liga fora do horario comercial, somente para numero da lista
  // VOICE_SDR_TEST_PHONES. Serve para homologar de madrugada sem afrouxar a
  // regra que protege lead real.
  testMode: z.boolean().default(false),
  confirmation: z.string().optional(),
});

const meetingRequestSchema = z.object({
  limo_attempt_id: z.string().uuid(),
  proposed_start_at: z.string().datetime({ offset: true }),
  timezone: z.string().trim().min(3).max(80).default("America/Sao_Paulo"),
  invitee_email: z.string().email().optional(),
});

function teamFrom(request: FastifyRequest): string | null {
  return request.user.teamId;
}

function rawRequestBody(request: FastifyRequest): string {
  const raw = (request as FastifyRequest & { rawBody?: string | Buffer }).rawBody;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  return raw ?? JSON.stringify(request.body ?? {});
}

function nested(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function stringAt(value: unknown, path: string[]): string | null {
  const found = nested(value, path);
  return typeof found === "string" && found.length > 0 ? found : null;
}

function numberAt(value: unknown, path: string[]): number | null {
  const found = nested(value, path);
  return typeof found === "number" && Number.isFinite(found) ? found : null;
}

export async function voiceSdrRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();
  const googleOAuthConfig = {
    clientId: config.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: config.GOOGLE_CALENDAR_CLIENT_SECRET,
    redirectUri: config.GOOGLE_CALENDAR_REDIRECT_URI,
  };

  async function getCalendarAccessToken(connection: typeof googleCalendarConnections.$inferSelect): Promise<string> {
    if (connection.expiresAt.getTime() > Date.now() + 60_000) return decrypt(connection.accessToken);
    const refreshed = await refreshGoogleCalendarToken(googleOAuthConfig, decrypt(connection.refreshToken));
    await db.update(googleCalendarConnections).set({
      accessToken: encrypt(refreshed.accessToken),
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope,
      updatedAt: new Date(),
    }).where(eq(googleCalendarConnections.id, connection.id));
    return refreshed.accessToken;
  }

  /**
   * Manda o primeiro "oi" no WhatsApp assim que a reuniao confirma, ainda
   * durante a ligacao: o lead ve a mensagem chegar enquanto fala com o Luis, o
   * que prova que o contato e real e abre o canal de continuidade.
   *
   * Nunca derruba o agendamento: se a sessao nao estiver conectada ou o envio
   * falhar, devolve false e o agente fala no futuro ("vou te mandar") em vez de
   * afirmar algo que nao aconteceu.
   */
  async function sendMeetingWhatsApp(input: {
    campaignId: string;
    phone: string;
    firstName: string | null;
    dateSpoken: string;
    timeSpoken: string;
  }): Promise<boolean> {
    try {
      const [campaign] = await db.select({ createdBy: voiceCampaigns.createdBy })
        .from(voiceCampaigns).where(eq(voiceCampaigns.id, input.campaignId)).limit(1);
      if (!campaign || !isWhatsAppConnected(campaign.createdBy)) return false;

      const saudacao = input.firstName ? `Oi, ${input.firstName}!` : "Oi!";
      const texto = [
        `${saudacao} Aqui é o Luís, do time comercial do Limo — a gente acabou de falar por telefone.`,
        `Nossa demonstração ficou marcada para ${input.dateSpoken}, às ${input.timeSpoken}, e o convite com o link já foi para o seu e-mail.`,
        "Vou te mandar por aqui algumas informações pra deixar tudo pronto. Qualquer coisa, é só me chamar.",
      ].join(String.fromCharCode(10));

      await sendWhatsAppText(campaign.createdBy, input.phone, texto);
      return true;
    } catch (error) {
      fastify.log.warn({ err: error, campaignId: input.campaignId }, "Nao foi possivel enviar o WhatsApp da reuniao");
      return false;
    }
  }

  async function preflightCampaign(campaign: typeof voiceCampaigns.$inferSelect, options?: { ignoreTimeWindow?: boolean }) {
    const now = new Date();
    // Limite conservador em janela móvel de 24h; evita estouro na virada do dia.
    const [attemptCount] = await db.select({ total: count() }).from(voiceCallAttempts)
      .where(and(
        eq(voiceCallAttempts.campaignId, campaign.id),
        gte(voiceCallAttempts.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      ));
    const callsToday = Number(attemptCount?.total ?? 0);

    const [activeAttempt] = await db.select({ id: voiceCallAttempts.id }).from(voiceCallAttempts)
      .where(and(
        eq(voiceCallAttempts.campaignId, campaign.id),
        inArray(voiceCallAttempts.status, ["dialing", "in_progress"]),
      )).limit(1);
    if (activeAttempt) return { candidate: null, callsToday, blockers: ["concurrency_limit"] };

    const queued = await db.select({
      queueId: voiceCampaignContacts.id,
      contactId: voiceCampaignContacts.contactId,
      phone: voiceCampaignContacts.phoneSnapshot,
      attemptsCount: voiceCampaignContacts.attemptsCount,
      nextAttemptAt: voiceCampaignContacts.nextAttemptAt,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      companyName: contacts.companyName,
      jobTitle: contacts.jobTitle,
    }).from(voiceCampaignContacts)
      .innerJoin(contacts, eq(contacts.id, voiceCampaignContacts.contactId))
      .where(and(
        eq(voiceCampaignContacts.campaignId, campaign.id),
        eq(voiceCampaignContacts.status, "pending"),
      ))
      .orderBy(desc(voiceCampaignContacts.priority), asc(voiceCampaignContacts.createdAt))
      .limit(100);

    if (queued.length === 0) return { candidate: null, callsToday, blockers: ["empty_queue"] };
    const suppressedRows = await db.select({ phone: voiceSuppressions.normalizedPhone })
      .from(voiceSuppressions).where(eq(voiceSuppressions.teamId, campaign.teamId));
    const suppressed = new Set(suppressedRows.map((row) => row.phone));
    const blockers = new Set<string>();

    for (const candidate of queued) {
      const reasons = evaluateVoiceEligibility({
        now,
        timezone: campaign.timezone,
        businessHourStart: campaign.businessHourStart,
        businessHourEnd: campaign.businessHourEnd,
        dailyLimit: campaign.dailyLimit,
        callsToday,
        attemptsCount: candidate.attemptsCount,
        maxAttemptsPerLead: campaign.maxAttemptsPerLead,
        nextAttemptAt: candidate.nextAttemptAt,
        phone: candidate.phone,
        suppressed: suppressed.has(candidate.phone),
        ignoreTimeWindow: options?.ignoreTimeWindow,
      });
      if (reasons.length === 0) return { candidate, callsToday, blockers: [] };
      reasons.forEach((reason) => blockers.add(reason));
    }
    return { candidate: null, callsToday, blockers: [...blockers] };
  }

  // Endpoint público apenas para o provedor. A assinatura HMAC e a janela de
  // cinco minutos impedem payload adulterado e replay simples.
  fastify.post(
    "/voice-sdr/webhooks/elevenlabs",
    { config: { rawBody: true } },
    async (request, reply) => {
      if (!config.ELEVENLABS_WEBHOOK_SECRET) {
        fastify.log.error("Webhook de voz chamado sem ELEVENLABS_WEBHOOK_SECRET configurado");
        return reply.code(503).send({ message: "Webhook não configurado" });
      }

      const signatureValue = request.headers["elevenlabs-signature"];
      const signature = Array.isArray(signatureValue) ? signatureValue[0] : signatureValue;
      if (!verifyElevenLabsSignature(rawRequestBody(request), signature, config.ELEVENLABS_WEBHOOK_SECRET)) {
        return reply.code(401).send({ message: "Assinatura inválida" });
      }

      const payload = request.body as Record<string, unknown>;
      const eventType = typeof payload.type === "string" ? payload.type : "unknown";
      if (eventType !== "post_call_transcription" && eventType !== "call_initiation_failure") {
        return reply.send({ received: true, ignored: true });
      }
      const attemptId = extractAttemptId(payload);
      const conversationId = stringAt(payload, ["data", "conversation_id"]);

      let attempt: typeof voiceCallAttempts.$inferSelect | undefined;
      const validAttemptId = z.string().uuid().safeParse(attemptId);
      if (validAttemptId.success) {
        [attempt] = await db.select().from(voiceCallAttempts)
          .where(eq(voiceCallAttempts.id, validAttemptId.data)).limit(1);
      }
      if (!attempt && conversationId) {
        [attempt] = await db.select().from(voiceCallAttempts)
          .where(eq(voiceCallAttempts.providerConversationId, conversationId)).limit(1);
      }

      // Webhooks de teste do painel do provedor não têm tentativa correspondente.
      // Respondemos 200 para não provocar retries, mas não persistimos dado órfão.
      if (!attempt) return reply.send({ received: true, matched: false });

      const data = nested(payload, ["data"]);
      const isFailure = eventType === "call_initiation_failure";
      const claimedOutcome = isFailure ? "failed" : (extractVoiceOutcome(payload) ?? attempt.outcome);
      const [attemptMeeting] = await db.select({ status: voiceMeetingRequests.status })
        .from(voiceMeetingRequests)
        .where(eq(voiceMeetingRequests.attemptId, attempt.id)).limit(1);
      const outcome = reconcileVoiceOutcome(claimedOutcome, attemptMeeting?.status === "confirmed");
      const status = isFailure ? "failed" : "completed";
      const durationSeconds = numberAt(payload, ["data", "metadata", "call_duration_secs"]);
      const startSeconds = numberAt(payload, ["data", "metadata", "start_time_unix_secs"]);
      const summary = stringAt(payload, ["data", "analysis", "transcript_summary"]);
      const errorMessage = stringAt(payload, ["data", "failure_reason"])
        ?? stringAt(payload, ["data", "message"]);
      const alreadyFinalized = attempt.status === "completed" || attempt.status === "failed";

      await db.update(voiceCallAttempts).set({
        providerConversationId: conversationId ?? attempt.providerConversationId,
        status,
        outcome,
        startedAt: startSeconds ? new Date(startSeconds * 1000) : attempt.startedAt,
        endedAt: new Date(),
        durationSeconds: durationSeconds === null ? attempt.durationSeconds : Math.round(durationSeconds),
        transcript: nested(payload, ["data", "transcript"]) ?? attempt.transcript,
        summary: summary ?? attempt.summary,
        providerData: data ?? payload,
        errorMessage: errorMessage ?? attempt.errorMessage,
        updatedAt: new Date(),
      }).where(eq(voiceCallAttempts.id, attempt.id));

      if (!alreadyFinalized) {
        const [queueState] = await db.select().from(voiceCampaignContacts)
          .where(eq(voiceCampaignContacts.id, attempt.campaignContactId)).limit(1);
        const [attemptCampaign] = await db.select().from(voiceCampaigns)
          .where(eq(voiceCampaigns.id, attempt.campaignId)).limit(1);
        const attemptsCount = (queueState?.attemptsCount ?? 0) + 1;
        const retryableOutcome = outcome === "no_answer"
          || outcome === "voicemail"
          || outcome === "gatekeeper"
          || outcome === "callback"
          || outcome === "failed";
        const shouldRetry = Boolean(
          retryableOutcome
          && attemptCampaign
          && attemptsCount < attemptCampaign.maxAttemptsPerLead,
        );
        const contactStatus: typeof voiceCampaignContacts.$inferInsert.status = outcome === "do_not_call"
          ? "suppressed"
          : outcome === "meeting_booked"
            ? "converted"
            : shouldRetry
              ? "pending"
              : outcome === "wrong_number" || retryableOutcome
                ? "failed"
                : "contacted";
        const nextAttemptAt = shouldRetry && attemptCampaign
          ? new Date(Date.now() + attemptCampaign.minRetryHours * 60 * 60 * 1000)
          : null;

        await db.update(voiceCampaignContacts).set({
          status: contactStatus,
          attemptsCount,
          nextAttemptAt,
          lastAttemptAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(voiceCampaignContacts.id, attempt.campaignContactId));

        if (outcome === "do_not_call") {
          await db.insert(voiceSuppressions).values({
            teamId: attempt.teamId,
            normalizedPhone: attempt.phone,
            reason: "do_not_call",
            sourceAttemptId: attempt.id,
          }).onConflictDoNothing({
            target: [voiceSuppressions.teamId, voiceSuppressions.normalizedPhone],
          });
        }
      }

      return reply.send({ received: true, matched: true });
    },
  );

  fastify.get("/voice-sdr/calendar/google/callback", async (request, reply) => {
    const query = z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
    }).parse(request.query ?? {});
    const redirect = (result: string) => `${config.APP_URL}/settings?calendar=${encodeURIComponent(result)}`;
    if (query.error || !query.code || !query.state) return reply.redirect(redirect("denied"));

    let state: { id: string; email?: string; role?: string; teamId?: string | null; type?: string };
    try {
      state = fastify.jwt.verify(query.state) as typeof state;
    } catch {
      return reply.redirect(redirect("invalid_state"));
    }
    if (state.type !== "calendar_oauth" || !state.teamId || !state.id) {
      return reply.redirect(redirect("invalid_state"));
    }

    try {
      const tokens = await exchangeGoogleCalendarCode(googleOAuthConfig, query.code);
      const accountEmail = await getGoogleAccountEmail(tokens.accessToken);
      if (config.GOOGLE_CALENDAR_ACCOUNT
        && accountEmail !== config.GOOGLE_CALENDAR_ACCOUNT.toLowerCase()) {
        fastify.log.warn({ accountEmail }, "Tentativa de conectar conta Google diferente da agenda configurada");
        return reply.redirect(redirect("wrong_account"));
      }

      const [existing] = await db.select().from(googleCalendarConnections)
        .where(eq(googleCalendarConnections.teamId, state.teamId)).limit(1);
      // O refresh token guardado pode estar ilegivel (foi o que aconteceu apos
      // uma rotacao de segredo). Nesse caso o fallback explodia e a
      // reautorizacao - unica forma de consertar - morria no meio.
      let storedRefreshToken: string | null = null;
      if (existing) {
        try {
          storedRefreshToken = decrypt(existing.refreshToken);
        } catch {
          fastify.log.warn({ teamId: state.teamId }, "Refresh token do Calendar ilegivel; exigindo novo consentimento");
        }
      }
      const refreshToken = tokens.refreshToken ?? storedRefreshToken;
      if (!refreshToken) return reply.redirect(redirect("missing_refresh_token"));

      await db.insert(googleCalendarConnections).values({
        teamId: state.teamId,
        connectedBy: state.id,
        accountEmail,
        accessToken: encrypt(tokens.accessToken),
        refreshToken: encrypt(refreshToken),
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
        calendarId: config.GOOGLE_CALENDAR_ID,
      }).onConflictDoUpdate({
        target: googleCalendarConnections.teamId,
        set: {
          connectedBy: state.id,
          accountEmail,
          accessToken: encrypt(tokens.accessToken),
          refreshToken: encrypt(refreshToken),
          expiresAt: tokens.expiresAt,
          scope: tokens.scope,
          calendarId: config.GOOGLE_CALENDAR_ID,
          updatedAt: new Date(),
        },
      });
      return reply.redirect(redirect("connected"));
    } catch (error) {
      fastify.log.error({ err: error }, "Falha no OAuth do Google Calendar");
      return reply.redirect(redirect("error"));
    }
  });

  // Ferramenta server-side chamada pelo agente durante a conversa. Nesta fase
  // registra uma solicitação; não confirma disponibilidade sem calendário real.
  fastify.post("/voice-sdr/tools/request-meeting", async (request, reply) => {
    const authorizationValue = request.headers.authorization;
    const authorization = Array.isArray(authorizationValue) ? authorizationValue[0] : authorizationValue;
    if (!config.ELEVENLABS_TOOL_SECRET) {
      fastify.log.error("Ferramenta de agenda chamada sem ELEVENLABS_TOOL_SECRET configurado");
      return reply.code(503).send({ status: "unavailable", confirmed: false });
    }
    if (!verifyToolBearer(authorization, config.ELEVENLABS_TOOL_SECRET)) {
      return reply.code(401).send({ status: "unauthorized", confirmed: false });
    }

    const body = meetingRequestSchema.parse(request.body ?? {});
    const requestedStartAt = new Date(body.proposed_start_at);
    const timeViolation = validateVoiceMeetingTime({
      proposedStartAt: requestedStartAt,
      now: new Date(),
      timezone: body.timezone,
      latestStartHour: 17,
    });
    if (timeViolation) {
      const messages = {
        past: "O horário precisa estar no futuro.",
        outside_day_window: "A demonstração deve ser marcada para hoje ou amanhã.",
        not_full_hour: "A demonstração deve começar em uma hora cheia.",
        after_latest_hour: "O último horário permitido para iniciar a demonstração é 17h.",
      } satisfies Record<typeof timeViolation, string>;
      return reply.code(400).send({
        status: "invalid_time",
        confirmed: false,
        reason: timeViolation,
        message: messages[timeViolation],
      });
    }

    const [attempt] = await db.select().from(voiceCallAttempts)
      .where(eq(voiceCallAttempts.id, body.limo_attempt_id)).limit(1);
    const association = evaluateMeetingAttemptAssociation({
      status: attempt?.status,
      endedAt: attempt?.endedAt ?? null,
      updatedAt: attempt?.updatedAt ?? null,
      now: new Date(),
    });
    if (!attempt || association === "unknown") {
      return reply.code(404).send({
        status: "attempt_not_found",
        confirmed: false,
        message: "Não foi possível associar a solicitação a uma chamada.",
      });
    }
    if (association === "stale") {
      return reply.code(409).send({
        status: "attempt_finished",
        confirmed: false,
        message: "A chamada desta tentativa já foi encerrada há tempo demais para agendar.",
      });
    }

    const [existingMeeting] = await db.select().from(voiceMeetingRequests)
      .where(eq(voiceMeetingRequests.attemptId, attempt.id)).limit(1);
    if (existingMeeting?.status === "confirmed") {
      // O agente pode confirmar a reuniao antes de perguntar o e-mail e so
      // depois receber o endereco certo. Sem trocar o convidado, o convite fica
      // no destinatario errado e o lead nunca recebe nada.
      const newEmail = body.invitee_email;
      if (newEmail && existingMeeting.externalEventId
        && newEmail.toLowerCase() !== (existingMeeting.inviteeEmail ?? "").toLowerCase()) {
        try {
          const [calendarConnection] = await db.select().from(googleCalendarConnections)
            .where(eq(googleCalendarConnections.teamId, attempt.teamId)).limit(1);
          if (calendarConnection) {
            const accessToken = await getCalendarAccessToken(calendarConnection);
            await updateGoogleCalendarAttendee({
              accessToken,
              calendarId: calendarConnection.calendarId,
              eventId: existingMeeting.externalEventId,
              attendeeEmail: newEmail,
            });
            await db.update(voiceMeetingRequests).set({ inviteeEmail: newEmail, updatedAt: new Date() })
              .where(eq(voiceMeetingRequests.id, existingMeeting.id));
            return reply.send({
              status: "confirmed",
              confirmed: true,
              request_id: existingMeeting.id,
              meeting_url: existingMeeting.schedulingUrl,
              message: `Convite reenviado para ${newEmail}.`,
            });
          }
        } catch (error) {
          fastify.log.error({ err: error, requestId: existingMeeting.id }, "Falha ao trocar o convidado da reunião");
        }
      }
      return reply.send({
        status: "confirmed",
        confirmed: true,
        request_id: existingMeeting.id,
        meeting_url: existingMeeting.schedulingUrl,
        message: "A reunião já estava confirmada.",
      });
    }

    const [contact] = await db.select({
      email: contacts.email,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      companyName: contacts.companyName,
    })
      .from(contacts).where(eq(contacts.id, attempt.contactId)).limit(1);
    const inviteeEmail = body.invitee_email ?? contact?.email ?? null;

    const [meetingRequest] = await db.insert(voiceMeetingRequests).values({
      teamId: attempt.teamId,
      campaignId: attempt.campaignId,
      attemptId: attempt.id,
      contactId: attempt.contactId,
      requestedStartAt,
      timezone: body.timezone,
      inviteeEmail,
      status: "requested",
      schedulingUrl: null,
    }).onConflictDoUpdate({
      target: voiceMeetingRequests.attemptId,
      set: {
        requestedStartAt,
        timezone: body.timezone,
        inviteeEmail,
        status: "requested",
        updatedAt: new Date(),
      },
    }).returning();

    const [calendarConnection] = await db.select().from(googleCalendarConnections)
      .where(eq(googleCalendarConnections.teamId, attempt.teamId)).limit(1);
    if (!calendarConnection || !inviteeEmail) {
      return reply.send({
        status: inviteeEmail ? "requested" : "missing_email",
        confirmed: false,
        request_id: meetingRequest.id,
        message: inviteeEmail
          ? "Horário solicitado. Informe que a reunião ainda será confirmada."
          : "É necessário obter um e-mail válido antes de confirmar a reunião.",
      });
    }

    try {
      const accessToken = await getCalendarAccessToken(calendarConnection);
      const endAt = new Date(requestedStartAt.getTime() + config.GOOGLE_CALENDAR_MEETING_MINUTES * 60 * 1000);
      const available = await isGoogleCalendarSlotAvailable(
        accessToken,
        calendarConnection.calendarId,
        requestedStartAt,
        endAt,
        body.timezone,
      );
      if (!available) {
        await db.update(voiceMeetingRequests).set({ status: "slot_unavailable", updatedAt: new Date() })
          .where(eq(voiceMeetingRequests.id, meetingRequest.id));
        return reply.send({
          status: "slot_unavailable",
          confirmed: false,
          request_id: meetingRequest.id,
          message: "O horário não está disponível. Peça outra opção.",
        });
      }

      const event = await createGoogleCalendarMeeting({
        accessToken,
        calendarId: calendarConnection.calendarId,
        summary: `Demo - Limo app <> ${contact?.companyName || "Empresa"}`,
        description: `Reunião agendada pelo Luís durante a prospecção. Campanha: ${attempt.campaignId}.`,
        start: requestedStartAt,
        end: endAt,
        timezone: body.timezone,
        attendeeEmail: inviteeEmail,
        conferenceRequestId: attempt.id.replace(/-/g, ""),
      });
      await db.update(voiceMeetingRequests).set({
        status: "confirmed",
        externalEventId: event.eventId,
        schedulingUrl: event.meetLink ?? event.htmlLink,
        updatedAt: new Date(),
      }).where(eq(voiceMeetingRequests.id, meetingRequest.id));
      await db.update(voiceCallAttempts).set({ outcome: "meeting_booked", updatedAt: new Date() })
        .where(eq(voiceCallAttempts.id, attempt.id));
      await db.update(voiceCampaignContacts).set({ status: "converted", updatedAt: new Date() })
        .where(eq(voiceCampaignContacts.id, attempt.campaignContactId));

      const dateSpoken = new Intl.DateTimeFormat("pt-BR", {
        timeZone: body.timezone, day: "numeric", month: "long",
      }).format(requestedStartAt);
      const timeSpoken = formatVoiceTimeSpoken(requestedStartAt, body.timezone);
      const whatsappSent = await sendMeetingWhatsApp({
        campaignId: attempt.campaignId,
        phone: attempt.phone,
        firstName: contact?.firstName ?? null,
        dateSpoken,
        timeSpoken,
      });

      return reply.send({
        status: "confirmed",
        confirmed: true,
        request_id: meetingRequest.id,
        meeting_url: event.meetLink ?? event.htmlLink,
        meeting_date_spoken: dateSpoken,
        meeting_time_spoken: timeSpoken,
        whatsapp_sent: whatsappSent,
        message: whatsappSent
          ? "Reunião confirmada, convite enviado por e-mail e a mensagem de WhatsApp JÁ FOI ENVIADA para o lead. Pode dizer que mandou o oi no WhatsApp."
          : "Reunião confirmada e convite enviado por e-mail. O WhatsApp NÃO foi enviado: diga que vai mandar, nunca que mandou.",
      });
    } catch (error) {
      const calendarError = error instanceof GoogleCalendarError ? error : new Error((error as Error).message);
      fastify.log.error({ err: calendarError, requestId: meetingRequest.id }, "Falha ao confirmar reunião no Google Calendar");
      return reply.send({
        status: "requested",
        confirmed: false,
        request_id: meetingRequest.id,
        message: "Horário solicitado, mas ainda não foi possível confirmá-lo. Informe que haverá confirmação posterior.",
      });
    }
  });

  fastify.get("/voice-sdr/calendar/google/auth-url", { preHandler: [requireManager] }, async (request, reply) => {
    const teamId = teamFrom(request);
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });
    if (!googleOAuthConfig.clientId || !googleOAuthConfig.clientSecret || !googleOAuthConfig.redirectUri
      || !config.GOOGLE_CALENDAR_ACCOUNT) {
      return reply.code(503).send({ message: "OAuth do Google Calendar ainda não está configurado" });
    }
    const state = fastify.jwt.sign({
      id: request.user.id,
      email: request.user.email,
      role: request.user.role,
      teamId,
      type: "calendar_oauth",
    }, { expiresIn: "10m" });
    return {
      url: getGoogleCalendarAuthUrl(googleOAuthConfig, state, config.GOOGLE_CALENDAR_ACCOUNT),
      expectedAccount: config.GOOGLE_CALENDAR_ACCOUNT,
    };
  });

  fastify.get("/voice-sdr/calendar/status", { preHandler: [requireManager] }, async (request, reply) => {
    const teamId = teamFrom(request);
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });
    const [connection] = await db.select({
      accountEmail: googleCalendarConnections.accountEmail,
      calendarId: googleCalendarConnections.calendarId,
      expiresAt: googleCalendarConnections.expiresAt,
      updatedAt: googleCalendarConnections.updatedAt,
      refreshToken: googleCalendarConnections.refreshToken,
    }).from(googleCalendarConnections)
      .where(eq(googleCalendarConnections.teamId, teamId)).limit(1);

    // Ter a linha no banco nao basta: apos uma rotacao de ENCRYPTION_KEY o
    // token guardado deixa de abrir e o agendamento falha no meio da ligacao.
    // O indicador precisa dizer isso ANTES de alguem ligar.
    let tokenReadable = false;
    if (connection) {
      try {
        tokenReadable = Boolean(decrypt(connection.refreshToken));
      } catch {
        tokenReadable = false;
      }
    }
    const { refreshToken: _omitted, ...publicConnection } = connection ?? { refreshToken: null };

    return {
      connected: Boolean(connection) && tokenReadable,
      tokenReadable,
      needsReauthorization: Boolean(connection) && !tokenReadable,
      connection: connection ? publicConnection : null,
      oauthConfigured: Boolean(
        googleOAuthConfig.clientId && googleOAuthConfig.clientSecret
        && googleOAuthConfig.redirectUri && config.GOOGLE_CALENDAR_ACCOUNT
      ),
    };
  });

  fastify.get("/voice-sdr/status", { preHandler: [requireManager] }, async (request, reply) => {
    const bridge = await getSipBridgeHealth(
      config.SIP_BRIDGE_HEALTH_URL,
      config.SIP_BRIDGE_HEALTH_TIMEOUT_MS,
    );
    if (!teamFrom(request)) return reply.code(400).send({ message: "Usuário não pertence a um time" });
    return {
      enabled: config.VOICE_SDR_ENABLED,
      providerReady: Boolean(
        config.ELEVENLABS_API_KEY
        && config.ELEVENLABS_WEBHOOK_SECRET
        && config.ELEVENLABS_TOOL_SECRET
        && config.ELEVENLABS_AGENT_ID
        && config.ELEVENLABS_PHONE_NUMBER_ID
      ),
      readyForLiveCalls: Boolean(
        config.VOICE_SDR_ENABLED
        && config.VOICE_SDR_LIVE_CALLS
        && config.ELEVENLABS_API_KEY
        && config.ELEVENLABS_WEBHOOK_SECRET
        && config.ELEVENLABS_TOOL_SECRET
        && config.ELEVENLABS_AGENT_ID
        && config.ELEVENLABS_PHONE_NUMBER_ID
        && bridge.ready
      ),
      provider: "elevenlabs",
      configured: {
        apiKey: Boolean(config.ELEVENLABS_API_KEY),
        webhookSecret: Boolean(config.ELEVENLABS_WEBHOOK_SECRET),
        toolSecret: Boolean(config.ELEVENLABS_TOOL_SECRET),
        agent: Boolean(config.ELEVENLABS_AGENT_ID),
        phoneNumber: Boolean(config.ELEVENLABS_PHONE_NUMBER_ID),
        sipBridgeHealth: bridge.configured,
      },
      bridge,
      safety: {
        liveCallsEnabled: config.VOICE_SDR_LIVE_CALLS,
        dryRunDefault: true,
        maxConcurrency: 1,
        defaultDailyLimit: config.VOICE_SDR_DAILY_LIMIT,
      },
    };
  });

  fastify.post("/voice-sdr/campaigns", { preHandler: [requireManager] }, async (request, reply) => {
    const teamId = teamFrom(request);
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });
    const body = createCampaignSchema.parse(request.body ?? {});

    const [campaign] = await db.insert(voiceCampaigns).values({
      teamId,
      createdBy: request.user.id,
      name: body.name,
      timezone: body.timezone,
      businessHourStart: body.businessHourStart,
      businessHourEnd: body.businessHourEnd,
      dailyLimit: body.dailyLimit ?? config.VOICE_SDR_DAILY_LIMIT,
      maxAttemptsPerLead: body.maxAttemptsPerLead,
      minRetryHours: body.minRetryHours,
      providerAgentId: config.ELEVENLABS_AGENT_ID || null,
      providerPhoneNumberId: config.ELEVENLABS_PHONE_NUMBER_ID || null,
      recordingEnabled: body.recordingEnabled,
      status: "draft",
    }).returning();

    return reply.code(201).send({ campaign });
  });

  fastify.get("/voice-sdr/campaigns", { preHandler: [requireManager] }, async (request, reply) => {
    const teamId = teamFrom(request);
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });
    const campaigns = await db.select().from(voiceCampaigns)
      .where(eq(voiceCampaigns.teamId, teamId))
      .orderBy(desc(voiceCampaigns.createdAt));
    if (campaigns.length === 0) return { campaigns: [] };

    const campaignIds = campaigns.map((campaign) => campaign.id);
    const queueCounts = await db.select({
      campaignId: voiceCampaignContacts.campaignId,
      status: voiceCampaignContacts.status,
      total: count(),
    }).from(voiceCampaignContacts)
      .where(inArray(voiceCampaignContacts.campaignId, campaignIds))
      .groupBy(voiceCampaignContacts.campaignId, voiceCampaignContacts.status);
    const attemptCounts = await db.select({
      campaignId: voiceCallAttempts.campaignId,
      outcome: voiceCallAttempts.outcome,
      total: count(),
    }).from(voiceCallAttempts)
      .where(inArray(voiceCallAttempts.campaignId, campaignIds))
      .groupBy(voiceCallAttempts.campaignId, voiceCallAttempts.outcome);

    return {
      campaigns: campaigns.map((campaign) => ({
        ...campaign,
        queue: Object.fromEntries(
          queueCounts.filter((row) => row.campaignId === campaign.id)
            .map((row) => [row.status, Number(row.total)]),
        ),
        outcomes: Object.fromEntries(
          attemptCounts.filter((row) => row.campaignId === campaign.id)
            .map((row) => [row.outcome ?? "pending", Number(row.total)]),
        ),
      })),
    };
  });

  fastify.get("/voice-sdr/campaigns/:id/contacts", { preHandler: [requireManager] }, async (request, reply) => {
    const teamId = teamFrom(request);
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });
    const campaignId = z.string().uuid().parse((request.params as { id: string }).id);
    const [campaign] = await db.select({ id: voiceCampaigns.id }).from(voiceCampaigns)
      .where(and(eq(voiceCampaigns.id, campaignId), eq(voiceCampaigns.teamId, teamId))).limit(1);
    if (!campaign) return reply.code(404).send({ message: "Campanha não encontrada" });

    const queuedContacts = await db.select({
      id: voiceCampaignContacts.id,
      contactId: voiceCampaignContacts.contactId,
      status: voiceCampaignContacts.status,
      phone: voiceCampaignContacts.phoneSnapshot,
      attemptsCount: voiceCampaignContacts.attemptsCount,
      nextAttemptAt: voiceCampaignContacts.nextAttemptAt,
      lastAttemptAt: voiceCampaignContacts.lastAttemptAt,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      companyName: contacts.companyName,
      jobTitle: contacts.jobTitle,
      email: contacts.email,
    }).from(voiceCampaignContacts)
      .innerJoin(contacts, eq(contacts.id, voiceCampaignContacts.contactId))
      .where(eq(voiceCampaignContacts.campaignId, campaignId))
      .orderBy(desc(voiceCampaignContacts.createdAt));
    return { contacts: queuedContacts };
  });

  fastify.post("/voice-sdr/campaigns/:id/status", { preHandler: [requireManager] }, async (request, reply) => {
    const teamId = teamFrom(request);
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });
    const campaignId = z.string().uuid().parse((request.params as { id: string }).id);
    const body = campaignStatusSchema.parse(request.body ?? {});
    const [campaign] = await db.select().from(voiceCampaigns)
      .where(and(eq(voiceCampaigns.id, campaignId), eq(voiceCampaigns.teamId, teamId))).limit(1);
    if (!campaign) return reply.code(404).send({ message: "Campanha não encontrada" });

    if (body.status === "paused") {
      const [updated] = await db.update(voiceCampaigns).set({ status: "paused", updatedAt: new Date() })
        .where(eq(voiceCampaigns.id, campaign.id)).returning();
      return { campaign: updated };
    }

    if (!config.VOICE_SDR_ENABLED || !config.VOICE_SDR_LIVE_CALLS) {
      return reply.code(409).send({ message: "Chamadas reais estão desativadas no ambiente" });
    }
    if (!config.ELEVENLABS_API_KEY || !config.ELEVENLABS_WEBHOOK_SECRET || !config.ELEVENLABS_TOOL_SECRET
      || !config.ELEVENLABS_AGENT_ID || !config.ELEVENLABS_PHONE_NUMBER_ID) {
      return reply.code(409).send({ message: "Configuração ElevenLabs/Twilio incompleta" });
    }
    if (!body.confirmVoiceRights || !body.confirmCallingCompliance || body.confirmation?.trim() !== campaign.id) {
      return reply.code(400).send({
        message: "Confirme direitos da voz, conformidade da chamada/numeração e envie o ID da campanha em confirmation",
      });
    }

    const now = new Date();
    const [updated] = await db.update(voiceCampaigns).set({
      status: "active",
      voiceRightsConfirmedAt: now,
      complianceConfirmedAt: now,
      complianceConfirmedBy: request.user.id,
      updatedAt: now,
    }).where(eq(voiceCampaigns.id, campaign.id)).returning();
    return { campaign: updated };
  });

  fastify.post("/voice-sdr/campaigns/:id/run-next", { preHandler: [requireManager] }, async (request, reply) => {
    const teamId = teamFrom(request);
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });
    const campaignId = z.string().uuid().parse((request.params as { id: string }).id);
    const body = runNextSchema.parse(request.body ?? {});
    const [campaign] = await db.select().from(voiceCampaigns)
      .where(and(eq(voiceCampaigns.id, campaignId), eq(voiceCampaigns.teamId, teamId))).limit(1);
    if (!campaign) return reply.code(404).send({ message: "Campanha não encontrada" });

    // O modo teste só relaxa a janela de horário, e só se houver número
    // autorizado configurado. Fora isso, tudo segue igual.
    const authorizedTestPhones = parseAuthorizedTestPhones(config.VOICE_SDR_TEST_PHONES);
    if (body.testMode && authorizedTestPhones.length === 0) {
      return reply.code(409).send({
        message: "Modo teste indisponível: nenhum número autorizado em VOICE_SDR_TEST_PHONES",
      });
    }

    const preflight = await preflightCampaign(campaign, { ignoreTimeWindow: body.testMode });
    if (!preflight.candidate) {
      return reply.code(409).send({
        message: `Nenhum lead elegível: ${preflight.blockers.join(", ")}`,
        eligible: false,
        callsLast24Hours: preflight.callsToday,
        blockers: preflight.blockers,
        testMode: body.testMode,
      });
    }
    const candidate = preflight.candidate;
    if (body.testMode && !isAuthorizedTestPhone(candidate.phone, authorizedTestPhones)) {
      return reply.code(403).send({
        message: "Modo teste só liga para número autorizado. O próximo lead da fila não está na lista.",
        eligible: false,
        contactPhoneEnding: candidate.phone.slice(-4),
      });
    }
    const preview = {
      eligible: true,
      callsLast24Hours: preflight.callsToday,
      contact: {
        id: candidate.contactId,
        name: [candidate.firstName, candidate.lastName].filter(Boolean).join(" "),
        companyName: candidate.companyName,
        phoneEnding: candidate.phone.slice(-4),
      },
    };
    if (body.dryRun) return { ...preview, dryRun: true, callCreated: false, testMode: body.testMode };

    if (!config.VOICE_SDR_ENABLED || !config.VOICE_SDR_LIVE_CALLS) {
      return reply.code(409).send({ message: "Chamadas reais estão desativadas no ambiente" });
    }
    if (campaign.status !== "active" || !campaign.voiceRightsConfirmedAt || !campaign.complianceConfirmedAt) {
      return reply.code(409).send({ message: "Campanha ainda não foi ativada com as confirmações obrigatórias" });
    }
    if (body.confirmation?.trim() !== campaign.id) {
      return reply.code(400).send({ message: "Envie o ID da campanha em confirmation para realizar a chamada" });
    }

    const bridge = await getSipBridgeHealth(
      config.SIP_BRIDGE_HEALTH_URL,
      config.SIP_BRIDGE_HEALTH_TIMEOUT_MS,
    );
    if (!bridge.ready) {
      return reply.code(503).send({
        message: "Ponte SIP indisponível; nenhuma chamada foi enviada e a tentativa não foi consumida",
        bridge,
      });
    }

    const [claimed] = await db.update(voiceCampaignContacts).set({ status: "queued", updatedAt: new Date() })
      .where(and(
        eq(voiceCampaignContacts.id, candidate.queueId),
        eq(voiceCampaignContacts.status, "pending"),
      )).returning();
    if (!claimed) return reply.code(409).send({ message: "Contato já foi reservado por outra execução" });

    const [attempt] = await db.insert(voiceCallAttempts).values({
      teamId,
      campaignId: campaign.id,
      campaignContactId: candidate.queueId,
      contactId: candidate.contactId,
      phone: candidate.phone,
      status: "queued",
    }).returning();

    try {
      const dateContext = getVoiceDateContext(new Date(), campaign.timezone);
      const speechContext = getVoiceDateSpeechContext(new Date(), campaign.timezone);
      const provider = await startElevenLabsSipCall({
        apiKey: config.ELEVENLABS_API_KEY,
        agentId: campaign.providerAgentId || config.ELEVENLABS_AGENT_ID,
        agentPhoneNumberId: campaign.providerPhoneNumberId || config.ELEVENLABS_PHONE_NUMBER_ID,
        toNumber: candidate.phone,
        attemptId: attempt.id,
        contactId: candidate.contactId,
        recordingEnabled: campaign.recordingEnabled,
        dynamicVariables: {
          lead_name: [candidate.firstName, candidate.lastName].filter(Boolean).join(" "),
          // Ninguem chama o lead de "Andre Teste Voz" no telefone. O nome
          // completo serve para o registro; na fala o agente usa so o primeiro.
          lead_first_name: (candidate.firstName ?? "").trim().split(/\s+/)[0] ?? "",
          company_name: candidate.companyName ?? "",
          job_title: candidate.jobTitle ?? "",
          today_date: dateContext.todayDate,
          tomorrow_date: dateContext.tomorrowDate,
          today_date_spoken: speechContext.todayDateSpoken,
          tomorrow_date_spoken: speechContext.tomorrowDateSpoken,
          timezone: dateContext.timezone,
          limo_campaign_id: campaign.id,
        },
      });
      if (!provider.success || !provider.conversationId) {
        throw new VoiceProviderError(provider.message ?? "Provedor não iniciou a chamada", null, false);
      }

      const [updatedAttempt] = await db.update(voiceCallAttempts).set({
        status: "dialing",
        providerConversationId: provider.conversationId,
        startedAt: new Date(),
        providerData: { sipCallId: provider.callId, message: provider.message, testMode: body.testMode },
        updatedAt: new Date(),
      }).where(eq(voiceCallAttempts.id, attempt.id)).returning();
      return reply.code(202).send({ ...preview, dryRun: false, testMode: body.testMode, callCreated: true, attempt: updatedAttempt });
    } catch (error) {
      const providerError = error instanceof VoiceProviderError
        ? error
        : new VoiceProviderError((error as Error).message, null, false);
      const attemptsCount = candidate.attemptsCount + 1;
      const retryAt = new Date(Date.now() + campaign.minRetryHours * 60 * 60 * 1000);
      await db.update(voiceCallAttempts).set({
        status: "failed",
        outcome: "failed",
        endedAt: new Date(),
        errorMessage: providerError.message,
        providerData: { statusCode: providerError.statusCode, retryable: providerError.retryable },
        updatedAt: new Date(),
      }).where(eq(voiceCallAttempts.id, attempt.id));
      await db.update(voiceCampaignContacts).set({
        status: attemptsCount >= campaign.maxAttemptsPerLead ? "failed" : "pending",
        attemptsCount,
        nextAttemptAt: attemptsCount >= campaign.maxAttemptsPerLead ? null : retryAt,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(voiceCampaignContacts.id, candidate.queueId));
      fastify.log.error({ err: providerError, attemptId: attempt.id }, "Falha ao iniciar chamada de voz");
      return reply.code(502).send({ message: "Falha ao iniciar chamada no provedor", retryable: providerError.retryable });
    }
  });

  fastify.get("/voice-sdr/campaigns/:id/attempts", { preHandler: [requireManager] }, async (request, reply) => {
    const teamId = teamFrom(request);
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });
    const campaignId = z.string().uuid().parse((request.params as { id: string }).id);
    const attempts = await db.select().from(voiceCallAttempts)
      .where(and(eq(voiceCallAttempts.teamId, teamId), eq(voiceCallAttempts.campaignId, campaignId)))
      .orderBy(desc(voiceCallAttempts.createdAt));
    return { attempts };
  });

  fastify.post("/voice-sdr/campaigns/:id/contacts", { preHandler: [requireManager] }, async (request, reply) => {
    const teamId = teamFrom(request);
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });
    const campaignId = z.string().uuid().parse((request.params as { id: string }).id);
    const { contactIds } = addContactsSchema.parse(request.body ?? {});

    const [campaign] = await db.select().from(voiceCampaigns)
      .where(and(eq(voiceCampaigns.id, campaignId), eq(voiceCampaigns.teamId, teamId))).limit(1);
    if (!campaign) return reply.code(404).send({ message: "Campanha não encontrada" });
    if (campaign.status !== "draft" && campaign.status !== "paused") {
      return reply.code(409).send({ message: "A campanha não aceita novos contatos neste estado" });
    }

    const teamContacts = await db.select({ id: contacts.id, phone: contacts.phone }).from(contacts)
      .where(and(eq(contacts.teamId, teamId), inArray(contacts.id, contactIds)));
    const suppressedRows = await db.select({ phone: voiceSuppressions.normalizedPhone })
      .from(voiceSuppressions).where(eq(voiceSuppressions.teamId, teamId));
    const suppressed = new Set(suppressedRows.map((row) => row.phone));

    const eligible: { campaignId: string; contactId: string; phoneSnapshot: string }[] = [];
    let invalidPhone = 0;
    let suppressedCount = 0;
    for (const contact of teamContacts) {
      const phone = contact.phone ? normalizeBrazilianPhone(contact.phone) : null;
      if (!phone) {
        invalidPhone += 1;
        continue;
      }
      if (suppressed.has(phone)) {
        suppressedCount += 1;
        continue;
      }
      eligible.push({ campaignId, contactId: contact.id, phoneSnapshot: phone });
    }

    const inserted = eligible.length > 0
      ? await db.insert(voiceCampaignContacts).values(eligible).onConflictDoNothing({
          target: [voiceCampaignContacts.campaignId, voiceCampaignContacts.contactId],
        }).returning({ id: voiceCampaignContacts.id })
      : [];

    return reply.send({
      added: inserted.length,
      skipped: {
        notFoundOrOtherTeam: contactIds.length - teamContacts.length,
        invalidPhone,
        suppressed: suppressedCount,
        duplicate: eligible.length - inserted.length,
      },
    });
  });

  fastify.get("/voice-sdr/suppressions", { preHandler: [requireManager] }, async (request, reply) => {
    const teamId = teamFrom(request);
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });
    const suppressions = await db.select().from(voiceSuppressions)
      .where(eq(voiceSuppressions.teamId, teamId))
      .orderBy(desc(voiceSuppressions.createdAt));
    return { suppressions };
  });

  fastify.get("/voice-sdr/meeting-requests", { preHandler: [requireManager] }, async (request, reply) => {
    const teamId = teamFrom(request);
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });
    const meetingRequests = await db.select({
      id: voiceMeetingRequests.id,
      campaignId: voiceMeetingRequests.campaignId,
      attemptId: voiceMeetingRequests.attemptId,
      contactId: voiceMeetingRequests.contactId,
      requestedStartAt: voiceMeetingRequests.requestedStartAt,
      timezone: voiceMeetingRequests.timezone,
      inviteeEmail: voiceMeetingRequests.inviteeEmail,
      status: voiceMeetingRequests.status,
      externalEventId: voiceMeetingRequests.externalEventId,
      schedulingUrl: voiceMeetingRequests.schedulingUrl,
      createdAt: voiceMeetingRequests.createdAt,
      updatedAt: voiceMeetingRequests.updatedAt,
      campaignName: voiceCampaigns.name,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      companyName: contacts.companyName,
    }).from(voiceMeetingRequests)
      .innerJoin(voiceCampaigns, eq(voiceCampaigns.id, voiceMeetingRequests.campaignId))
      .innerJoin(contacts, eq(contacts.id, voiceMeetingRequests.contactId))
      .where(eq(voiceMeetingRequests.teamId, teamId))
      .orderBy(desc(voiceMeetingRequests.createdAt));
    return { meetingRequests };
  });

  fastify.post("/voice-sdr/suppressions", { preHandler: [requireManager] }, async (request, reply) => {
    const teamId = teamFrom(request);
    if (!teamId) return reply.code(400).send({ message: "Usuário não pertence a um time" });
    const body = suppressionSchema.parse(request.body ?? {});
    const normalizedPhone = normalizeBrazilianPhone(body.phone);
    if (!normalizedPhone) return reply.code(400).send({ message: "Telefone brasileiro inválido" });

    const [suppression] = await db.insert(voiceSuppressions).values({
      teamId,
      normalizedPhone,
      reason: body.reason,
      createdBy: request.user.id,
    }).onConflictDoNothing({
      target: [voiceSuppressions.teamId, voiceSuppressions.normalizedPhone],
    }).returning();
    return reply.code(suppression ? 201 : 200).send({ suppression: suppression ?? null, alreadySuppressed: !suppression });
  });
}
