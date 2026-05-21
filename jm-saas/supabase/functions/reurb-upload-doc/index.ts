// ================================================================
// Supabase Edge Function: reurb-upload-doc
// Recebe documento (PDF/imagem) → salva no Google Drive →
// registra na tabela reurb_documentos
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = ['https://jm-saas.vercel.app','https://agricart-jca.github.io','http://localhost:3456']
function corsHeaders(req: Request) {
  const origin  = req.headers.get('origin') || ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

const MAX_MB    = 30
// Pasta REURB no Google Drive (usa a mesma de uploads por padrão,
// ou sobrescreva com a env REURB_FOLDER_ID)
const FOLDER_ID = () => Deno.env.get('REURB_FOLDER_ID') || Deno.env.get('DRIVE_FOLDER_ID') || '1JPWw_s4-6pTHI8bevZVO7HIjSRAy-PvV'

// ── Google Service Account → Access Token ─────────────────────
async function getGoogleToken(): Promise<string> {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurado')
  const sa = JSON.parse(raw)

  const now     = Math.floor(Date.now() / 1000)
  const header  = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  }

  const b64url = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')

  const sigInput = `${b64url(header)}.${b64url(payload)}`

  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g,'')
    .replace(/-----END PRIVATE KEY-----/g,'')
    .replace(/\n/g,'')
  const keyBytes  = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig    = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(sigInput))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')

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

// ── Upload para o Google Drive ─────────────────────────────────
async function uploadToDrive(
  token: string, fileName: string, bytes: ArrayBuffer, mimeType: string
): Promise<{ fileId: string; viewUrl: string }> {
  const metadata = JSON.stringify({ name: fileName, parents: [FOLDER_ID()] })
  const form = new FormData()
  form.append('metadata', new Blob([metadata], { type: 'application/json' }))
  form.append('file',     new Blob([bytes],    { type: mimeType }))

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true&includeItemsFromAllDrives=true',
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
  )
  const data = await res.json()
  if (!data.id) throw new Error('Upload Drive falhou: ' + JSON.stringify(data))
  return { fileId: data.id, viewUrl: data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view` }
}

async function makePublic(token: string, fileId: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
}

// ── Handler principal ─────────────────────────────────────────
serve(async (req) => {
  const CORS = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Auth obrigatória — somente admin
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
    )
    const { data: { user }, error: authErr } = await anonClient.auth.getUser()
    if (authErr || !user) throw new Error('Usuário não autenticado')

    // Verifica role admin
    const { data: profile } = await anonClient
      .from('profiles').select('role').eq('id', user.id).single()
    if (!profile || profile.role !== 'admin') throw new Error('Acesso restrito a administradores')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const form       = await req.formData()
    const arquivo    = form.get('arquivo')    as File | null
    const projetoId  = (form.get('projeto_id')  as string || '').trim()
    const loteId     = (form.get('lote_id')     as string || '').trim() || null
    const tipo       = (form.get('tipo')        as string || 'outro').trim()
    const nomeDoc    = (form.get('nome')        as string || '').trim()

    if (!arquivo)   throw new Error('Arquivo obrigatório')
    if (!projetoId) throw new Error('projeto_id obrigatório')

    const tiposValidos = ['planta','memorial','imagem','certidao','outro']
    if (!tiposValidos.includes(tipo)) throw new Error('Tipo inválido')

    if (arquivo.size > MAX_MB * 1024 * 1024)
      throw new Error(`Arquivo muito grande. Máximo ${MAX_MB}MB.`)

    const allowed = ['application/pdf','image/jpeg','image/png','image/webp','image/tiff','image/gif']
    if (!allowed.includes(arquivo.type))
      throw new Error('Formato não suportado. Use PDF, JPG, PNG ou TIFF.')

    // Valida magic bytes
    const bytes = await arquivo.arrayBuffer()
    const hdr   = new Uint8Array(bytes.slice(0, 5))
    const isPDF  = hdr[0]===0x25 && hdr[1]===0x50 && hdr[2]===0x44 && hdr[3]===0x46
    const isJPG  = hdr[0]===0xFF && hdr[1]===0xD8
    const isPNG  = hdr[0]===0x89 && hdr[1]===0x50 && hdr[2]===0x4E && hdr[3]===0x47
    const isTIFF = (hdr[0]===0x49&&hdr[1]===0x49)||(hdr[0]===0x4D&&hdr[1]===0x4D)
    const isGIF  = hdr[0]===0x47 && hdr[1]===0x49 && hdr[2]===0x46
    const isWebP = hdr[0]===0x52 && hdr[1]===0x49  // RIFF
    if (!isPDF && !isJPG && !isPNG && !isTIFF && !isGIF && !isWebP)
      throw new Error('Arquivo inválido. Conteúdo não corresponde ao tipo declarado.')

    // Verifica projeto existe
    const { data: proj, error: projErr } = await supabase
      .from('reurb_projetos').select('id,nome,municipio').eq('id', projetoId).single()
    if (projErr || !proj) throw new Error('Projeto REURB não encontrado')

    // Monta nome do arquivo
    const ext      = arquivo.name.split('.').pop()?.toLowerCase() || 'pdf'
    const projSlug = proj.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,'-').substring(0,30)
    const tipoSlug = tipo
    const ts       = Date.now()
    const fileName = `REURB_${projSlug}_${tipoSlug}_${ts}.${ext}`

    const token = await getGoogleToken()
    const { fileId, viewUrl } = await uploadToDrive(token, fileName, bytes, arquivo.type)
    await makePublic(token, fileId)

    // Registra na tabela
    const { data: doc, error: dbErr } = await supabase
      .from('reurb_documentos')
      .insert({
        projeto_id:    projetoId,
        lote_id:       loteId,
        tipo,
        nome:          nomeDoc || arquivo.name,
        url:           viewUrl,
        storage_path:  `drive:${fileId}`,
        tamanho_bytes: arquivo.size,
        criado_por:    user.id,
      })
      .select('id,nome,tipo,url')
      .single()

    if (dbErr) { console.error('[reurb-upload-doc] db:', dbErr.message); throw new Error('Erro ao registrar documento') }

    return new Response(JSON.stringify({
      ok:   true,
      doc_id:    doc.id,
      nome:      doc.nome,
      tipo:      doc.tipo,
      url:       doc.url,
      drive_url: viewUrl,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (err) {
    const msg = err?.message || String(err)
    console.error('[reurb-upload-doc] erro:', msg)
    const safe = [
      'Arquivo obrigatório','projeto_id obrigatório','Tipo inválido',
      'Arquivo muito grande','Formato não suportado','Arquivo inválido',
      'Usuário não autenticado','Acesso restrito','Projeto REURB não encontrado',
      'Erro ao registrar documento'
    ].some(s => msg.startsWith(s)) ? msg : 'Erro interno ao processar upload'
    return new Response(JSON.stringify({ error: safe }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
