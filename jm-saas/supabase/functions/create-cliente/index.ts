// ================================================================
// Supabase Edge Function: create-cliente
// Admin cria login de cliente com senha pronta (sem e-mail de convite)
// ================================================================
// Deploy: supabase functions deploy create-cliente
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

// Alfabeto sem caracteres ambíguos (sem 0/O, 1/l/I)
const PASS_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
function gerarSenha(tamanho = 12): string {
  const bytes = new Uint8Array(tamanho)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => PASS_ALPHABET[b % PASS_ALPHABET.length]).join('')
}

serve(async (req) => {
  const CORS = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers: CORS })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Sem permissão' }), { status: 403, headers: CORS })
  }

  try {
    const { email, name, phone } = await req.json()
    if (!email || !name) throw new Error('Email e nome são obrigatórios')

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const senha = gerarSenha()

    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { name, role: 'cliente' },
    })
    if (error) throw error

    await adminClient.from('profiles')
      .update({ name, role: 'cliente', status: 'active', phone: phone || null })
      .eq('id', data.user.id)

    return new Response(JSON.stringify({ success: true, userId: data.user.id, email, password: senha }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('[create-cliente] erro:', err.message)
    const msg = (err?.message || '').toLowerCase().includes('already been registered')
      ? 'Já existe uma conta com esse e-mail'
      : 'Erro ao criar cliente'
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
