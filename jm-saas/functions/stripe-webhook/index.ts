// ================================================================
// Supabase Edge Function: stripe-webhook
// Recebe eventos do Stripe e atualiza o banco de dados
// ================================================================
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
// Env vars necessárias (Supabase Dashboard → Settings → Edge Functions):
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//   SUPABASE_URL            (automático)
//   SUPABASE_SERVICE_ROLE_KEY (automático)
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const adminClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  const body = await req.text()

  if (!signature) {
    return new Response('Sem assinatura Stripe', { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch (err) {
    console.error('Webhook inválido:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  console.log(`Evento recebido: ${event.type}`)

  try {
    switch (event.type) {

      // ── Checkout concluído: criar/vincular conta ──────────────
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const email = session.customer_email || session.customer_details?.email
        const customerId = session.customer as string
        const subscriptionId = session.subscription as string

        if (!email || !subscriptionId) break

        // Buscar usuário pelo email
        const { data: { users } } = await adminClient.auth.admin.listUsers()
        const existingUser = users.find(u => u.email === email)

        let userId: string

        if (existingUser) {
          userId = existingUser.id
        } else {
          // Criar novo usuário sem senha (receberá email para definir)
          const { data: newUser, error } = await adminClient.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: { stripe_customer_id: customerId }
          })
          if (error) { console.error('Erro ao criar usuário:', error); break }
          userId = newUser.user.id

          // Enviar email para o usuário definir a senha
          await adminClient.auth.admin.generateLink({
            type: 'recovery',
            email,
          })
        }

        // Vincular Stripe customer ao perfil
        await adminClient.from('profiles')
          .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
          .eq('id', userId)

        // Registrar assinatura
        const sub = await stripe.subscriptions.retrieve(subscriptionId)
        await upsertSubscription(sub, userId)
        break
      }

      // ── Assinatura criada ou atualizada ───────────────────────
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const { data: profile } = await adminClient
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', sub.customer as string)
          .single()

        if (profile) await upsertSubscription(sub, profile.id)
        break
      }

      // ── Assinatura cancelada ──────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await adminClient.from('subscriptions')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('id', sub.id)
        break
      }

      // ── Pagamento falhou ──────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        if (invoice.subscription) {
          await adminClient.from('subscriptions')
            .update({ status: 'past_due', updated_at: new Date().toISOString() })
            .eq('id', invoice.subscription as string)
        }
        break
      }
    }
  } catch (err) {
    console.error('Erro ao processar evento:', err)
    return new Response('Erro interno', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' }
  })
})

async function upsertSubscription(sub: Stripe.Subscription, userId: string) {
  const price = sub.items.data[0]?.price
  const planName = price?.recurring?.interval === 'year' ? 'anual' : 'mensal'

  await adminClient.from('subscriptions').upsert({
    id: sub.id,
    user_id: userId,
    status: sub.status,
    price_id: price?.id || '',
    plan_name: planName,
    current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
    stripe_customer_id: sub.customer as string,
    updated_at: new Date().toISOString()
  })
}
