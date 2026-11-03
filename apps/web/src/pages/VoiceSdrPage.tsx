import React, { useEffect, useMemo, useState } from "react";
import { Bot, CalendarDays, CheckCircle2, PhoneCall, Plus, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { apiFetch } from "../lib/api";

type VoiceStatus = {
  enabled: boolean;
  providerReady: boolean;
  readyForLiveCalls: boolean;
  configured: Record<string, boolean>;
  safety: { liveCallsEnabled: boolean; dryRunDefault: boolean; maxConcurrency: number; defaultDailyLimit: number };
  bridge: {
    configured: boolean;
    ready: boolean;
    status: "registered" | "offline" | "unreachable" | "unconfigured";
    registration: string | null;
    activeChannels: number | null;
    checkedAt: string | null;
    error: string | null;
  };
};

type CalendarStatus = {
  connected: boolean;
  oauthConfigured: boolean;
  needsReauthorization?: boolean;
  connection: { accountEmail: string } | null;
};

type Campaign = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "completed";
  timezone: string;
  businessHourStart: number;
  businessHourEnd: number;
  dailyLimit: number;
  maxAttemptsPerLead: number;
  minRetryHours: number;
  recordingEnabled: boolean;
  createdAt: string;
  queue: Record<string, number>;
  outcomes: Record<string, number>;
};

type MeetingRequest = {
  id: string;
  requestedStartAt: string;
  inviteeEmail: string | null;
  status: string;
  schedulingUrl: string | null;
  createdAt: string;
  campaignName: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
};

const outcomeLabels: Record<string, string> = {
  no_answer: "Não atendeu",
  voicemail: "Caixa postal",
  gatekeeper: "Barreira",
  not_interested: "Sem interesse",
  callback: "Retorno",
  interested: "Interessado",
  meeting_booked: "Reunião",
  do_not_call: "Não ligar",
  wrong_number: "Número errado",
  failed: "Falha",
};

const blockerLabels: Record<string, string> = {
  empty_queue: "A fila ainda não possui leads",
  concurrency_limit: "Já existe uma ligação em andamento",
  outside_business_hours: "Fora do horário permitido",
  daily_limit: "Limite das últimas 24 horas atingido",
  retry_wait: "Lead aguardando intervalo para nova tentativa",
  max_attempts: "Limite de tentativas atingido",
  invalid_phone: "Telefone inválido",
  suppressed: "Lead presente na lista de não ligar",
  weekend: "Chamadas bloqueadas no fim de semana",
};

export function VoiceSdrPage() {
  const [voice, setVoice] = useState<VoiceStatus | null>(null);
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [meetings, setMeetings] = useState<MeetingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [leadCampaign, setLeadCampaign] = useState<Campaign | null>(null);
  const [activationCampaign, setActivationCampaign] = useState<Campaign | null>(null);
  const [callCampaign, setCallCampaign] = useState<Campaign | null>(null);
  const [reviewCampaign, setReviewCampaign] = useState<Campaign | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [voiceResult, calendarResult, campaignResult, meetingResult] = await Promise.all([
        apiFetch<VoiceStatus>("/voice-sdr/status"),
        apiFetch<CalendarStatus>("/voice-sdr/calendar/status"),
        apiFetch<{ campaigns: Campaign[] }>("/voice-sdr/campaigns"),
        apiFetch<{ meetingRequests: MeetingRequest[] }>("/voice-sdr/meeting-requests"),
      ]);
      setVoice(voiceResult);
      setCalendar(calendarResult);
      setCampaigns(campaignResult.campaigns);
      setMeetings(meetingResult.meetingRequests);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const monitor = window.setInterval(() => {
      apiFetch<VoiceStatus>("/voice-sdr/status").then(setVoice).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(monitor);
  }, []);

  async function connectCalendar() {
    try {
      const result = await apiFetch<{ url: string }>("/voice-sdr/calendar/google/auth-url");
      window.location.assign(result.url);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  const totals = useMemo(() => {
    const attempts = campaigns.reduce((sum, campaign) =>
      sum + Object.values(campaign.outcomes ?? {}).reduce((subtotal, value) => subtotal + value, 0), 0);
    const booked = campaigns.reduce((sum, campaign) => sum + (campaign.outcomes?.meeting_booked ?? 0), 0);
    const leads = campaigns.reduce((sum, campaign) =>
      sum + Object.values(campaign.queue ?? {}).reduce((subtotal, value) => subtotal + value, 0), 0);
    return { attempts, booked, leads };
  }, [campaigns]);

  async function dryRun(campaign: Campaign, testMode = false) {
    setMessage(testMode ? "Testando a fila ignorando o horário comercial..." : "Testando regras da fila...");
    try {
      const result = await apiFetch<any>(`/voice-sdr/campaigns/${campaign.id}/run-next`, {
        method: "POST",
        body: JSON.stringify({ dryRun: true, testMode }),
      });
      setMessage(result.eligible
        ? `Próximo lead elegível${testMode ? " (modo teste)" : ""}: ${result.contact.name || "sem nome"} · ${result.contact.companyName || "sem empresa"} · telefone final ${result.contact.phoneEnding}`
        : "Nenhum lead elegível neste momento.");
    } catch (error) {
      const raw = (error as Error).message;
      const translated = Object.entries(blockerLabels).find(([key]) => raw.includes(key))?.[1];
      setMessage(translated ?? raw);
    }
  }

  async function pause(campaign: Campaign) {
    await apiFetch(`/voice-sdr/campaigns/${campaign.id}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "paused" }),
    });
    setMessage(`Campanha “${campaign.name}” pausada.`);
    load();
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <div>
            <div className="page-title">Aquisição interna</div>
            <div className="page-subtitle">Motor interno do Limo para prospecção e agendamento</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}><RefreshCw size={13} /> Atualizar</button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Nova campanha</button>
          </div>
        </div>
      </div>

      <div className="content">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 18 }}>
          <MetricCard icon={<Users size={18} />} label="Leads nas filas" value={String(totals.leads)} />
          <MetricCard icon={<PhoneCall size={18} />} label="Tentativas" value={String(totals.attempts)} />
          <MetricCard icon={<CalendarDays size={18} />} label="Reuniões marcadas" value={String(totals.booked)} />
          <MetricCard icon={<ShieldCheck size={18} />} label="Limite inicial" value={`${voice?.safety.defaultDailyLimit ?? 10}/24h`} />
        </div>

        <div className="card" style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 5 }}>Operação interna do Limo</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 12 }}>Este motor apoia a aquisição do próprio Limo e não é uma funcionalidade comercial oferecida aos clientes.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
            <div>
              <Readiness
                label="Google Calendar"
                ready={Boolean(calendar?.connected)}
                detail={calendar?.needsReauthorization
                  ? "token ilegível — reautorize a conta"
                  : calendar?.connection?.accountEmail ?? "aguardando autorização"}
              />
              {!calendar?.connected && calendar?.oauthConfigured && (
                <button className="btn btn-secondary btn-sm" style={{ marginTop: 6 }} onClick={connectCalendar}>
                  {calendar?.needsReauthorization ? "Reautorizar agenda" : "Conectar agenda"}
                </button>
              )}
            </div>
            <Readiness label="Agente e número" ready={Boolean(voice?.providerReady)} detail={voice?.providerReady ? "ElevenLabs pronto" : "credenciais pendentes"} />
            <Readiness
              label="Tronco Vono"
              ready={Boolean(voice?.bridge.ready)}
              detail={voice?.bridge.ready
                ? `registrado · ${voice.bridge.activeChannels ?? 0} canal(is) ativo(s)`
                : voice?.bridge.status === "unreachable" ? "monitor inacessível" : "SIP offline"}
            />
            <Readiness label="Travas de segurança" ready={!voice?.safety.liveCallsEnabled} detail={voice?.safety.liveCallsEnabled ? "ligações habilitadas" : "ligações reais desligadas"} neutral />
            <Readiness label="Operação ao vivo" ready={Boolean(voice?.readyForLiveCalls)} detail={voice?.readyForLiveCalls ? "pronta" : "bloqueada até o piloto"} />
          </div>
        </div>

        <details className="card" style={{ marginBottom: 18 }} open={!voice?.readyForLiveCalls}>
          <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 700 }}>Tasks finais antes da primeira ligação</summary>
          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            <TaskRow done={Boolean(calendar?.connected)} text="Autorizar a conta de agenda do time no Google Calendar" />
            <TaskRow done={Boolean(voice?.configured?.apiKey && voice?.configured?.agent)} text="Publicar a Lia no ElevenLabs e cadastrar a chave e o agente" />
            <TaskRow done={Boolean(voice?.configured?.phoneNumber)} text="Comprar ou importar um número brasileiro dedicado" />
            <TaskRow done={Boolean(voice?.configured?.webhookSecret)} text="Conectar e validar o webhook pós-chamada" />
            <TaskRow done={false} text="Confirmar direitos da voz e conformidade da numeração" />
            <TaskRow done={false} text="Executar 20 simulações e uma chamada controlada de ponta a ponta" />
          </div>
        </details>

        {message && (
          <div style={{ padding: "11px 14px", marginBottom: 16, borderRadius: 9, background: "var(--bg-surface)", border: "1px solid var(--border)", fontSize: 12.5 }}>
            {message}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Campanhas</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>O teste de fila nunca realiza uma ligação</div>
        </div>

        {loading ? <div className="loading">Carregando...</div> : campaigns.length === 0 ? (
          <div className="card empty">Crie a primeira campanha do piloto. Ela nascerá em rascunho e sem chamadas reais.</div>
        ) : campaigns.map((campaign) => {
          const queueTotal = Object.values(campaign.queue ?? {}).reduce((sum, value) => sum + value, 0);
          const attemptsTotal = Object.values(campaign.outcomes ?? {}).reduce((sum, value) => sum + value, 0);
          return (
            <div className="card" key={campaign.id} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <Bot size={16} color="var(--green)" />
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{campaign.name}</span>
                    <CampaignStatus status={campaign.status} />
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    {campaign.businessHourStart}h–{campaign.businessHourEnd}h · {campaign.dailyLimit}/24h · até {campaign.maxAttemptsPerLead} tentativas · intervalo {campaign.minRetryHours}h
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {(campaign.status === "draft" || campaign.status === "paused") && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setLeadCampaign(campaign)}>Adicionar leads</button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setReviewCampaign(campaign)}>Revisar ligações</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => dryRun(campaign)}>Testar fila</button>
                  <button className="btn btn-ghost btn-sm" title="Testa a fila ignorando horário comercial e fim de semana" onClick={() => dryRun(campaign, true)}>Testar fora do horário</button>
                  {(campaign.status === "draft" || campaign.status === "paused") && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => setActivationCampaign(campaign)}
                      disabled={!voice?.readyForLiveCalls || !calendar?.connected}
                      title={!voice?.readyForLiveCalls || !calendar?.connected ? "Conclua o checklist técnico antes de ativar" : "Ativar campanha"}
                    >Ativar</button>
                  )}
                  {campaign.status === "active" && (
                    <button className="btn btn-primary btn-sm" onClick={() => setCallCampaign(campaign)}>Ligar para o próximo</button>
                  )}
                  {campaign.status === "active" && <button className="btn btn-danger btn-sm" onClick={() => pause(campaign)}>Pausar</button>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 18, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
                <SmallStat label="Fila" value={queueTotal} />
                <SmallStat label="Pendentes" value={campaign.queue?.pending ?? 0} />
                <SmallStat label="Tentativas" value={attemptsTotal} />
                {Object.entries(campaign.outcomes ?? {}).filter(([key]) => key !== "pending").map(([key, value]) => (
                  <SmallStat key={key} label={outcomeLabels[key] ?? key} value={value} />
                ))}
              </div>
            </div>
          );
        })}

        <div style={{ fontSize: 15, fontWeight: 700, margin: "22px 0 10px" }}>Solicitações de reunião</div>
        <div className="card">
          {meetings.length === 0 ? <div className="empty">Nenhuma solicitação de reunião ainda.</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Data solicitada</th><th>Lead</th><th>Convidado</th><th>Status</th><th>Link</th></tr></thead>
                <tbody>{meetings.map((meeting) => (
                  <tr key={meeting.id}>
                    <td>{new Date(meeting.requestedStartAt).toLocaleString("pt-BR")}</td>
                    <td>{meeting.firstName} {meeting.lastName}<div style={{ fontSize: 10, color: "var(--text-muted)" }}>{meeting.companyName ?? meeting.campaignName}</div></td>
                    <td>{meeting.inviteeEmail ?? "—"}</td>
                    <td><span className={`badge ${meeting.status === "confirmed" ? "badge-green" : "badge-gray"}`}>{meeting.status}</span></td>
                    <td>{meeting.schedulingUrl ? <a href={meeting.schedulingUrl} target="_blank" rel="noreferrer">Abrir</a> : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showNew && <NewCampaignModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
      {leadCampaign && <AddLeadsModal campaign={leadCampaign} onClose={() => setLeadCampaign(null)} onAdded={() => { setLeadCampaign(null); load(); }} />}
      {activationCampaign && <ActivationModal campaign={activationCampaign} onClose={() => setActivationCampaign(null)} onActivated={() => { setActivationCampaign(null); setMessage("Campanha ativada com as confirmações registradas."); load(); }} />}
      {callCampaign && <RunCallModal campaign={callCampaign} onClose={() => setCallCampaign(null)} onStarted={(text) => { setCallCampaign(null); setMessage(text); load(); }} />}
      {reviewCampaign && <AttemptsModal campaign={reviewCampaign} onClose={() => setReviewCampaign(null)} />}
    </>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="card" style={{ padding: 16 }}><div style={{ color: "var(--green)", marginBottom: 9 }}>{icon}</div><div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div></div>;
}

function SmallStat({ label, value }: { label: string; value: number }) {
  return <div><div style={{ fontSize: 15, fontWeight: 700 }}>{value}</div><div style={{ fontSize: 10, color: "var(--text-muted)" }}>{label}</div></div>;
}

function Readiness({ label, ready, detail, neutral = false }: { label: string; ready: boolean; detail: string; neutral?: boolean }) {
  const color = ready || neutral ? "var(--green)" : "var(--yellow)";
  return <div style={{ padding: 12, borderRadius: 9, background: "var(--bg-surface)", display: "flex", gap: 9 }}><CheckCircle2 size={17} color={color} /><div><div style={{ fontSize: 12, fontWeight: 700 }}>{label}</div><div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>{detail}</div></div></div>;
}

function TaskRow({ done, text }: { done: boolean; text: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, color: done ? "var(--text-muted)" : "var(--text)" }}><span style={{ width: 18, height: 18, borderRadius: 5, border: `1px solid ${done ? "var(--green)" : "var(--border)"}`, background: done ? "rgba(163,230,53,.12)" : "var(--bg-surface)", color: "var(--green)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{done ? "✓" : ""}</span><span style={{ textDecoration: done ? "line-through" : "none" }}>{text}</span></div>;
}

function CampaignStatus({ status }: { status: Campaign["status"] }) {
  const labels = { draft: "Rascunho", active: "Ativa", paused: "Pausada", completed: "Concluída" };
  return <span className={`badge ${status === "active" ? "badge-green" : "badge-gray"}`}>{labels[status]}</span>;
}

function NewCampaignModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("Piloto SDR IA — ICP inicial");
  const [dailyLimit, setDailyLimit] = useState(10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      await apiFetch("/voice-sdr/campaigns", {
        method: "POST",
        body: JSON.stringify({ name, dailyLimit, businessHourStart: 9, businessHourEnd: 18, maxAttemptsPerLead: 2, minRetryHours: 48, recordingEnabled: false }),
      });
      onCreated();
    } catch (err) { setError((err as Error).message); setSaving(false); }
  }

  return <Modal title="Nova campanha de voz" onClose={onClose}><form onSubmit={submit}>
    <div className="form-group"><label className="form-label">Nome</label><input className="form-input" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} /></div>
    <div className="form-group"><label className="form-label">Limite por janela de 24 horas</label><input className="form-input" type="number" min={1} max={20} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} /></div>
    <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 16 }}>Horário: dias úteis, das 9h às 18h. Duas tentativas no máximo, com 48 horas de intervalo. Gravação desligada.</div>
    {error && <p className="error-msg">{error}</p>}
    <div style={{ display: "flex", gap: 8 }}><button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={saving}>{saving ? "Criando..." : "Criar rascunho"}</button></div>
  </form></Modal>;
}

function AddLeadsModal({ campaign, onClose, onAdded }: { campaign: Campaign; onClose: () => void; onAdded: () => void }) {
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  async function find(event?: React.FormEvent) {
    event?.preventDefault(); setLoading(true); setError(""); setSearched(true);
    try {
      // hasPhone é filtro de banco: filtrar aqui depois de paginar escondia
      // contatos discáveis atrás de contatos sem telefone.
      const result = await apiFetch<{ data: any[] }>(`/contacts?search=${encodeURIComponent(search.trim())}&hasPhone=true&pageSize=20`);
      setContacts(result.data);
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }

  async function add() {
    setLoading(true); setError("");
    try {
      const result = await apiFetch<any>(`/voice-sdr/campaigns/${campaign.id}/contacts`, { method: "POST", body: JSON.stringify({ contactIds: [...selected] }) });
      if (result.added === 0) setError("Nenhum lead foi adicionado. Verifique telefone, duplicidade ou lista de não ligar.");
      else onAdded();
    } catch (err) { setError((err as Error).message); setLoading(false); }
  }

  function toggle(id: string) { setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }); }

  return <Modal title={`Adicionar leads · ${campaign.name}`} onClose={onClose} wide>
    <form onSubmit={find} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <input
        className="form-input"
        id="voice-sdr-lead-search"
        name="leadSearch"
        type="search"
        autoFocus
        autoComplete="off"
        placeholder="Nome, empresa ou e-mail"
        aria-label="Buscar contato por nome, empresa ou e-mail"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <button type="submit" className="btn btn-secondary" disabled={loading}>{loading ? "Buscando..." : "Buscar"}</button>
    </form>
    <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
      {contacts.length === 0 ? <div className="empty">{searched ? "Nenhum contato com telefone encontrado para essa busca." : "Busque contatos com telefone cadastrado."}</div> : contacts.map((contact) => <label key={contact.id} style={{ display: "flex", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--border)", cursor: "pointer" }}><input type="checkbox" checked={selected.has(contact.id)} onChange={() => toggle(contact.id)} /><div><div style={{ fontSize: 12.5, fontWeight: 600 }}>{contact.firstName} {contact.lastName}</div><div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{contact.companyName ?? "Sem empresa"} · {contact.phone}</div></div></label>)}
    </div>
    {error && <p className="error-msg">{error}</p>}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}><span style={{ fontSize: 11, color: "var(--text-muted)" }}>{selected.size} selecionado(s)</span><div style={{ display: "flex", gap: 8 }}><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={add} disabled={loading || selected.size === 0}>Adicionar à fila</button></div></div>
  </Modal>;
}

function ActivationModal({ campaign, onClose, onActivated }: { campaign: Campaign; onClose: () => void; onActivated: () => void }) {
  const [voiceRights, setVoiceRights] = useState(false);
  const [compliance, setCompliance] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Colar o ID costuma trazer espaco invisivel junto e a comparação exata
  // deixava o botão desabilitado sem explicar o motivo.
  const confirmationValue = confirmation.trim();
  const valid = voiceRights && compliance && confirmationValue === campaign.id;

  async function activate() {
    setSaving(true); setError("");
    try {
      await apiFetch(`/voice-sdr/campaigns/${campaign.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "active", confirmVoiceRights: voiceRights, confirmCallingCompliance: compliance, confirmation: confirmationValue }),
      });
      onActivated();
    } catch (err) { setError((err as Error).message); setSaving(false); }
  }

  return <Modal title={`Ativar · ${campaign.name}`} onClose={onClose}>
    <div style={{ padding: 12, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 8, fontSize: 11.5, lineHeight: 1.6, marginBottom: 14 }}>A ativação permite chamadas reais. Confirme somente depois do teste controlado, da agenda e da numeração estarem validados.</div>
    <label style={{ display: "flex", gap: 9, fontSize: 12, marginBottom: 10 }}><input type="checkbox" checked={voiceRights} onChange={(e) => setVoiceRights(e.target.checked)} /> Confirmo autorização comercial para a voz utilizada.</label>
    <label style={{ display: "flex", gap: 9, fontSize: 12, marginBottom: 14 }}><input type="checkbox" checked={compliance} onChange={(e) => setCompliance(e.target.checked)} /> Confirmo a conformidade da chamada e da numeração.</label>
    <div className="form-group"><label className="form-label">Digite o ID da campanha para confirmar</label><input className="form-input" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder={campaign.id} /></div>
    {error && <p className="error-msg">{error}</p>}
    <div style={{ display: "flex", gap: 8 }}><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-danger" onClick={activate} disabled={!valid || saving}>{saving ? "Ativando..." : "Ativar chamadas"}</button></div>
  </Modal>;
}

function RunCallModal({ campaign, onClose, onStarted }: { campaign: Campaign; onClose: () => void; onStarted: (message: string) => void }) {
  const [confirmation, setConfirmation] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setSaving(true); setError("");
    try {
      const result = await apiFetch<any>(`/voice-sdr/campaigns/${campaign.id}/run-next`, {
        method: "POST",
        body: JSON.stringify({ dryRun: false, testMode, confirmation: confirmation.trim() }),
      });
      onStarted(`Ligação iniciada${testMode ? " em modo teste" : ""} para ${result.contact.name || "o próximo lead"}, telefone final ${result.contact.phoneEnding}.`);
    } catch (err) { setError((err as Error).message); setSaving(false); }
  }

  return <Modal title="Confirmar uma ligação real" onClose={onClose}>
    <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 14 }}>Será feita somente uma ligação para o próximo lead elegível. Use “Testar fila” antes desta ação.</div>
    <label style={{ display: "flex", gap: 9, fontSize: 12, marginBottom: 14, alignItems: "flex-start" }}>
      <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} style={{ marginTop: 2 }} />
      <span>
        Modo teste: ignorar horário comercial e fim de semana.
        <span style={{ display: "block", color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>
          Só liga para número da lista autorizada de testes. As demais travas continuam valendo.
        </span>
      </span>
    </label>
    <div className="form-group"><label className="form-label">Digite o ID da campanha</label><input className="form-input" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder={campaign.id} /></div>
    {error && <p className="error-msg">{error}</p>}
    <div style={{ display: "flex", gap: 8 }}><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-danger" onClick={run} disabled={saving || confirmation.trim() !== campaign.id}>{saving ? "Iniciando..." : testMode ? "Ligar em modo teste" : "Realizar uma ligação"}</button></div>
  </Modal>;
}

function AttemptsModal({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [attempts, setAttempts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ attempts: any[] }>(`/voice-sdr/campaigns/${campaign.id}/attempts`)
      .then((result) => setAttempts(result.attempts))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [campaign.id]);

  return <Modal title={`Revisão · ${campaign.name}`} onClose={onClose} wide>
    {loading ? <div className="loading">Carregando...</div> : error ? <p className="error-msg">{error}</p> : attempts.length === 0 ? <div className="empty">Nenhuma tentativa realizada nesta campanha.</div> : (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {attempts.map((attempt) => <details key={attempt.id} style={{ border: "1px solid var(--border)", background: "var(--bg-surface)", borderRadius: 8, padding: "10px 12px" }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 650 }}>
            {new Date(attempt.createdAt).toLocaleString("pt-BR")} · {outcomeLabels[attempt.outcome] ?? attempt.outcome ?? attempt.status} · final {String(attempt.phone).slice(-4)}
          </summary>
          <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.6, marginTop: 10 }}>
            <div>Status: {attempt.status}{attempt.durationSeconds != null ? ` · ${attempt.durationSeconds}s` : ""}</div>
            {attempt.summary && <div style={{ marginTop: 7 }}><strong>Resumo:</strong> {attempt.summary}</div>}
            {attempt.errorMessage && <div style={{ marginTop: 7, color: "var(--red)" }}><strong>Erro:</strong> {attempt.errorMessage}</div>}
            {attempt.transcript && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", fontSize: 11, background: "var(--bg-card)", padding: 10, borderRadius: 6, marginTop: 9, maxHeight: 240, overflow: "auto" }}>{typeof attempt.transcript === "string" ? attempt.transcript : JSON.stringify(attempt.transcript, null, 2)}</pre>}
          </div>
        </details>)}
      </div>
    )}
  </Modal>;
}

function Modal({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={(event) => event.target === event.currentTarget && onClose()}><div className="card" style={{ width: wide ? 620 : 460, maxWidth: "92vw", maxHeight: "90vh", overflow: "auto", padding: 24 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}><div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div><button onClick={onClose} style={{ background: "none", border: 0, color: "var(--text-muted)", cursor: "pointer", fontSize: 20 }}>×</button></div>{children}</div></div>;
}
