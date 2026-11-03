# Ponte SIP Limo

Esta ponte resolve a diferenca entre os dois provedores:

- a Vono exige que o cliente mantenha um registro SIP (`REGISTER`);
- a ElevenLabs entrega a chamada com um `INVITE` autenticado.

O Asterisk recebe a chamada da ElevenLabs, mantem o registro na Vono e
encaminha o audio nos dois sentidos.

## Requisitos do servidor

- Linux com Docker Engine e Docker Compose;
- IPv4 publico fixo;
- 1 vCPU e 512 MB a 1 GB de RAM;
- portas `5060/tcp`, `5060/udp`, `8080/tcp` e `10000-10100/udp` liberadas na entrada;
- saida UDP para a Vono liberada.

Railway nao e o destino indicado para este container porque seu proxy publico
e TCP, enquanto o RTP da chamada precisa de um intervalo de portas UDP.

## Instalacao

1. Copie `.env.example` para `.env` no servidor.
2. Preencha o IPv4 e as credenciais sem colocar o arquivo no Git.
3. Gere uma senha longa para `EL_SIP_PASSWORD`.
4. Inicie a ponte:

   ```sh
   docker compose up -d --build
   ```

5. Confirme o registro na Vono:

   ```sh
   docker compose exec sip-bridge asterisk -rx "pjsip show registrations"
   ```

   A linha `vono-registration` precisa aparecer como `Registered`.

   O monitor operacional tambem precisa responder como pronto:

   ```sh
   curl -fsS http://127.0.0.1:8080/health
   ```

   A resposta publica apenas o registro da Vono, a quantidade de canais ativos
   e o horario da verificacao. Nenhuma credencial SIP e exposta.

6. No telefone SIP do ElevenLabs, altere a configuracao de saida:

   - Address: IPv4 publico do servidor
   - Transport: TCP
   - Media encryption: Disabled
   - Authentication username: valor de `EL_SIP_USERNAME`
   - Authentication password: valor de `EL_SIP_PASSWORD`
   - Codecs: PCMA e PCMU

## Diagnostico

Ver o registro e os endpoints:

```sh
docker compose exec sip-bridge asterisk -rx "pjsip show registrations"
docker compose exec sip-bridge asterisk -rx "pjsip show endpoints"
```

Ver o fluxo SIP durante um teste:

```sh
docker compose exec sip-bridge asterisk -rx "pjsip set logger on"
docker compose logs -f --tail=200
```

O registro usa tentativas persistentes, inclusive depois de respostas fatais ou
falhas de autenticacao temporarias. A API do Limo deve apontar
`SIP_BRIDGE_HEALTH_URL` para `http://IP_PUBLICO:8080/health`; chamadas reais sao
bloqueadas quando esse monitor nao confirma `Registered`.

Desative o logger SIP depois do teste para evitar registrar dados desnecessarios:

```sh
docker compose exec sip-bridge asterisk -rx "pjsip set logger off"
```
