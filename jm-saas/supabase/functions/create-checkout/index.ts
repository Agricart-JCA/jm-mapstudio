// ================================================================
// Supabase Edge Function: create-checkout
// Cria sessão de pagamento no Stripe e retorna a URL
// ================================================================
// Deploy: supabase functions deploy create-checkout
// Env vars: STRIPE_SECRET_KEY
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const ALLOWED_ORIGINS = [
  'https://jm-saas.vercel.app',
  'https://agricart-jca.github.io',
  'http://localhost:3456',
]
function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
}

serve(async (req) => {
  const CORS = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const { priceId, successUrl, cancelUrl, metodo } = body

    if (!priceId) throw new Error('priceId obrigatório')

    // Autenticação obrigatória
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
    )
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) throw new Error('Autenticação necessária')

    const usePix = metodo === 'pix'

    const params: Stripe.Checkout.SessionCreateParams = usePix
      ? {
          // PIX = pagamento único (1 mês de acesso)
          mode: 'payment',
          payment_method_types: ['pix'],
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: successUrl || `${req.headers.get('origin')}?checkout=success`,
          cancel_url:  cancelUrl  || `${req.headers.get('origin')}?checkout=cancel`,
          locale: 'pt-BR',
          payment_intent_data: { description: 'JM MapStudio — Acesso Mensal via PIX' },
        }
      : {
          // Cartão = assinatura recorrente
          mode: 'subscription',
          payment_method_types: ['card'],
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: successUrl || `${req.headers.get('origin')}?checkout=success`,
          cancel_url:  cancelUrl  || `${req.headers.get('origin')}?checkout=cancel`,
          locale: 'pt-BR',
          allow_promotion_codes: true,
          billing_address_collection: 'auto',
          phone_number_collection: { enabled: true },
        }

    // Pré-preenche email se usuário logado
    if (user?.email) params.customer_email = user.email

    const session = await stripe.checkout.sessions.create(params)

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    const msg = err?.message || String(err)
    console.error('[create-checkout] erro:', msg)
    const safe = msg.startsWith('priceId') || msg.startsWith('Autenticação') ? msg : 'Erro ao processar pagamento'
    return new Response(JSON.stringify({ error: safe }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
