# JM MapStudio — Guia de Instalação SaaS

## O que você vai ter ao final
- Login multiusuário real (e-mail + senha) via Supabase
- Assinaturas Mensal e Anual processadas pelo Stripe
- Novos assinantes ganham conta criada automaticamente
- Painel admin para convidar usuários e mudar perfis

---

## PASSO 1 — Criar conta no Supabase

1. Acesse **supabase.com** → "Start your project" → crie conta com Google
2. Clique **"New project"**
   - Nome: `jm-mapstudio`
   - Senha do banco: guarde em local seguro
   - Região: `South America (São Paulo)`
3. Aguarde ~2 min o projeto inicializar

---

## PASSO 2 — Criar o banco de dados

1. No painel do Supabase, vá em **SQL Editor** → **New query**
2. Cole todo o conteúdo do arquivo `supabase-schema.sql`
3. Clique **Run** (▶)
4. Aguarde a mensagem "Success. No rows returned"

---

## PASSO 3 — Fazer deploy das Edge Functions

> Você precisa da Supabase CLI instalada. Se não tiver:
> ```
> npm install -g supabase
> ```

No terminal, dentro da pasta `jm-saas`:

```bash
supabase login
supabase link --project-ref SEU-PROJECT-REF
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy create-checkout
supabase functions deploy invite-user
```

> O `PROJECT-REF` está na URL do seu projeto: `https://app.supabase.com/project/SEU-PROJECT-REF`

---

## PASSO 4 — Configurar o Stripe

### 4.1 — Criar os produtos
1. Acesse **dashboard.stripe.com** → **Products** → **Add product**
2. Produto 1:
   - Nome: `JM MapStudio — Mensal`
   - Preço: defina o valor (ex: R$ 97,00)
   - Recorrência: Mensal
   - Salve → copie o **Price ID** (começa com `price_`)
3. Produto 2:
   - Nome: `JM MapStudio — Anual`
   - Preço: defina o valor (ex: R$ 970,00)
   - Recorrência: Anual
   - Salve → copie o **Price ID**

### 4.2 — Configurar o Webhook
1. No Stripe: **Developers** → **Webhooks** → **Add endpoint**
2. URL do endpoint:
   ```
   https://SEU-PROJECT-REF.supabase.co/functions/v1/stripe-webhook
   ```
3. Eventos para escutar:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Salve → copie o **Signing secret** (começa com `whsec_`)

---

## PASSO 5 — Configurar variáveis de ambiente no Supabase

No painel do Supabase: **Settings** → **Edge Functions** → **Add new secret**

Adicione estas variáveis:

| Nome | Valor |
|------|-------|
| `STRIPE_SECRET_KEY` | Chave secreta do Stripe (sk_live_... ou sk_test_...) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret do webhook (whsec_...) |

---

## PASSO 6 — Preencher as chaves no arquivo HTML

Abra o `JM-MapStudio.html` e procure o bloco `SUPABASE + STRIPE` (começa na linha ~1180).

Preencha as 4 constantes:

```javascript
const SUPABASE_URL      = 'https://SEU-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...'; // Settings → API → anon public

const STRIPE_PRICE_MENSAL = 'price_...'; // Price ID mensal
const STRIPE_PRICE_ANUAL  = 'price_...'; // Price ID anual

const PRECO_MENSAL = 'R$ 97,00';   // Valor exato que cadastrou
const PRECO_ANUAL  = 'R$ 970,00';  // Valor exato que cadastrou

const CHECKOUT_FN_URL = 'https://SEU-PROJECT-REF.supabase.co/functions/v1/create-checkout';
const INVITE_FN_URL   = 'https://SEU-PROJECT-REF.supabase.co/functions/v1/invite-user';
```

> A `SUPABASE_ANON_KEY` fica em: **Settings → API → Project API keys → anon public**

---

## PASSO 7 — Criar sua conta de administrador

1. No Supabase: **Authentication** → **Users** → **Invite user**
2. Digite seu e-mail: `juancarlos.agricart@gmail.com`
3. Acesse o e-mail → clique no link → defina sua senha
4. No Supabase: **SQL Editor** → Execute:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'juancarlos.agricart@gmail.com');
   ```

---

## PASSO 8 — Publicar no Vercel

1. Faça upload do `JM-MapStudio.html` atualizado no seu projeto do Vercel
2. Se usar a pasta de arquivos estáticos, inclua também o `municipios_rj.geojson` e `plantas.json`
3. Deploy → aguarde publicar

---

## Fluxo do usuário final

```
Cliente acessa o site
       ↓
Tela de login → clica "Assinar agora"
       ↓
Escolhe plano (Mensal ou Anual)
       ↓
Redirecionado para Stripe Checkout (paga)
       ↓
Stripe avisa o Supabase via Webhook
       ↓
Supabase cria conta + registra assinatura
       ↓
Cliente recebe e-mail para definir senha
       ↓
Faz login → acessa o sistema ✓
```

---

## Dúvidas frequentes

**O sistema ainda funciona sem as chaves preenchidas?**
Sim, mas o login vai falhar. Você pode testar o layout sem configurar o backend.

**Como adicionar usuários manualmente (sem Stripe)?**
Use o painel Admin → "Convidar usuário". O sistema envia e-mail com link de acesso.

**Como cancelar a assinatura de um usuário?**
No painel do Stripe → Customers → localize o cliente → Cancel subscription.
O webhook atualiza o status automaticamente e o usuário perde acesso.

**Modo de teste (sem cobrar de verdade)?**
Use as chaves `sk_test_...` do Stripe e acesse stripe.com/docs/testing para cartões de teste.
