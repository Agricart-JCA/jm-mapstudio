# JM MapStudio — Integração WhatsApp (Meta Cloud API)

Consulta fundiária do RJ direto no WhatsApp: **CAR · SIGEF · Plantas/PAL · Embargos IBAMA**.

## O que o cliente pode fazer

| Ação no WhatsApp | Resposta |
|------------------|----------|
| Envia **localização** 📍 | Relatório completo do ponto: município + CAR + SIGEF + plantas + embargos IBAMA + imagem do mapa |
| `CAR RJ-3304557-XXXX...` | Dados do imóvel CAR + imagem |
| `SIGEF 5120100113558` | Parcela SIGEF (aceita código, código do imóvel 13 díg. ou matrícula) + imagem |
| `PLANTA Seropédica` | Lista de plantas/PAL aprovadas do município |
| `ajuda` / `oi` / `menu` | Menu de boas-vindas com os comandos |

## Como funciona

```
Cliente (WhatsApp) → Meta Cloud API → POST .../whatsapp-webhook
        ↓
  registrarMensagem()  → dedup (ignora reentregas) + log + rate limit
        ↓
  roteador de comandos:
    location → consultarCoordenada()  → CAR + SIGEF + plantas + IBAMA
    CAR/SIGEF/PLANTA → busca específica
        ↓
  sendImage() (mapa) + sendText() (relatório formatado)
```

Fontes: SICAR WMS/WFS (CAR), base local `sigef_rj.geojson` (SIGEF, 13.716 parcelas RJ),
tabela `plantas` do Supabase (PAL), WFS IBAMA (embargos). Cache em memória na Edge Function.

---

## PASSO 0 — Rodar a migração do banco

No Supabase → SQL Editor → cole e rode **`migration-whatsapp.sql`**
(cria a tabela `whatsapp_logs` usada para dedup, rate limit e auditoria).

---

## PASSO 1 — Criar app no Meta for Developers

1. Acesse: https://developers.facebook.com/apps
2. Clique em **Criar Aplicativo**
3. Tipo: **Negócios**
4. Adicione o produto **WhatsApp**
5. Em **API Setup**, anote:
   - **Phone Number ID** → `WHATSAPP_PHONE_ID`
   - **Token temporário** (use para testes; veja Passo 4 para token permanente)

---

## PASSO 2 — Configurar secrets no Supabase

Acesse: https://supabase.com/dashboard/project/zzjizqiafnnuqmrkhjqj/settings/functions

Adicione:

| Variável | Valor |
|----------|-------|
| `WHATSAPP_TOKEN` | Token permanente do Meta |
| `WHATSAPP_PHONE_ID` | Phone Number ID do Meta |
| `WHATSAPP_VERIFY_TOKEN` | Qualquer string, ex: `jm-mapstudio-2024` |
| `WHATSAPP_APP_SECRET` | _(opcional)_ App Secret do Meta — valida a assinatura HMAC das requisições |
| `STATIC_MAP_TEMPLATE` | _(opcional)_ URL de mapa com base (ruas/satélite) usando `{lat}` `{lon}` `{zoom}` — ex. Geoapify/MapTiler. Sem isso, usa o WMS do SICAR (parcelas em fundo branco, sem chave) |

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já são injetados automaticamente nas Edge Functions — usados para o log/dedup.

---

## PASSO 3 — Deploy da Edge Function

```bash
cd "C:\Users\ENGENHARIA\Desktop\jm-saas"

npx supabase login
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```

A URL do webhook será:
```
https://zzjizqiafnnuqmrkhjqj.supabase.co/functions/v1/whatsapp-webhook
```

---

## PASSO 4 — Cadastrar webhook no Meta

1. Acesse: https://developers.facebook.com/apps → seu app → WhatsApp → Configuração
2. Em **Webhooks**, clique em **Configurar**
3. URL de callback:
   ```
   https://zzjizqiafnnuqmrkhjqj.supabase.co/functions/v1/whatsapp-webhook
   ```
4. Token de verificação: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
5. Clique em **Verificar e salvar**
6. Ative o campo **messages** em "Campos do webhook"

---

## PASSO 5 — Token permanente (produção)

O token temporário expira em 24h. Para gerar um permanente:

1. Acesse: https://developers.facebook.com/apps → seu app
2. Vá em **Configurações → Avançado → Tokens de acesso do sistema**
3. Ou use: https://business.facebook.com → Configurações → Usuários do sistema
4. Crie um **Usuário do sistema** com permissão `whatsapp_business_messaging`
5. Gere o token e cole em `WHATSAPP_TOKEN` no Supabase

---

## PASSO 6 — Testar localmente com ngrok

```bash
# Terminal 1 — iniciar Edge Function localmente
npx supabase functions serve whatsapp-webhook --env-file .env.whatsapp

# Terminal 2 — expor porta 54321 via ngrok
ngrok http 54321

# Copie a URL do ngrok (ex: https://abc123.ngrok.io)
# No Meta, configure o webhook como:
# https://abc123.ngrok.io/functions/v1/whatsapp-webhook
```

Crie `.env.whatsapp` (não commitar!) copiando `.env.whatsapp.example` e preenchendo os valores reais.

---

## PASSO 7 — Adicionar número em produção

O número de teste só funciona com números pré-aprovados. Para usar seu número real:

1. Meta for Developers → WhatsApp → Números de telefone
2. Clique em **Adicionar número de telefone**
3. Siga o processo de verificação via SMS ou chamada
4. Após aprovação, atualize `WHATSAPP_PHONE_ID` no Supabase

---

## Comandos de teste rápido

```bash
# Ver logs em tempo real
npx supabase functions logs whatsapp-webhook --tail

# Verificar se o webhook responde ao GET (verificação Meta)
curl "https://zzjizqiafnnuqmrkhjqj.supabase.co/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=SEU_TOKEN&hub.challenge=TESTE123"
# Deve retornar: TESTE123
```

---

## Fluxo do usuário final

1. Cliente salva o número da JM no WhatsApp
2. Envia qualquer mensagem → recebe instruções automáticas
3. Envia **localização** → recebe município, área, imóveis CAR e link de plantas
4. Pode acessar o mapa completo pelo link enviado

---

## Arquivos

```
supabase/functions/
  _shared/
    geo.ts              ← município + CAR + SIGEF + plantas + IBAMA (server-side)
    whatsapp.ts         ← envio (texto/imagem) + formatação das respostas
  whatsapp-webhook/
    index.ts            ← webhook: verify + roteador de comandos + dedup/log
migration-whatsapp.sql  ← tabela whatsapp_logs (rodar no Supabase)
.env.whatsapp.example   ← variáveis necessárias
```

## Robustez incluída

- **Idempotência**: `whatsapp_logs.wa_message_id` é único → reentregas do Meta são ignoradas (não responde duas vezes).
- **Rate limit**: máx. 12 mensagens/minuto por número (anti-flood).
- **Assinatura HMAC**: se `WHATSAPP_APP_SECRET` configurado, valida `x-hub-signature-256`.
- **Cache**: municípios e base SIGEF ficam em memória entre invocações (resposta rápida).
- **Degradação graciosa**: se a imagem do mapa falhar, o relatório de texto é enviado mesmo assim.
- **Anti-injeção**: código CAR validado por regex estrita antes do CQL_FILTER do WFS.
