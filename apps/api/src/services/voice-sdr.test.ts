import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
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
  verifyToolBearer,
  verifyElevenLabsSignature,
} from "./voice-sdr.js";
import { VOICE_SDR_SYSTEM_PROMPT } from "../prompts/voice-sdr.js";

test("normaliza telefone brasileiro para E.164", () => {
  assert.equal(normalizeBrazilianPhone("(11) 99876-5432"), "+5511998765432");
  assert.equal(normalizeBrazilianPhone("+55 11 99876-5432"), "+5511998765432");
  assert.equal(normalizeBrazilianPhone("123"), null);
});

test("confirma ponte SIP somente quando a Vono esta registrada", async () => {
  const healthyFetch = (async () => new Response(JSON.stringify({
    ok: true,
    registration: "Registered",
    active_channels: 2,
    checked_at: "2026-09-14T16:30:00+00:00",
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  const health = await getSipBridgeHealth("http://bridge.test/health", 1_000, healthyFetch);
  assert.equal(health.ready, true);
  assert.equal(health.status, "registered");
  assert.equal(health.activeChannels, 2);
});

test("bloqueia ponte SIP offline ou inacessivel", async () => {
  const offlineFetch = (async () => new Response(JSON.stringify({
    ok: false,
    registration: "Offline",
    active_channels: 0,
  }), { status: 503, headers: { "content-type": "application/json" } })) as typeof fetch;
  const offline = await getSipBridgeHealth("http://bridge.test/health", 1_000, offlineFetch);
  assert.equal(offline.ready, false);
  assert.equal(offline.status, "offline");

  const unreachableFetch = (async () => { throw new Error("timeout"); }) as typeof fetch;
  const unreachable = await getSipBridgeHealth("http://bridge.test/health", 1_000, unreachableFetch);
  assert.equal(unreachable.ready, false);
  assert.equal(unreachable.status, "unreachable");
});

test("valida assinatura do webhook e rejeita replay antigo", () => {
  const body = JSON.stringify({ type: "post_call_transcription" });
  const secret = "segredo-de-teste";
  const timestamp = 1_700_000_000;
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const signature = `t=${timestamp},v0=${digest}`;

  assert.equal(verifyElevenLabsSignature(body, signature, secret, timestamp), true);
  assert.equal(verifyElevenLabsSignature(`${body}x`, signature, secret, timestamp), false);
  assert.equal(verifyElevenLabsSignature(body, signature, secret, timestamp + 301), false);
});

test("valida segredo Bearer da ferramenta de agenda", () => {
  assert.equal(verifyToolBearer("Bearer segredo", "segredo"), true);
  assert.equal(verifyToolBearer("Bearer errado", "segredo"), false);
  assert.equal(verifyToolBearer(undefined, "segredo"), false);
});

test("extrai id interno e resultado coletado pelo agente", () => {
  const payload = {
    data: {
      conversation_initiation_client_data: { dynamic_variables: { limo_attempt_id: "attempt-1" } },
      analysis: { data_collection_results: { outcome: { value: "meeting_booked" } } },
    },
  };
  assert.equal(extractAttemptId(payload), "attempt-1");
  assert.equal(extractVoiceOutcome(payload), "meeting_booked");
});

test("bloqueia chamada fora das regras do piloto", () => {
  const reasons = evaluateVoiceEligibility({
    now: new Date("2026-09-12T15:00:00Z"), // sábado
    timezone: "America/Sao_Paulo",
    businessHourStart: 9,
    businessHourEnd: 18,
    dailyLimit: 10,
    callsToday: 10,
    attemptsCount: 2,
    maxAttemptsPerLead: 2,
    nextAttemptAt: new Date("2026-09-13T15:00:00Z"),
    phone: "123",
    suppressed: true,
  });
  assert.deepEqual(reasons, [
    "weekend",
    "daily_limit_reached",
    "max_attempts_reached",
    "retry_window",
    "suppressed",
    "invalid_phone",
  ]);
});

test("fornece hoje e amanhã no fuso da campanha para a agenda", () => {
  assert.deepEqual(
    getVoiceDateContext(new Date("2026-09-12T01:30:00Z"), "America/Sao_Paulo"),
    {
      todayDate: "2026-09-11",
      tomorrowDate: "2026-09-12",
      timezone: "America/Sao_Paulo",
    },
  );
});

test("data falada acompanha exatamente a data usada na agenda", () => {
  const now = new Date("2026-09-12T01:30:00Z"); // 11/09 22:30 em São Paulo
  const context = getVoiceDateContext(now, "America/Sao_Paulo");
  const spoken = getVoiceDateSpeechContext(now, "America/Sao_Paulo");

  assert.equal(context.todayDate, "2026-09-11");
  assert.equal(spoken.todayDateSpoken, "11 de setembro");
  assert.equal(context.tomorrowDate, "2026-09-12");
  assert.equal(spoken.tomorrowDateSpoken, "12 de setembro");
});

test("data falada atravessa a virada do mês", () => {
  const spoken = getVoiceDateSpeechContext(new Date("2026-09-30T18:00:00Z"), "America/Sao_Paulo");
  assert.equal(spoken.todayDateSpoken, "30 de setembro");
  assert.equal(spoken.tomorrowDateSpoken, "1 de outubro");
});

test("hora cheia é falada como 14h e meia hora mantém os minutos", () => {
  assert.equal(formatVoiceTimeSpoken(new Date("2026-09-16T14:00:00-03:00"), "America/Sao_Paulo"), "14h");
  assert.equal(formatVoiceTimeSpoken(new Date("2026-09-16T09:00:00-03:00"), "America/Sao_Paulo"), "9h");
  assert.equal(formatVoiceTimeSpoken(new Date("2026-09-16T14:30:00-03:00"), "America/Sao_Paulo"), "14:30");
});

test("agenda demo somente hoje ou amanhã, em hora cheia e até 17h", () => {
  const now = new Date("2026-09-11T13:10:00-03:00");
  const validate = (value: string) => validateVoiceMeetingTime({
    proposedStartAt: new Date(value),
    now,
    timezone: "America/Sao_Paulo",
  });

  assert.equal(validate("2026-09-11T14:00:00-03:00"), null);
  assert.equal(validate("2026-09-12T17:00:00-03:00"), null);
  assert.equal(validate("2026-09-11T12:00:00-03:00"), "past");
  assert.equal(validate("2026-09-13T14:00:00-03:00"), "outside_day_window");
  assert.equal(validate("2026-09-11T16:30:00-03:00"), "not_full_hour");
  assert.equal(validate("2026-09-11T18:00:00-03:00"), "after_latest_hour");
});

test("modo teste ignora só a janela de horário, nunca as outras travas", () => {
  const base = {
    now: new Date("2026-09-16T02:30:00-03:00"), // madrugada de quarta
    timezone: "America/Sao_Paulo",
    businessHourStart: 9,
    businessHourEnd: 18,
    dailyLimit: 10,
    callsToday: 0,
    attemptsCount: 0,
    maxAttemptsPerLead: 2,
    nextAttemptAt: null,
    phone: "+5531999990000",
    suppressed: false,
  };

  assert.deepEqual(evaluateVoiceEligibility(base), ["outside_business_hours"]);
  assert.deepEqual(evaluateVoiceEligibility({ ...base, ignoreTimeWindow: true }), []);

  // Fim de semana também cai no modo teste...
  const weekend = { ...base, now: new Date("2026-09-19T02:30:00-03:00") }; // sábado
  assert.deepEqual(evaluateVoiceEligibility({ ...weekend, ignoreTimeWindow: true }), []);

  // ...mas supressão, limite, tentativas e telefone inválido continuam bloqueando.
  assert.deepEqual(evaluateVoiceEligibility({ ...base, ignoreTimeWindow: true, suppressed: true }), ["suppressed"]);
  assert.deepEqual(evaluateVoiceEligibility({ ...base, ignoreTimeWindow: true, callsToday: 10 }), ["daily_limit_reached"]);
  assert.deepEqual(evaluateVoiceEligibility({ ...base, ignoreTimeWindow: true, attemptsCount: 2 }), ["max_attempts_reached"]);
  assert.deepEqual(evaluateVoiceEligibility({ ...base, ignoreTimeWindow: true, phone: "123" }), ["invalid_phone"]);
  assert.deepEqual(
    evaluateVoiceEligibility({ ...base, ignoreTimeWindow: true, nextAttemptAt: new Date("2026-09-16T10:00:00-03:00") }),
    ["retry_window"],
  );
});

test("modo teste só aceita número da lista autorizada", () => {
  const authorized = parseAuthorizedTestPhones(" (31) 99999-0000 , +5511999998888 , lixo ");
  assert.deepEqual(authorized, ["+5531999990000", "+5511999998888"]);

  assert.equal(isAuthorizedTestPhone("+5531999990000", authorized), true);
  assert.equal(isAuthorizedTestPhone("31 99999-0000", authorized), true, "formato diferente, mesmo número");
  assert.equal(isAuthorizedTestPhone("+5531988887777", authorized), false);
  assert.equal(isAuthorizedTestPhone("+5531999990000", []), false, "sem lista, nada é autorizado");
});

test("agendamento aceita tentativa viva e tentativa recém-encerrada", () => {
  const now = new Date("2026-09-16T14:00:00-03:00");
  const associate = (status: string | null, endedAt: Date | null) =>
    evaluateMeetingAttemptAssociation({ status, endedAt, updatedAt: endedAt, now });

  // Durante a ligação.
  assert.equal(associate("dialing", null), "live");
  assert.equal(associate("in_progress", null), "live");
  assert.equal(associate("queued", null), "live");

  // O webhook de pós-chamada pode finalizar a tentativa antes de a ferramenta
  // chegar; nesse caso o agendamento ainda vale.
  assert.equal(associate("completed", new Date("2026-09-16T13:58:00-03:00")), "recently_finished");
  assert.equal(associate("failed", new Date("2026-09-16T13:40:00-03:00")), "recently_finished");

  // Tentativa antiga não agenda nada.
  assert.equal(associate("completed", new Date("2026-09-16T12:00:00-03:00")), "stale");
  assert.equal(associate("completed", null), "stale");

  // Tentativa inexistente.
  assert.equal(associate(null, null), "unknown");
});

test("reunião só conta como marcada quando a ferramenta confirmou", () => {
  assert.equal(reconcileVoiceOutcome("meeting_booked", false), "interested");
  assert.equal(reconcileVoiceOutcome("meeting_booked", true), "meeting_booked");
  assert.equal(reconcileVoiceOutcome("not_interested", false), "not_interested");
  assert.equal(reconcileVoiceOutcome(null, false), null);
});

test("prompt publicado mantem identificacao, cadencia e regras da agenda", () => {
  const prompt = VOICE_SDR_SYSTEM_PROMPT;

  // Identidade: time comercial, nunca assistente virtual ou IA.
  assert.match(prompt, /aqui é o Luís, do time comercial do Limo/i);
  assert.doesNotMatch(prompt, /assistente virtual/i);
  assert.match(prompt, /Não mencione IA, automação/i);

  // Cadência: uma pergunta por vez e espera real pela resposta.
  assert.match(prompt, /Faça uma pergunta por vez/i);
  assert.match(prompt, /espere a resposta/i);

  // Cargo exato da vaga, nunca o rótulo genérico.
  assert.match(prompt, /Nunca diga “BDR\/SDR”/);
  assert.match(prompt, /\{\{job_title\}\}/);

  // Regras que a ferramenta de agenda valida de fato: hoje ou amanhã,
  // hora cheia, começando no máximo às 17h, demo de 45 minutos.
  assert.match(prompt, /REGRAS FIXAS DA AGENDA/);
  assert.match(prompt, /dura 45 minutos/);
  assert.match(prompt, /hora cheia/);
  assert.match(prompt, /cinco da tarde/);
  assert.match(prompt, /somente hoje \(\{\{today_date_spoken\}\}\) ou amanhã \(\{\{tomorrow_date_spoken\}\}\)/);

  // Só confirma depois da resposta real da ferramenta; nada inventado.
  assert.match(prompt, /confirmed=true/);
  assert.match(prompt, /Não invente preços, agenda, funcionalidades, resultados ou fatos/i);
  assert.match(prompt, /recusa clara, respeite e encerre/i);
});

test("monta chamada nativa ElevenLabs/SIP com variáveis rastreáveis", async () => {
  let sentBody: any = null;
  let sentUrl = "";
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sentUrl = String(url);
    sentBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      success: true,
      message: "ok",
      conversation_id: "conv_123",
      sip_call_id: "sip-call-123",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const result = await startElevenLabsSipCall({
    apiKey: "test-key",
    agentId: "agent-1",
    agentPhoneNumberId: "phone-1",
    toNumber: "(11) 99876-5432",
    attemptId: "attempt-1",
    contactId: "contact-1",
    recordingEnabled: false,
    dynamicVariables: { lead_name: "Ana", company_name: "Acme" },
  }, fakeFetch);

  assert.equal(result.conversationId, "conv_123");
  assert.equal(result.callId, "sip-call-123");
  assert.equal(sentUrl, "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call");
  assert.equal(sentBody?.to_number, "+5511998765432");
  assert.equal(sentBody?.conversation_initiation_client_data.dynamic_variables.limo_attempt_id, "attempt-1");
  assert.equal("call_recording_enabled" in sentBody, false);
});
