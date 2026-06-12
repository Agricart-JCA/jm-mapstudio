// ─────────────────────────────────────────────────────────────
// whatsapp-webhook/index.ts
// Supabase Edge Function — webhook Meta WhatsApp Cloud API
// Consulta fundiária do RJ via WhatsApp: CAR · SIGEF · Plantas/PAL · IBAMA
//
// Env vars (Supabase → Edge Functions → Secrets):
//   WHATSAPP_TOKEN         — token de acesso permanente (Meta)
//   WHATSAPP_PHONE_ID      — Phone Number ID (Meta)
//   WHATSAPP_VERIFY_TOKEN  — token de verificação (você define)
//   WHATSAPP_APP_SECRET    — (opcional) valida assinatura HMAC do Meta
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — injetados automaticamente
// ─────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  consultarCoordenada, buscarPorCodigoCAR, buscarSIGEF, findPlantasMunicipio,
} from '../_shared/geo.ts';
import {
  sendText, sendImage, markRead, mapImageUrl,
  msgBoasVindas, formatarRelatorio, formatarRelatorioCAR,
  formatarRelatorioSIGEF, formatarPlantas,
} from '../_shared/whatsapp.ts';

const MAP_BASE = 'https://jm-saas.vercel.app';

// ══ Dedup + log (tabela whatsapp_logs, via service role) ══════
const SB_URL  = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Insere o log; retorna false se a mensagem já foi processada (idempotência).
async function registrarMensagem(waId: string, from: string, tipo: string, conteudo: string): Promise<boolean> {
  if (!SB_URL || !SB_KEY) return true; // sem credenciais → não bloqueia
  try {
    const res = await fetch(`${SB_URL}/rest/v1/whatsapp_logs`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({ wa_message_id: waId, from_phone: from, tipo, conteudo: conteudo.slice(0, 280) }),
    });
    if (res.status === 409) return false; // conflito = duplicada (já processada)
    return true;
  } catch { return true; }
}

// Rate limit simples: nº de mensagens do telefone nos últimos 60s
async function excedeuLimite(from: string, max = 12): Promise<boolean> {
  if (!SB_URL || !SB_KEY) return false;
  try {
    const desde = new Date(Date.now() - 60_000).toISOString();
    const res = await fetch(
      `${SB_URL}/rest/v1/whatsapp_logs?from_phone=eq.${encodeURIComponent(from)}&created_at=gte.${desde}&select=id`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' } },
    );
    const range = res.headers.get('content-range') || '';
    const total = parseInt(range.split('/')[1] || '0', 10);
    return total > max;
  } catch { return false; }
}

// ── Valida assinatura HMAC-SHA256 do Meta ─────────────────────
async function validateSignature(req: Request, rawBody: Uint8Array): Promise<boolean> {
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET');
  if (!appSecret) {
    console.warn('[WA] WHATSAPP_APP_SECRET não configurado — assinatura ignorada');
    return true;
  }
  const sigHeader = req.headers.get('x-hub-signature-256') ?? '';
  if (!sigHeader.startsWith('sha256=')) return false;
  const expected = sigHeader.slice(7);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, rawBody);
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === expected;
}

// ── GET — verificação Meta ────────────────────────────────────
function handleVerify(req: Request): Response {
  const url       = new URL(req.url);
  const mode      = url.searchParams.get('hub.mode');
  const token     = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected  = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';
  if (mode === 'subscribe' && token === expected && challenge) {
    console.log('[WA] Webhook verificado');
    return new Response(challenge, { status: 200 });
  }
  console.warn('[WA] Falha na verificação');
  return new Response('Forbidden', { status: 403 });
}

// ── Extrai mensagens do payload Meta ─────────────────────────
interface WaMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  location?: { latitude: number; longitude: number };
}

function extractMessages(body: unknown): WaMessage[] {
  try {
    const entry   = (body as Record<string, unknown>).entry as unknown[];
    const changes = (entry?.[0] as Record<string, unknown>)?.changes as unknown[];
    const value   = (changes?.[0] as Record<string, unknown>)?.value as Record<string, unknown>;
    return (value?.messages as WaMessage[]) ?? [];
  } catch { return []; }
}

// ══ Roteador de comandos de TEXTO ═════════════════════════════
const RE_CAR   = /(?:CAR\s+)?([A-Z]{2}-\d{7}-[A-Z0-9]{12,})/i;
const RE_SIGEF = /^(?:SIGEF|PARCELA)\s+(.+)$/i;
const RE_PLANTA= /^(?:PLANTAS?|PAL)\s+(.+)$/i;
const SAUDACOES = ['ajuda','help','oi','olá','ola','menu','inicio','início','start','bom dia','boa tarde','boa noite'];

async function tratarTexto(from: string, texto: string): Promise<void> {
  const t = texto.trim();
  const lower = t.toLowerCase();

  // Boas-vindas / menu / opções numéricas
  if (SAUDACOES.includes(lower) || lower === '0') {
    await sendText(from, msgBoasVindas());
    return;
  }
  if (lower === '1') { await sendText(from, '🌱 *Consulta CAR*\nDigite o código:\n_Ex: CAR RJ-3304557-XXXXXXXXXXXX_'); return; }
  if (lower === '2') { await sendText(from, '🏛 *Consulta SIGEF*\nDigite o código, código do imóvel (13 díg.) ou matrícula:\n_Ex: SIGEF 5120100113558_'); return; }
  if (lower === '3') { await sendText(from, '🗺 *Consulta de Plantas/PAL*\nDigite o município:\n_Ex: PLANTA Seropédica_'); return; }

  // SIGEF (precisa vir antes do CAR genérico)
  const mSigef = t.match(RE_SIGEF);
  if (mSigef) {
    const termo = mSigef[1].trim();
    await sendText(from, `🏛 Buscando *${termo}* na base SIGEF/RJ...`);
    const parcela = await buscarSIGEF(termo);
    const linkMapa = parcela?.centroide
      ? `${MAP_BASE}?lat=${parcela.centroide.lat.toFixed(6)}&lon=${parcela.centroide.lon.toFixed(6)}`
      : undefined;
    if (parcela?.centroide) {
      await sendImage(from, mapImageUrl(parcela.centroide.lat, parcela.centroide.lon, 15),
        `🏛 ${parcela.nome || 'Parcela SIGEF'} · ${parcela.area}`);
    }
    await sendText(from, formatarRelatorioSIGEF({ termo, parcela, linkMapa }));
    return;
  }

  // Plantas / PAL por município
  const mPlanta = t.match(RE_PLANTA);
  if (mPlanta) {
    const mun = mPlanta[1].trim();
    await sendText(from, `🗺 Buscando plantas de *${mun}*...`);
    const plantas = await findPlantasMunicipio(mun);
    await sendText(from, formatarPlantas(mun, plantas));
    return;
  }

  // CAR por código
  const mCar = t.match(RE_CAR);
  if (mCar) {
    const codigo = mCar[1].toUpperCase();
    await sendText(from, `🌱 Buscando imóvel *${codigo}* no SICAR...`);
    try {
      const resultado = await buscarPorCodigoCAR(codigo);
      const linkMapa = resultado.centroide
        ? `${MAP_BASE}?lat=${resultado.centroide.lat.toFixed(6)}&lon=${resultado.centroide.lon.toFixed(6)}`
        : undefined;
      if (resultado.centroide) {
        await sendImage(from, mapImageUrl(resultado.centroide.lat, resultado.centroide.lon, 15),
          `🌱 ${codigo}`);
      }
      await sendText(from, formatarRelatorioCAR({ codigo, ...resultado, linkMapa }));
    } catch {
      await sendText(from, `❌ Código CAR inválido. Formato: RJ-XXXXXXX-XXXXXXXXXXXX`);
    }
    return;
  }

  // Nada reconhecido
  await sendText(from,
    '🤔 Não entendi. Você pode:\n\n' +
    '📍 Enviar sua *localização*\n' +
    '🌱 _CAR + código_\n' +
    '🏛 _SIGEF + código/matrícula_\n' +
    '🗺 _PLANTA + município_\n\n' +
    'Ou digite *ajuda* para o menu.',
  );
}

// ══ Localização → relatório completo + imagem ═════════════════
async function tratarLocalizacao(from: string, lat: number, lon: number): Promise<void> {
  await sendText(from, '⏳ Consultando dados fundiários do ponto... aguarde.');
  try {
    // Imagem do mapa primeiro (feedback visual imediato)
    await sendImage(from, mapImageUrl(lat, lon, 15),
      `📍 ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    const r = await consultarCoordenada(lat, lon);
    await sendText(from, formatarRelatorio({
      lat, lon,
      municipio: r.municipio, imoveis: r.imoveis, sigef: r.sigef,
      embargos: r.embargos, plantas: r.plantas,
      temPlantas: r.temPlantas, linkPlantas: r.linkPlantas, linkMapa: r.linkMapa,
    }));
  } catch (err) {
    console.error('[WA] Erro consulta localização:', err);
    await sendText(from, '❌ Erro ao processar sua localização. Tente novamente em instantes.');
  }
}

// ── POST — mensagens recebidas ────────────────────────────────
async function handlePost(req: Request): Promise<Response> {
  const rawBody = new Uint8Array(await req.arrayBuffer());
  if (!await validateSignature(req, rawBody)) {
    console.warn('[WA] Assinatura inválida — rejeitada');
    return new Response('Forbidden', { status: 403 });
  }

  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(rawBody)); }
  catch { return new Response('Bad Request', { status: 400 }); }

  const messages = extractMessages(body);

  for (const msg of messages) {
    const from = msg.from;
    const conteudo = msg.type === 'location'
      ? `${msg.location?.latitude},${msg.location?.longitude}`
      : (msg.text?.body ?? '');

    // Idempotência: ignora reentregas do Meta
    const novo = await registrarMensagem(msg.id, from, msg.type, conteudo);
    if (!novo) { console.log('[WA] Mensagem duplicada ignorada:', msg.id); continue; }

    await markRead(msg.id);

    // Rate limit anti-flood
    if (await excedeuLimite(from)) {
      await sendText(from, '⏳ Muitas consultas seguidas. Aguarde um minuto e tente de novo.');
      continue;
    }

    try {
      if (msg.type === 'location' && msg.location) {
        await tratarLocalizacao(from, msg.location.latitude, msg.location.longitude);
      } else if (msg.type === 'text') {
        await tratarTexto(from, msg.text?.body ?? '');
      } else {
        await sendText(from, 'Envie sua *localização* 📍 ou digite *ajuda* para ver as consultas.');
      }
    } catch (err) {
      console.error('[WA] Erro ao tratar mensagem:', err);
      await sendText(from, '❌ Ocorreu um erro. Tente novamente.');
    }
  }

  return new Response('OK', { status: 200 });
}

// ── Entry point ───────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'GET')  return handleVerify(req);
  if (req.method === 'POST') return handlePost(req);
  return new Response('Method Not Allowed', { status: 405 });
});
