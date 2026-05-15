# JM MapStudio — Deploy Urgente (compradores sem acesso)

## DIAGNÓSTICO

**O que aconteceu:**
- Admin recebeu e-mail de nova venda ✅
- Compradores não receberam e-mail ❌

**Por quê:**
1. Webhook antigo não enviava e-mail para usuários já existentes
2. `RESEND_API_KEY` possivelmente não configurada como secret da Edge Function
3. `listUsers()` sem paginação falhava silenciosamente para bases com mais de 50 usuários

---

## PASSO 1 — Descobrir sua SERVICE_ROLE_KEY

1. Abra: https://supabase.com/dashboard/project/zzjizqiafnnuqmrkhjqj/settings/api
2. Copie a chave **service_role** (começa com `eyJ...`)
3. **NUNCA cole essa chave no HTML ou em repositório público**

---

## PASSO 2 — Configurar secrets da Edge Function

Abra: https://supabase.com/dashboard/project/zzjizqiafnnuqmrkhjqj/settings/functions

Adicione ou verifique cada variável:

| Variável | Valor |
|----------|-------|
| `STRIPE_SECRET_KEY` | `sk_live_...` (ou `sk_test_...`) — do painel Stripe → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` — do painel Stripe → Webhooks → seu endpoint → Signing secret |
| `RESEND_API_KEY` | `re_...` (resend.com → API Keys) |
| `ADMIN_EMAIL` | `juancarlos.agricart@gmail.com` |
| `APP_URL` | `https://agricart-jca.github.io/jm-mapstudio` |

> Clique em **Save** após adicionar cada variável.

---

## PASSO 3 — Fazer deploy do webhook atualizado

Abra o **Git Bash** dentro da pasta `C:\Users\ENGENHARIA\Desktop\jm-saas`:

```bash
# Autenticar (se ainda não estiver logado)
npx supabase login

# Confirmar que está vinculado ao projeto certo
npx supabase projects list

# Deploy do webhook corrigido
npx supabase functions deploy stripe-webhook --no-verify-jwt

# Deploy do checkout (por garantia)
npx supabase functions deploy create-checkout
```

> Aguarde a mensagem: `Deployed Function stripe-webhook`

---

## PASSO 4 — Verificar URL do Webhook no Stripe

1. Abra: https://dashboard.stripe.com/webhooks
2. Verifique se existe endpoint apontando para:
   ```
   https://zzjizqiafnnuqmrkhjqj.supabase.co/functions/v1/stripe-webhook
   ```
3. Se não existir, clique **"Add endpoint"**:
   - URL: `https://zzjizqiafnnuqmrkhjqj.supabase.co/functions/v1/stripe-webhook`
   - Eventos:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`
4. Após criar, clique no endpoint → copie o **Signing secret** (`whsec_...`)
5. Cole esse valor na variável `STRIPE_WEBHOOK_SECRET` no Passo 2

---

## PASSO 5 — Reenviar acesso aos 2 compradores (URGENTE)

1. Abra `reenviar-acesso.ps1` em um editor de texto
2. Preencha:
   - `SERVICE_ROLE_KEY` — copiada no Passo 1
   - `compradores` — e-mails e nomes reais dos 2 compradores
3. Abra o PowerShell como Administrador
4. Execute:
   ```powershell
   cd "C:\Users\ENGENHARIA\Desktop\jm-saas"
   .\reenviar-acesso.ps1
   ```
5. Verifique o resumo final — anote as senhas provisórias geradas

> Os compradores receberão o e-mail imediatamente.

---

## PASSO 6 — Testar com Stripe CLI

```bash
# Instalar Stripe CLI (se não tiver)
# Baixe em: https://stripe.com/docs/stripe-cli

# Login no Stripe CLI
stripe login

# Disparar evento de teste
stripe trigger checkout.session.completed

# Verificar logs da Edge Function em tempo real
npx supabase functions logs stripe-webhook --tail
```

---

## PASSO 7 — Verificar logs após novo pagamento

No painel Supabase:
- **Edge Functions → stripe-webhook → Logs**

Você verá mensagens como:
```
[Checkout] Email: cliente@email.com | Sub: sub_xxx | Customer: cus_xxx
[Auth] Criando novo usuário para: cliente@email.com
[Auth] ✅ Novo usuário criado: uuid-xxx
[DB] Perfil salvo para userId: uuid-xxx
[Email] ✅ Enviado para cliente@email.com — ID: resend-id-xxx
[Email] ✅ Enviado para juancarlos.agricart@gmail.com — ID: resend-id-xxx
[Checkout] ✅ Concluído para cliente@email.com | Status: criado | Email: enviado
```

Se aparecer `❌` em alguma linha, o log mostrará o motivo exato.

---

## PASSO 8 — Executar migração do banco (se ainda não fez)

No Supabase SQL Editor: https://supabase.com/dashboard/project/zzjizqiafnnuqmrkhjqj/sql/new

Cole e execute o conteúdo de `migration-cadastro.sql`.

---

## Checklist final

- [ ] SERVICE_ROLE_KEY copiada do Supabase
- [ ] Secrets configurados no Supabase (Passo 2)
- [ ] Webhook deployado via CLI (Passo 3)
- [ ] URL do webhook cadastrada no Stripe (Passo 4)
- [ ] Script reenviar-acesso.ps1 executado (Passo 5)
- [ ] Compradores confirmaram recebimento do e-mail
- [ ] Migração do banco executada (Passo 8)
