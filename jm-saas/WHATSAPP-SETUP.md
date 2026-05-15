# JM MapStudio — Integração WhatsApp (Meta Cloud API)

## Como funciona

```
Cliente envia localização no WhatsApp
        ↓
Meta → POST https://...supabase.co/functions/v1/whatsapp-webhook
        ↓
Edge Function extrai lat/lon
        ↓
consultarCoordenada(lat, lon)  → município + imóveis CAR
        ↓
sendText(from, resposta)       → resposta formatada ao cliente
```

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

## Arquivos criados

```
supabase/functions/
  _shared/
    geo.ts              ← consulta município + CAR (server-side)
    whatsapp.ts         ← envio de mensagens via Meta API
  whatsapp-webhook/
    index.ts            ← webhook principal (GET + POST)
.env.whatsapp.example   ← variáveis necessárias
```
