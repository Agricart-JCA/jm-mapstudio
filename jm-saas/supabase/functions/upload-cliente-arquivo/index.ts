// ================================================================
// Supabase Edge Function: upload-cliente-arquivo
// Admin/operador envia um arquivo (PDF, KML...) para um cliente específico
// → salva no Google Drive → registra em cliente_arquivos
// ================================================================
// Deploy: supabase functions deploy upload-cliente-arquivo
// Env vars: SUPABASE_SERVICE_ROLE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON (já configuradas)
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = ['https://jm-saas.vercel.app','https://agricart-jca.github.io','http://localhost:3456']
function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
}

const MAX_MB    = 20
const FOLDER_ID = '1JPWw_s4-6pTHI8bevZVO7HIjSRAy-PvV'

// ── Google Service Account → Access Token ─────────────────────
async function getGoogleToken(): Promise<string> {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurado')
  const sa = JSON.parse(raw)

  const now = Math.floor(Date.now() / 1000)
  const header  = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss:  sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp:  now + 3600,
    iat:  now,
  }

  const b64url = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const sigInput = `${b64url(header)}.${b64url(payload)}`

  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\n/g, '')
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  )

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(sigInput)
  )
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwt = `${sigInput}.${sigB64}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Token Google falhou: ' + JSON.stringify(data))
  return data.access_token
}

// ── Upload para o Google Drive ────────────────────────────────
async function uploadToDrive(
  token: string,
  fileName: string,
  bytes: ArrayBuffer,
  mimeType: string
): Promise<{ fileId: string; viewUrl: string }> {
  const metadata = JSON.stringify({ name: fileName, parents: [FOLDER_ID] })

  const form = new FormData()
  form.append('metadata', new Blob([metadata], { type: 'application/json' }))
  form.append('file',     new Blob([bytes],    { type: mimeType }))

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true&includeItemsFromAllDrives=true',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  )
  const data = await res.json()
  if (!data.id) throw new Error('Upload Drive falhou: ' + JSON.stringify(data))

  return {
    fileId:  data.id,
    viewUrl: data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`,
  }
}

// ── Torna o arquivo público (qualquer um com o link pode ver) ──
async function makePublic(token: string, fileId: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
}

serve(async (req) => {
  const CORS = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
    )
    const { data: { user }, error: authErr } = await anonClient.auth.getUser()
    if (authErr || !user) throw new Error('Usuário não autenticado')

    // Admin-only: 'operador' não tem leitura de profiles de terceiros via RLS
    // (só admin_perfis_select em migration-cadastro.sql), então não enxergaria a lista de clientes.
    const { data: profile } = await anonClient
      .from('profiles').select('role').eq('id', user.id).single()
    if (!profile || profile.role !== 'admin')
      throw new Error('Acesso restrito a administradores')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const form      = await req.formData()
    const arquivo   = form.get('arquivo')    as File | null
    const clienteId = (form.get('cliente_id') as string || '').trim()
    const titulo    = (form.get('titulo')     as string || '').trim()
    const tipo      = (form.get('tipo')       as string || 'outro').trim()

    if (!arquivo)    throw new Error('Arquivo obrigatório')
    if (!clienteId)  throw new Error('cliente_id obrigatório')
    if (!titulo)     throw new Error('Título obrigatório')

    const tiposValidos = ['memorial', 'planta', 'relatorio', 'kml', 'outro']
    if (!tiposValidos.includes(tipo)) throw new Error('Tipo inválido')

    // Confirma que o destinatário é mesmo um cliente
    const { data: clientePerfil } = await supabase
      .from('profiles').select('id, role').eq('id', clienteId).single()
    if (!clientePerfil || clientePerfil.role !== 'cliente')
      throw new Error('Cliente não encontrado')

    if (arquivo.size > MAX_MB * 1024 * 1024)
      throw new Error(`Arquivo muito grande. Máximo ${MAX_MB}MB.`)

    const nomeArq = arquivo.name.toLowerCase()
    const allowed = ['application/pdf', 'application/vnd.google-earth.kml+xml', 'application/xml', 'text/xml',
                      'application/zip', 'application/x-zip-compressed']
    if (!allowed.includes(arquivo.type) && !nomeArq.endsWith('.kml') && !nomeArq.endsWith('.zip'))
      throw new Error('Formato não suportado. Use PDF, KML ou ZIP.')

    const bytes = await arquivo.arrayBuffer()
    const hdr   = new Uint8Array(bytes.slice(0, 4))
    const isPDF = hdr[0]===0x25 && hdr[1]===0x50 && hdr[2]===0x44 && hdr[3]===0x46
    const isZIP = hdr[0]===0x50 && hdr[1]===0x4B
    const isKML = nomeArq.endsWith('.kml') || arquivo.type.includes('kml')
    if (!isPDF && !isZIP && !isKML)
      throw new Error('Arquivo inválido. Conteúdo não corresponde ao tipo declarado.')

    const ext  = isZIP ? 'zip' : (isKML ? 'kml' : 'pdf')
    const mime = isZIP ? 'application/zip' : (isKML ? 'application/vnd.google-earth.kml+xml' : 'application/pdf')
    const fileName = `cliente_${clienteId.slice(0, 8)}_${titulo.replace(/\s+/g, '-').substring(0, 40)}_${Date.now()}.${ext}`

    const token = await getGoogleToken()
    const { fileId, viewUrl } = await uploadToDrive(token, fileName, bytes, mime)
    await makePublic(token, fileId)

    const { data: registro, error: dbErr } = await supabase
      .from('cliente_arquivos')
      .insert({
        cliente_id:   clienteId,
        criado_por:   user.id,
        titulo,
        tipo,
        url:          viewUrl,
        storage_path: `drive:${fileId}`,
      })
      .select('id, titulo, tipo, url')
      .single()

    if (dbErr) { console.error('[upload-cliente-arquivo] db:', dbErr.message); throw new Error('Erro ao registrar o arquivo') }

    return new Response(JSON.stringify({ ok: true, ...registro }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    const msg = err?.message || String(err)
    console.error('[upload-cliente-arquivo] erro:', msg)
    const safeMsg = ['Arquivo obrigatório','cliente_id obrigatório','Título obrigatório','Tipo inválido',
      'Cliente não encontrado','Arquivo muito grande','Formato não suportado','Arquivo inválido',
      'Usuário não autenticado','Acesso restrito a administradores','Erro ao registrar o arquivo'].some(s => msg.startsWith(s))
      ? msg : 'Erro interno ao processar upload'
    return new Response(JSON.stringify({ error: safeMsg }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
