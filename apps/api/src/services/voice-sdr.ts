import { createHmac, timingSafeEqual } from "node:crypto";

export const VOICE_OUTCOMES = [
  "no_answer",
  "voicemail",
  "gatekeeper",
  "not_interested",
  "callback",
  "interested",
  "meeting_booked",
  "do_not_call",
  "wrong_number",
  "failed",
] as const;

export type VoiceOutcome = (typeof VOICE_OUTCOMES)[number];

export type VoiceEligibilityReason =
  | "outside_business_hours"
  | "weekend"
  | "daily_limit_reached"
  | "max_attempts_reached"
  | "retry_window"
  | "suppressed"
  | "invalid_phone";

export interface VoiceEligibilityInput {
  now: Date;
  timezone: string;
  businessHourStart: number;
  businessHourEnd: number;
  dailyLimit: number;
  callsToday: number;
  attemptsCount: number;
  maxAttemptsPerLead: number;
  nextAttemptAt: Date | null;
  phone: string;
  suppressed: boolean;
  /**
   * Modo teste: ignora SOMENTE a janela de horario (fim de semana e horario
   * comercial), para validar a ligacao de madrugada em numero proprio. Todas as
   * outras travas continuam valendo, e quem chama ainda precisa checar a lista
   * de numeros autorizados com isAuthorizedTestPhone.
   */
  ignoreTimeWindow?: boolean;
}

export interface ElevenLabsOutboundInput {
  apiKey: string;
  agentId: string;
  agentPhoneNumberId: string;
  toNumber: string;
  attemptId: string;
  contactId: string;
  recordingEnabled: boolean;
  dynamicVariables: Record<string, string | number | boolean>;
}

export interface ElevenLabsOutboundResult {
  success: boolean;
  message: string | null;
  conversationId: string | null;
  callId: string | null;
}

export interface SipBridgeHealth {
  configured: boolean;
  ready: boolean;
  status: "registered" | "offline" | "unreachable" | "unconfigured";
  registration: string | null;
  activeChannels: number | null;
  checkedAt: string | null;
  error: string | null;
}

export interface VoiceDateContext {
  todayDate: string;
  tomorrowDate: string;
  timezone: string;
}

export interface VoiceDateSpeechContext {
  todayDateSpoken: string;
  tomorrowDateSpoken: string;
}

export type VoiceMeetingTimeViolation =
  | "past"
  | "outside_day_window"
  | "not_full_hour"
  | "after_latest_hour";

export class VoiceProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "VoiceProviderError";
  }
}

export async function getSipBridgeHealth(
  healthUrl: string,
  timeoutMs = 3_000,
  fetchImpl: typeof fetch = fetch,
): Promise<SipBridgeHealth> {
  if (!healthUrl) {
    return {
      configured: false,
      ready: false,
      status: "unconfigured",
      registration: null,
      activeChannels: null,
      checkedAt: null,
      error: "health_url_unconfigured",
    };
  }

  try {
    const response = await fetchImpl(healthUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const registration = typeof payload.registration === "string" ? payload.registration : null;
    const activeChannels = typeof payload.active_channels === "number" ? payload.active_channels : null;
    const checkedAt = typeof payload.checked_at === "string" ? payload.checked_at : null;
    const ready = response.ok && payload.ok === true && registration === "Registered";
    return {
      configured: true,
      ready,
      status: ready ? "registered" : "offline",
      registration,
      activeChannels,
      checkedAt,
      error: ready ? null : "registration_offline",
    };
  } catch {
    return {
      configured: true,
      ready: false,
      status: "unreachable",
      registration: null,
      activeChannels: null,
      checkedAt: null,
      error: "health_check_failed",
    };
  }
}

export function normalizeBrazilianPhone(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!digits.startsWith("55") || (digits.length !== 12 && digits.length !== 13)) return null;
  return `+${digits}`;
}

function localDateParts(date: Date, timezone: string): { weekday: string; hour: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const weekday = parts.find((part) => part.type === "weekday")?.value;
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    return weekday && Number.isInteger(hour) ? { weekday, hour } : null;
  } catch {
    return null;
  }
}

export function getVoiceDateContext(now: Date, timezone: string): VoiceDateContext {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (![year, month, day].every(Number.isInteger)) {
    throw new RangeError(`Não foi possível calcular a data no fuso ${timezone}`);
  }
  const todayDate = [year, month, day].map((value, index) =>
    index === 0 ? String(value).padStart(4, "0") : String(value).padStart(2, "0")
  ).join("-");
  const tomorrowDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return { todayDate, tomorrowDate, timezone };
}

/**
 * Versao falada das mesmas datas que o agente usa para agendar. Deriva de
 * getVoiceDateContext de proposito: se o Luis fala "16 de setembro", a agenda
 * precisa receber exatamente 2026-09-16.
 */
export function getVoiceDateSpeechContext(now: Date, timezone: string): VoiceDateSpeechContext {
  const { todayDate, tomorrowDate } = getVoiceDateContext(now, timezone);
  return {
    todayDateSpoken: formatIsoDateSpoken(todayDate),
    tomorrowDateSpoken: formatIsoDateSpoken(tomorrowDate),
  };
}

function formatIsoDateSpoken(isoDate: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

/** "14:00" vira "14h" e "14:30" continua "14:30" — o agente le hora, nao relogio. */
export function formatVoiceTimeSpoken(date: Date, timezone: string): string {
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return formatted.endsWith(":00") ? `${Number(formatted.slice(0, 2))}h` : formatted;
}

export type VoiceAttemptAssociation = "live" | "recently_finished" | "stale" | "unknown";

/**
 * Decide se uma solicitacao de reuniao pode ser associada a uma tentativa.
 *
 * A regra antiga exigia a tentativa viva (dialing/in_progress). Na ligacao de
 * 14/09 isso derrubou o agendamento duas vezes com attempt_not_found: o lead
 * tinha dito sim e passado o e-mail, e o Luis precisou improvisar. O webhook de
 * pos-chamada pode finalizar a tentativa antes de a ferramenta chegar, entao uma
 * tentativa encerrada ha poucos minutos ainda vale para agendar.
 */
export function evaluateMeetingAttemptAssociation(input: {
  status: string | null | undefined;
  endedAt: Date | null | undefined;
  updatedAt: Date | null | undefined;
  now: Date;
  graceMinutes?: number;
}): VoiceAttemptAssociation {
  if (!input.status) return "unknown";
  if (input.status === "queued" || input.status === "dialing" || input.status === "in_progress") {
    return "live";
  }
  const finishedAt = input.endedAt ?? input.updatedAt;
  if (!finishedAt) return "stale";
  const graceMs = (input.graceMinutes ?? 30) * 60 * 1000;
  const elapsed = input.now.getTime() - finishedAt.getTime();
  return elapsed >= 0 && elapsed <= graceMs ? "recently_finished" : "stale";
}

/**
 * O provedor classifica o resultado pelo que o agente ACHA que aconteceu. Em
 * 14/09 a tentativa foi marcada como meeting_booked sem nenhuma reuniao criada,
 * e o painel passou a exibir "1 reuniao marcada" que nunca existiu. Reuniao so
 * conta quando a ferramenta confirmou de verdade.
 */
export function reconcileVoiceOutcome<T extends string | null | undefined>(
  outcome: T,
  hasConfirmedMeeting: boolean,
): T | "interested" {
  return outcome === "meeting_booked" && !hasConfirmedMeeting ? "interested" : outcome;
}

export function validateVoiceMeetingTime(input: {
  proposedStartAt: Date;
  now: Date;
  timezone: string;
  latestStartHour?: number;
}): VoiceMeetingTimeViolation | null {
  if (input.proposedStartAt.getTime() <= input.now.getTime()) return "past";

  const currentDates = getVoiceDateContext(input.now, input.timezone);
  const proposedDate = getVoiceDateContext(input.proposedStartAt, input.timezone).todayDate;
  if (proposedDate !== currentDates.todayDate && proposedDate !== currentDates.tomorrowDate) {
    return "outside_day_window";
  }

  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: input.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(input.proposedStartAt);
  const hour = Number(timeParts.find((part) => part.type === "hour")?.value);
  const minute = Number(timeParts.find((part) => part.type === "minute")?.value);
  if (minute !== 0 || input.proposedStartAt.getUTCSeconds() !== 0 || input.proposedStartAt.getUTCMilliseconds() !== 0) {
    return "not_full_hour";
  }
  if (hour > (input.latestStartHour ?? 17)) return "after_latest_hour";
  return null;
}

/**
 * Numeros que podem receber ligacao em modo teste, vindos de
 * VOICE_SDR_TEST_PHONES (separados por virgula). Sem essa lista o modo teste
 * nao disca nada: e o que impede um "teste" de virar ligacao de madrugada para
 * lead real.
 */
export function parseAuthorizedTestPhones(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(",")
    .map((entry) => normalizeBrazilianPhone(entry))
    .filter((phone): phone is string => Boolean(phone));
}

export function isAuthorizedTestPhone(phone: string, authorized: string[]): boolean {
  const normalized = normalizeBrazilianPhone(phone);
  return Boolean(normalized) && authorized.includes(normalized!);
}

export function evaluateVoiceEligibility(input: VoiceEligibilityInput): VoiceEligibilityReason[] {
  const reasons: VoiceEligibilityReason[] = [];
  const local = localDateParts(input.now, input.timezone);
  if (!input.ignoreTimeWindow) {
    if (!local || local.weekday === "Sat" || local.weekday === "Sun") reasons.push("weekend");
    if (!local || local.hour < input.businessHourStart || local.hour >= input.businessHourEnd) {
      reasons.push("outside_business_hours");
    }
  }
  if (input.callsToday >= input.dailyLimit) reasons.push("daily_limit_reached");
  if (input.attemptsCount >= input.maxAttemptsPerLead) reasons.push("max_attempts_reached");
  if (input.nextAttemptAt && input.nextAttemptAt > input.now) reasons.push("retry_window");
  if (input.suppressed) reasons.push("suppressed");
  if (!normalizeBrazilianPhone(input.phone)) reasons.push("invalid_phone");
  return reasons;
}

export async function startElevenLabsSipCall(
  input: ElevenLabsOutboundInput,
  fetchImpl: typeof fetch = fetch,
): Promise<ElevenLabsOutboundResult> {
  if (!input.apiKey || !input.agentId || !input.agentPhoneNumberId) {
    throw new VoiceProviderError("Credenciais do provedor incompletas", null, false);
  }
  const toNumber = normalizeBrazilianPhone(input.toNumber);
  if (!toNumber) throw new VoiceProviderError("Telefone de destino inválido", null, false);

  let response: Response;
  try {
    response = await fetchImpl("https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call", {
      method: "POST",
      headers: { "content-type": "application/json", "xi-api-key": input.apiKey },
      body: JSON.stringify({
        agent_id: input.agentId,
        agent_phone_number_id: input.agentPhoneNumberId,
        to_number: toNumber,
        conversation_initiation_client_data: {
          type: "conversation_initiation_client_data",
          user_id: input.contactId,
          dynamic_variables: {
            ...input.dynamicVariables,
            limo_attempt_id: input.attemptId,
            limo_contact_id: input.contactId,
          },
        },
      }),
      // 15s nao bastava: a ElevenLabs leva mais tempo para montar a chamada SIP e
      // o Limo desistia enquanto o telefone ja estava tocando, marcando como
      // falha uma ligacao que aconteceu de verdade.
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    throw new VoiceProviderError(`Falha de rede ao iniciar chamada: ${(error as Error).message}`, null, true);
  }

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.detail === "string"
      ? payload.detail
      : typeof payload.message === "string" ? payload.message : `ElevenLabs respondeu HTTP ${response.status}`;
    throw new VoiceProviderError(message, response.status, response.status === 429 || response.status >= 500);
  }

  return {
    success: payload.success === true,
    message: typeof payload.message === "string" ? payload.message : null,
    conversationId: typeof payload.conversation_id === "string" ? payload.conversation_id : null,
    callId: typeof payload.sip_call_id === "string" ? payload.sip_call_id : null,
  };
}

export function verifyElevenLabsSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): boolean {
  if (!signatureHeader || !secret) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  );
  const timestamp = Number(parts.t);
  const supplied = parts.v0;
  if (!Number.isFinite(timestamp) || !supplied || Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function verifyToolBearer(authorizationHeader: string | undefined, secret: string): boolean {
  if (!authorizationHeader?.startsWith("Bearer ") || !secret) return false;
  const supplied = Buffer.from(authorizationHeader.slice(7), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function valueAt(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function unwrapCollectedValue(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in value) {
    return (value as { value?: unknown }).value;
  }
  return value;
}

export function extractAttemptId(payload: unknown): string | null {
  const candidates = [
    valueAt(payload, ["data", "conversation_initiation_client_data", "dynamic_variables", "limo_attempt_id"]),
    valueAt(payload, ["data", "metadata", "limo_attempt_id"]),
    valueAt(payload, ["data", "limo_attempt_id"]),
  ];
  const found = candidates.find((value) => typeof value === "string" && value.length > 0);
  return typeof found === "string" ? found : null;
}

export function extractVoiceOutcome(payload: unknown): VoiceOutcome | null {
  const candidates = [
    valueAt(payload, ["data", "analysis", "data_collection_results", "outcome"]),
    valueAt(payload, ["data", "analysis", "data_collection_results", "call_outcome"]),
    valueAt(payload, ["data", "analysis", "outcome"]),
  ].map(unwrapCollectedValue);

  const found = candidates.find((value): value is VoiceOutcome =>
    typeof value === "string" && (VOICE_OUTCOMES as readonly string[]).includes(value),
  );
  return found ?? null;
}
