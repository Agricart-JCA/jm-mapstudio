// ================================================================
// Supabase Edge Function: invite-user
// Admin envia convite por email para novo usuário (sem Stripe)
// ================================================================
// Deploy: supabase functions deploy invite-user
// Env vars: SUPABASE_SERVICE_ROLE_KEY (automático)
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = ['https://jm-saas.vercel.app','https://agricart-jca.github.io','http://localhost:3456']
function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
}

serve(async (req) => {
  const CORS = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Verificar autenticação
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Não autorizado', { status: 401, headers: CORS })

  // Verificar se é admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return new Response('Sem permissão', { status: 403, headers: CORS })
  }

  try {
    const { email, name, role } = await req.json()
    if (!email || !name) throw new Error('Email e nome são obrigatórios')

    const validRoles = ['operador', 'visualizador', 'admin']
    const userRole = validRoles.includes(role) ? role : 'operador'

    // Usar service role para criar convite
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { name, role: userRole }
    })
    if (error) throw error

    // Atualizar perfil com role correto
    await adminClient.from('profiles')
      .update({ name, role: userRole })
      .eq('id', data.user.id)

    return new Response(JSON.stringify({ success: true, userId: data.user.id }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('[invite-user] erro:', err.message)
    return new Response(JSON.stringify({ error: 'Erro ao processar convite' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
