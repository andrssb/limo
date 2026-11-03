# Piloto do SDR IA por voz

Este é um motor interno de aquisição do próprio Limo, operado pela equipe do Limo. Não é uma
funcionalidade comercial oferecida aos clientes. O agente de voz se chama **Luís** e deve usar
uma voz masculina autorizada para uso comercial.

## Objetivo

Validar se ligações curtas, transparentes e altamente segmentadas conseguem gerar
reuniões qualificadas para o fundador, sem repetir o modelo de disparo em massa do
WhatsApp. A meta comercial é 8 novos clientes, mas o piloto deve ser julgado primeiro
por reuniões qualificadas, comparecimento e ausência de reclamações.

## Estado atual

- Campanhas nascem em `draft`; o executor começa sempre em `dry-run`.
- O recurso global nasce com `VOICE_SDR_ENABLED=false`.
- Chamadas reais exigem uma segunda trava independente: `VOICE_SDR_LIVE_CALLS=true`.
- Telefones entram no padrão E.164 brasileiro e números inválidos são recusados.
- A lista de supressão impede que um contato marcado como “não ligar” volte à fila.
- O webhook do ElevenLabs exige assinatura HMAC e rejeita eventos com mais de 5 minutos.
- Eventos repetidos são idempotentes para não duplicar a contagem de tentativas.
- O executor permite só uma chamada simultânea e aplica limite em janela móvel de 24 horas.
- A ativação exige confirmação explícita dos direitos da voz e da conformidade da chamada.
- Na ligação, a voz deve se apresentar como Luís, do time comercial do Limo; a identificação
  automatizada permanece nos canais escritos, como WhatsApp.
- Gravação nasce desligada e só deve ser habilitada após a regra de consentimento ser definida.

## Próximas etapas

### 1. Preparar o piloto humano assistido

1. Selecionar um único ICP e uma única dor com evidência nos dados do Limo.
2. Separar 30 a 50 contatos de alta aderência, com origem e telefone documentados.
3. Confirmar autorização escrita para a voz clonada; na dúvida, usar a voz do fundador
   ou uma voz sintética licenciada.
4. Ajustar a voz no ElevenLabs antes de mudar de plano: estabilidade, similaridade,
   velocidade, pausas e pronúncia de nomes brasileiros.
5. Fazer 20 simulações internas com objeções, silêncio, interrupção e pedido de remoção.

Critério para avançar: abertura natural, identificação como time comercial, resultado correto em
100% dos testes e nenhuma confirmação falsa de reunião.

### 2. Conectar telefonia e agenda

1. Comprar um número brasileiro dedicado no provedor escolhido e manter identidade de
   chamada consistente; nenhum provedor garante que um número nunca será marcado como spam.
   Se a operação for classificada como telemarketing, validar a obrigação de usar `0303`
   antes da ativação.
2. Associar o número e o agente no ElevenLabs.
3. Configurar o webhook para `POST /v1/voice-sdr/webhooks/elevenlabs`.
4. Criar a ferramenta de agenda com consulta de disponibilidade, reserva idempotente e
   confirmação por e-mail/WhatsApp somente após sucesso real.
5. Validar o executor já implementado: concorrência 1, limite inicial de 10 chamadas por
   janela de 24 horas e bloqueios por horário, supressão, intervalo e máximo de tentativas.
6. Conectar a conta exclusiva via OAuth do Google Calendar. Quando conectada, a ferramenta
   consulta disponibilidade, cria o evento com Google Meet e envia o convite ao lead. Sem
   conexão ou sem e-mail do lead, a solicitação permanece pendente.

Critério para avançar: uma chamada de teste completa gera tentativa, transcrição,
resultado e, quando aplicável, evento de agenda no Limo.

### 3. Rodar o piloto controlado

- Dias 1 e 2: até 10 contatos/dia, com revisão humana de todas as transcrições.
- Dias 3 a 5: até 20 contatos/dia apenas se não houver reclamações e o roteiro estiver estável.
- Não repetir contato antes de 48 horas e não ultrapassar 2 tentativas no piloto.
- Pausar imediatamente em caso de pedido de remoção não respeitado, informação inventada,
  erro de agenda ou aumento de sinalização como spam.

Métricas mínimas: chamadas tentadas, atendidas, permissão para continuar, conversas
qualificadas, reuniões marcadas, comparecimento, propostas, clientes, pedidos de remoção,
falhas técnicas e custo por reunião comparecida.

## Configuração

```env
VOICE_SDR_ENABLED=false
VOICE_SDR_LIVE_CALLS=false
VOICE_SDR_DAILY_LIMIT=10
ELEVENLABS_API_KEY=
ELEVENLABS_WEBHOOK_SECRET=
ELEVENLABS_TOOL_SECRET=
ELEVENLABS_AGENT_ID=
ELEVENLABS_PHONE_NUMBER_ID=
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URI=
GOOGLE_CALENDAR_ACCOUNT=
GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_MEETING_MINUTES=45
```

Mesmo depois de preencher as credenciais, manter `VOICE_SDR_ENABLED=false` até o executor,
a agenda e a revisão do piloto estarem prontos.

## API já disponível

- `GET /v1/voice-sdr/status`
- `POST /v1/voice-sdr/campaigns`
- `GET /v1/voice-sdr/campaigns`
- `POST /v1/voice-sdr/campaigns/:id/status`
- `POST /v1/voice-sdr/campaigns/:id/contacts`
- `POST /v1/voice-sdr/campaigns/:id/run-next` (`dryRun=true` por padrão)
- `GET /v1/voice-sdr/campaigns/:id/attempts`
- `POST /v1/voice-sdr/tools/request-meeting`
- `GET /v1/voice-sdr/meeting-requests`
- `GET /v1/voice-sdr/calendar/google/auth-url`
- `GET /v1/voice-sdr/calendar/google/callback`
- `GET /v1/voice-sdr/calendar/status`
- `GET /v1/voice-sdr/suppressions`
- `POST /v1/voice-sdr/suppressions`
- `POST /v1/voice-sdr/webhooks/elevenlabs`

As rotas administrativas exigem perfil de gestor ou administrador. O webhook é público,
mas somente aceita payload assinado pelo segredo configurado.
