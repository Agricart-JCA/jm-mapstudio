// ================================================================
// Supabase Edge Function: activate-trial
// Ativa 7 dias gratuitos para o usuário autenticado
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = ['https://jm-saas.vercel.app','https://agricart-jca.github.io','http://localhost:3456']
function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
}

const TRIAL_DAYS = 30

serve(async (req) => {
  const CORS = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Cliente com o token do usuário — SÓ para identificar quem é (não escreve privilégio)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
    )
    // Cliente service_role — a ÚNICA via que grava status/trial (o cliente nunca escreve isso)
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) throw new Error('Usuário não autenticado')

    // Verificar se já tem plano ativo ou trial
    const { data: profile } = await supabase
      .from('profiles')
      .select('status, trial_expires_at')
      .eq('id', user.id)
      .single()

    if (profile?.status === 'active') {
      throw new Error('Você já possui uma assinatura ativa.')
    }

    if (profile?.status === 'trial' && profile?.trial_expires_at) {
      const exp = new Date(profile.trial_expires_at)
      if (exp > new Date()) {
        const dias = Math.ceil((exp.getTime() - Date.now()) / 86400000)
        throw new Error(`Você já tem um trial ativo com ${dias} dia(s) restante(s).`)
      }
    }

    // Ativar trial
    const trialExpires = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const { error: updateErr } = await admin
      .from('profiles')
      .update({
        status: 'trial',
        trial_expires_at: trialExpires,
        plan_name: 'Trial 30 dias',
      })
      .eq('id', user.id)

    if (updateErr) { console.error('[activate-trial] db:', updateErr.message); throw new Error('Erro ao ativar trial') }

    return new Response(
      JSON.stringify({ ok: true, trial_expires_at: trialExpires, days: TRIAL_DAYS }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err?.message || String(err)
    console.error('[activate-trial] erro:', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
