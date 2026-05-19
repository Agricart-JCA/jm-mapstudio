// ================================================================
// Supabase Edge Function: upload-planta
// Recebe PDF/imagem, salva no Storage, registra na tabela plantas
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BUCKET = 'plantas-pdf'
const MAX_MB = 20

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Auth obrigatória
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
    )
    const { data: { user }, error: authErr } = await anonClient.auth.getUser()
    if (authErr || !user) throw new Error('Usuário não autenticado')

    const form = await req.formData()

    const arquivo   = form.get('arquivo')   as File | null
    const titulo    = (form.get('titulo')   as string || '').trim()
    const municipio = (form.get('municipio')as string || '').trim()
    const bairro    = (form.get('bairro')   as string || '').trim()
    const descricao = (form.get('descricao')as string || '').trim()
    const tipo      = (form.get('tipo')     as string || 'planta').trim()
    const dataAprox = (form.get('data_aproximada') as string || '').trim()

    if (!arquivo)   throw new Error('Arquivo obrigatório')
    if (!titulo)    throw new Error('Título obrigatório')
    if (!municipio) throw new Error('Município obrigatório')

    // Valida tamanho
    if (arquivo.size > MAX_MB * 1024 * 1024)
      throw new Error(`Arquivo muito grande. Máximo ${MAX_MB}MB.`)

    // Valida tipo
    const allowed = ['application/pdf','image/jpeg','image/png','image/webp','image/tiff']
    if (!allowed.includes(arquivo.type))
      throw new Error('Formato não suportado. Use PDF, JPG, PNG ou TIFF.')

    // Nome único no storage
    const ext = arquivo.name.split('.').pop()?.toLowerCase() || 'pdf'
    const path = `${municipio.toLowerCase().replace(/\s+/g,'-')}/${user.id}/${Date.now()}.${ext}`

    // Upload para o Storage
    const bytes = await arquivo.arrayBuffer()
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: arquivo.type, upsert: false })
    if (upErr) throw new Error('Erro no upload: ' + upErr.message)

    // URL pública
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
    const pdfUrl = urlData.publicUrl

    // Registra na tabela plantas
    const { data: planta, error: dbErr } = await supabase
      .from('plantas')
      .insert({
        titulo,
        descricao,
        municipio,
        bairro:          bairro || null,
        tipo,
        data_aproximada: dataAprox || null,
        pdf_url:         pdfUrl,
        storage_path:    path,
        contribuidor_id: user.id,
        status:          'pendente',
      })
      .select('id, titulo, municipio, status')
      .single()

    if (dbErr) {
      // Remove o arquivo se falhou o registro
      await supabase.storage.from(BUCKET).remove([path])
      throw new Error('Erro ao registrar: ' + dbErr.message)
    }

    return new Response(JSON.stringify({
      ok: true,
      planta_id: planta.id,
      titulo:    planta.titulo,
      municipio: planta.municipio,
      status:    planta.status,
      msg:       'Planta enviada com sucesso! Será revisada em até 48h. Você receberá acesso gratuito após aprovação.',
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (err) {
    const msg = err?.message || String(err)
    console.error('[upload-planta] erro:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
