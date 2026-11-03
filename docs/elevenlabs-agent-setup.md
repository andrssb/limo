# Configuração do agente ElevenLabs — Luís

Esta é a configuração operacional preparada para o piloto. Os identificadores e segredos
só devem ser preenchidos no fim, depois da autorização da voz e da compra/importação do número.

## Identidade

- **Nome:** Luís — time comercial do Limo
- **Idioma principal:** Português (Brasil)
- **Primeira mensagem:**

```text
Oi, eu falo com {{lead_name}}?
```

Depois da confirmação, o prompt orienta o Luís a dizer “Aqui é o Luís, do time comercial do
Limo. Tudo bem?” e a explicar o motivo da ligação. Na chamada, ele não usa “assistente virtual”,
“atendimento automatizado” ou “agente de IA” ao se apresentar.

Decisão revista em 16/09/2026: a mensagem automática de WhatsApp enviada ao confirmar a reunião
**não** carrega mais a linha “Mensagem automática do time comercial do Limo”, por decisão do André.
O canal escrito passa a seguir a mesma identidade da ligação. Registrado aqui porque contraria a
regra anterior do projeto, que mantinha identificação automatizada nos canais escritos. Manter a primeira mensagem isolada evita que o agente
avance antes de confirmar que está falando com a pessoa certa.

## Variáveis dinâmicas recebidas do Limo

| Variável | Origem | Uso |
|---|---|---|
| `lead_name` | contato | Personalizar a abertura |
| `company_name` | contato | Contexto da empresa |
| `job_title` | contato | Contexto do cargo |
| `today_date` | chamada | Data local exata para priorizar demonstração no mesmo dia |
| `tomorrow_date` | chamada | Data local exata do limite da tentativa de agendamento |
| `timezone` | campanha | Fuso usado para interpretar e solicitar o horário |
| `limo_campaign_id` | campanha | Rastreamento interno |
| `limo_attempt_id` | tentativa | Rastreamento e ferramenta de agenda |
| `limo_contact_id` | contato | Rastreamento interno |

## Configuracao viva do agente (16/09/2026)

Estado publicado no agente Luis, conferido pela API depois da homologacao:

| Item | Valor | Por que |
|---|---|---|
| LLM | `claude-haiku-4-5`, temperatura 0.65 | `qwen35-397b` atropelava restricao (pitch de 75 palavras, e-mail inventado); `claude-sonnet-5` argumenta melhor mas deu mediana de 1,05s e pico de 7,3s por turno, silencio demais para telefone |
| Voz | `eleven_v3_conversational`, stability 0.30, speed 1.0, similarity 0.78 | similarity baixa (0.62) deixou a voz "aberta" e artificial: ela se afasta do clone e vira TTS generico. Fidelidade alta com stability 0.30 mantem variacao de entonacao sem perder o timbre |
| `optimize_streaming_latency` | 1 | estava em 3, trocando prosodia por milissegundos |
| Filler de espera | 4s, uma ocorrencia | em 2s disparava tres seguidos e virava gagueira na abertura |
| `end_call` | habilitada | sem ela o agente nao consegue desligar e fica repetindo a despedida |
| Primeira mensagem | `Alo, eu falo com {{lead_first_name}}?` | nome completo soa leitura de cadastro |

Variaveis dinamicas obrigatorias incluem `lead_first_name`. Sem ela a abertura quebra.

## Prompt do sistema

Usar o conteúdo de `apps/api/src/prompts/voice-sdr.ts`. Antes do piloto, acrescentar somente
o argumento comercial do ICP aprovado; não remover as regras obrigatórias de identificação
como time comercial na ligação, respeito à recusa, não invenção e confirmação real da agenda.

## Ferramenta `request_meeting`

- **Tipo:** Webhook/server tool
- **Método:** `POST`
- **URL:** `https://api.limoapp.com.br/v1/voice-sdr/tools/request-meeting`
- **Content-Type:** `application/json`
- **Timeout sugerido:** 15 segundos
- **Descrição:** “Use somente quando o lead demonstrar interesse, fornecer um e-mail válido e
  concordar com uma data e hora explícitas. Nunca diga que está confirmado antes de receber
  `confirmed=true`.”
- **Autenticação:** header secreto `Authorization` com valor `Bearer <ELEVENLABS_TOOL_SECRET>`.

Corpo JSON:

| Campo | Tipo | Obrigatório | Preenchimento |
|---|---|---:|---|
| `limo_attempt_id` | string | sim | variável dinâmica `{{limo_attempt_id}}`; nunca pedir ao lead |
| `proposed_start_at` | string | sim | data/hora ISO 8601 futura, com offset; exemplo `2026-09-15T14:00:00-03:00` |
| `timezone` | string | sim | valor fixo `America/Sao_Paulo` no piloto |
| `invitee_email` | string | sim | e-mail confirmado verbalmente pelo lead |

Tratamento da resposta:

- `confirmed=true`: informar que a reunião foi confirmada e que o convite foi enviado.
- `status=slot_unavailable`: pedir outra opção de data/hora.
- `status=invalid_time`: pedir outro horário para hoje ou amanhã, sempre em hora cheia e com início
  no máximo às 17h.
- `status=missing_email`: pedir e confirmar um e-mail válido.
- qualquer outro retorno com `confirmed=false`: dizer que o horário foi solicitado, mas ainda
  depende de confirmação. Nunca prometer uma reserva inexistente.

## Análise pós-chamada

Criar os itens abaixo em **Analysis → Data collection**:

| Identificador | Tipo | Instrução de extração |
|---|---|---|
| `outcome` | string | Retorne exatamente um valor: `no_answer`, `voicemail`, `gatekeeper`, `not_interested`, `callback`, `interested`, `meeting_booked`, `do_not_call`, `wrong_number` ou `failed`. |
| `permission_granted` | boolean | Verdadeiro somente se a pessoa autorizou continuar após a abertura de 30 segundos. |
| `pain_summary` | string | Resuma a dor comercial declarada; vazio se não houve conversa suficiente. |
| `objection_summary` | string | Resuma a objeção principal; vazio se nenhuma foi apresentada. |
| `do_not_call` | boolean | Verdadeiro diante de qualquer pedido para não receber novas ligações. |
| `meeting_requested` | boolean | Verdadeiro se o lead pediu ou aceitou uma reunião, mesmo se a agenda não confirmou. |

## Webhook pós-chamada

- **URL:** `https://api.limoapp.com.br/v1/voice-sdr/webhooks/elevenlabs`
- **Eventos:** `post_call_transcription` e `call_initiation_failure`
- **Autenticação:** HMAC habilitado; salvar o segredo gerado como
  `ELEVENLABS_WEBHOOK_SECRET` no Railway.

O Limo valida assinatura e timestamp, associa a conversa pelo `limo_attempt_id`, evita dupla
contagem em retries, atualiza a fila e inclui pedidos de remoção na lista de “não ligar”.

## Voz e comportamento

- Começar com velocidade natural e levemente mais lenta que uma locução publicitária.
- Evitar similaridade e estabilidade no máximo; priorizar ritmo conversacional e clareza.
- Manter interrupções habilitadas durante fala normal.
- Desabilitar interrupções somente enquanto a ferramenta de agenda estiver executando.
- Testar nomes, siglas, “Limo”, “SDR”, “CRM”, “prospecção” e cidades brasileiras.
- Avaliar se o Luís reconhece respostas dadas fora da ordem, responde a desvios e retoma a descoberta
  sem repetir perguntas nem recitar o roteiro.
- Em toda simulação com interesse, verificar se ele tenta primeiro uma demonstração no mesmo dia e,
  quando não for possível, no dia seguinte.
- Confirmar que a demonstração dura 45 minutos, começa somente em hora cheia, no máximo às 17h,
  e usa o título `Demo - Limo app <> {{company_name}}` no Google Meet.
- Não habilitar gravação no piloto até a regra de consentimento estar definida.

## Validação antes da ativação

1. Fazer 20 simulações internas, incluindo respostas longas, curtas, fora do roteiro e objeções.
2. Verificar se `outcome` é válido em todas.
3. Confirmar que “não ligar” bloqueia novas tentativas.
4. Confirmar que horário ocupado nunca é apresentado como reservado.
5. Fazer uma chamada controlada de ponta a ponta com convite de agenda.
6. Só então preencher e habilitar as duas travas de produção.
