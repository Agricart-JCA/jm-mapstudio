// ================================================================
// Supabase Edge Function: activate-trial
// Ativa 7 dias gratuitos para o usuário autenticado
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TRIAL_DAYS = 30

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Verificar usuário autenticado
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
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

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        status: 'trial',
        trial_expires_at: trialExpires,
        plan_name: 'Trial 7 dias',
      })
      .eq('id', user.id)

    if (updateErr) throw new Error('Erro ao ativar trial: ' + updateErr.message)

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
