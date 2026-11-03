# Tasks finais — operação interna de aquisição do Limo

Este arquivo separa o motor interno de aquisição do Limo das poucas ações que exigem
login, contratação, consentimento ou decisão do responsável pela operação.

Estado verificado em 16/09/2026: API `200 OK`, ponte SIP respondendo com a Vono em
`Registered`, número `+55 11 5444-4114` atribuído ao agente Luís por SIP trunk, webhook
de pós-chamada ativo (transcrição, sem áudio) e 22 testes automatizados verdes.

## Concluído no produto

- [x] Estrutura de campanhas, filas, tentativas, supressões e reuniões no banco.
- [x] Chamadas reais protegidas por duas travas de ambiente.
- [x] Campanhas em rascunho e executor em `dry-run` por padrão.
- [x] Limite conservador em janela móvel de 24 horas, uma chamada simultânea e pausa entre tentativas.
- [x] Lista de “não ligar” aplicada antes de qualquer nova tentativa.
- [x] Webhook do ElevenLabs assinado, idempotente e com proteção básica contra replay.
- [x] Agendamento real com consulta de disponibilidade, Google Meet e convite por e-mail.
- [x] Conta de reuniões definida como a conta Google de agenda do time.
- [x] Painel de conexão do Google Calendar em **Configurações** e atalho no painel de aquisição.
- [x] Painel de **aquisição interna** para criar campanhas, adicionar leads e testar a fila sem ligar.
- [x] Busca de leads por nome completo, com filtro de telefone aplicado no banco.
- [x] Testes automatizados do conector, agenda, assinatura, autenticação, busca de leads,
  datas faladas e regras do piloto.
- [x] Configuração completa do agente **Luís** documentada em `docs/elevenlabs-agent-setup.md`.
- [x] Prompt do agente espelhado em `apps/api/src/prompts/voice-sdr.ts` para revisão no Git.

## Para o André fazer no final

### 1. Google Calendar

- [x] Projeto no Google Cloud, Calendar API habilitada e credencial OAuth de aplicativo web.
- [x] URI de redirecionamento cadastrado:
  `https://api.limoapp.com.br/v1/voice-sdr/calendar/google/callback`
- [x] Credenciais no Railway (`GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`).
- [ ] Confirmar no painel que **Google Calendar** está verde; se não estiver, usar o botão
  **Conectar agenda** e autorizar com a conta Google de agenda do time.

### 2. Voz do agente

- [x] Agente “Luís” publicado, em `pt-br`, com voz masculina e identificação como time comercial.
- [x] Voz definida com o modelo `eleven_v3_conversational` (velocidade 0.98, estabilidade 0.32).
- [ ] Confirmar por escrito o direito de uso comercial da voz escolhida.
- [ ] Rodar simulações internas de recepção, objeção, silêncio, interrupção, caixa postal,
  pedido de retorno e pedido de remoção — a chamada real de 3min07s cobriu só o caminho feliz.

### 3. Telefonia

- [x] Número brasileiro dedicado ativo na Vono: `+55 11 5444-4114`.
- [x] Ponte Asterisk na AWS (São Paulo) mantendo `REGISTER` com a Vono e recebendo o SIP
  da ElevenLabs; health em `SIP_BRIDGE_HEALTH_URL`, monitorado pelo painel a cada 10s.
- [ ] Validar com o provedor e orientação jurídica se a operação exige origem `0303`.
- [ ] Manter um único número e baixa cadência. Não alternar números para contornar reputação.

### 4. Credenciais do provedor

- [x] `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` e `ELEVENLABS_PHONE_NUMBER_ID` no Railway.
- [x] `ELEVENLABS_TOOL_SECRET` gerado e guardado no Railway, sem expor o valor.
- [x] `ELEVENLABS_WEBHOOK_SECRET` configurado; webhook de pós-chamada ativo para
  `transcript` e `call_initiation_failure`, com envio de áudio desligado.
- [x] Webhook: `https://api.limoapp.com.br/v1/voice-sdr/webhooks/elevenlabs`
- [x] Ferramenta server-side de agenda:
  `https://api.limoapp.com.br/v1/voice-sdr/tools/request-meeting`

### 5. Homologação antes do piloto

- [ ] Abrir a campanha de teste, buscar “André Teste Voz” e confirmar que o contato entra na fila.
- [ ] Fazer **uma** chamada para número controlado, acompanhando os logs do Limo, da ElevenLabs
  e da ponte ao mesmo tempo.
- [ ] Na chamada, validar: áudio nos dois sentidos, cargo exato da vaga, agendamento em hora
  cheia até 17h, convite com Google Meet no e-mail, encerramento sem rediscagem.
- [ ] Conferir depois: transcrição gravada, `outcome` correto, reunião registrada e
  supressão funcionando para pedido de “não ligar”.
- [ ] Escolher um único ICP e documentar o motivo observável para a abordagem.
- [ ] Revisar manualmente 30–50 leads com telefone, e-mail, cargo e empresa válidos.
- [ ] Inserir primeiro somente 10 leads na campanha de teste.

### 6. Travas de ambiente

`VOICE_SDR_ENABLED` e `VOICE_SDR_LIVE_CALLS` estão **ligadas** em produção desde os testes
de 14–15/09. Com as duas ligadas, uma campanha ativa consegue originar chamada real.

- [ ] Manter as duas ligadas somente durante a janela de teste acompanhada.
- [ ] Desligar `VOICE_SDR_LIVE_CALLS` ao terminar a homologação e religar apenas
  imediatamente antes do piloto real.
- [x] Proteção adicional que continua valendo: campanha nasce em rascunho, executor em
  `dry-run`, ativação exige dupla confirmação e o limite de 24h é de 10 chamadas.

## Critério de liberação

O piloto só pode ser ativado quando Google Calendar, agente, número e webhooks estiverem verdes
no painel; a chamada controlada tiver produzido resultado correto; e direitos da voz e conformidade
da numeração tiverem sido confirmados. A gravação permanece desligada até existir uma regra de
consentimento definida para a operação.
