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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { priceId, successUrl, cancelUrl } = await req.json()

    if (!priceId) throw new Error('priceId obrigatório')

    // Verificar usuário logado (opcional — permite checkout sem conta)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
    )
    const { data: { user } } = await supabase.auth.getUser()

    const { metodo } = body as { metodo?: string }
    const usePix = metodo === 'pix'

    const params: Stripe.Checkout.SessionCreateParams = usePix
      ? {
          // PIX = pagamento único (1 mês de acesso manual)
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
        }

    // Pré-preenche email se usuário logado
    if (user?.email) params.customer_email = user.email

    const session = await stripe.checkout.sessions.create(params)

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
