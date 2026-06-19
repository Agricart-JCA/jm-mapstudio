// ─────────────────────────────────────────────────────────────
// whatsapp-webhook/index.ts
// Supabase Edge Function — webhook Meta WhatsApp Cloud API
// Consulta fundiária do RJ: CAR · SIGEF · Plantas/PAL · IBAMA
// Menu guiado por botões + cota grátis (aberto) → assinatura.
//
// Env (Supabase → Edge Functions → Secrets):
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN
//   WHATSAPP_APP_SECRET (opcional), WHATSAPP_COTA_GRATIS (opcional, default 5)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (injetados)
// ─────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  consultarCoordenada, buscarPorCodigoCAR, buscarSIGEF, findPlantasMunicipio,
} from '../_shared/geo.ts';
import {
  sendText, sendImage, markRead, mapImageUrl,
  formatarRelatorio, formatarRelatorioCAR, formatarRelatorioSIGEF, formatarPlantas,
  enviarMenu, enviarPaywall,
} from '../_shared/whatsapp.ts';
import { getSessao, setEstado, verificarAcesso, soDigitos } from '../_shared/sessao.ts';

const MAP_BASE = 'https://jm-saas.vercel.app';

// ══ Dedup + rate limit (whatsapp_logs, service role) ══════════
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

async function registrarMensagem(waId: string, from: string, tipo: string, conteudo: string): Promise<boolean> {
  if (!SB_URL || !SB_KEY) return true;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/whatsapp_logs`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ wa_message_id: waId, from_phone: from, tipo, conteudo: conteudo.slice(0, 280) }),
    });
    return res.status !== 409; // 409 = duplicada
  } catch { return true; }
}

async function excedeuFlood(from: string, max = 15): Promise<boolean> {
  if (!SB_URL || !SB_KEY) return false;
  try {
    const desde = new Date(Date.now() - 60_000).toISOString();
    const res = await fetch(
      `${SB_URL}/rest/v1/whatsapp_logs?from_phone=eq.${encodeURIComponent(from)}&created_at=gte.${desde}&select=id`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' } },
    );
    const total = parseInt((res.headers.get('content-range') || '').split('/')[1] || '0', 10);
    return total > max;
  } catch { return false; }
}

// ── Assinatura HMAC do Meta ───────────────────────────────────
async function validateSignature(req: Request, rawBody: Uint8Array): Promise<boolean> {
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET');
  if (!appSecret) return true;
  const sigHeader = req.headers.get('x-hub-signature-256') ?? '';
  if (!sigHeader.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, rawBody);
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === sigHeader.slice(7);
}

// ── GET — verificação Meta ────────────────────────────────────
function handleVerify(req: Request): Response {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token === (Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '') && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

// ── Extrai mensagens ──────────────────────────────────────────
interface WaMessage {
  id: string; from: string; type: string;
  text?: { body: string };
  location?: { latitude: number; longitude: number };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?:   { id: string; title: string };
  };
}

function extractMessages(body: unknown): WaMessage[] {
  try {
    const entry   = (body as Record<string, unknown>).entry as unknown[];
    const changes = (entry?.[0] as Record<string, unknown>)?.changes as unknown[];
    const value   = (changes?.[0] as Record<string, unknown>)?.value as Record<string, unknown>;
    return (value?.messages as WaMessage[]) ?? [];
  } catch { return []; }
}

// ══ Consultas (com portão de cota) ════════════════════════════
const RE_CAR    = /(?:CAR\s+)?([A-Z]{2}-\d{7}-[A-Z0-9]{12,})/i;
const RE_SIGEF  = /^(?:SIGEF|PARCELA)\s+(.+)$/i;
const RE_PLANTA = /^(?:PLANTAS?|PAL)\s+(.+)$/i;
const SAUDACOES = ['ajuda','help','oi','olá','ola','menu','inicio','início','start','bom dia','boa tarde','boa noite'];

function rodapeCota(restantes: number): string {
  if (restantes < 0) return '';            // assinante
  if (restantes === 0) return '';
  if (restantes <= 2)  return `\n\n🆓 _Restam ${restantes} consulta(s) grátis. Assine para ilimitado: ${MAP_BASE}_`;
  return '';
}

async function consultarCAR(phone: string, codigoRaw: string, restantes: number): Promise<void> {
  const codigo = codigoRaw.toUpperCase();
  await sendText(phone, `🌱 Buscando *${codigo}* no SICAR...`);
  try {
    const r = await buscarPorCodigoCAR(codigo);
    const linkMapa = r.centroide ? `${MAP_BASE}?lat=${r.centroide.lat.toFixed(6)}&lon=${r.centroide.lon.toFixed(6)}` : undefined;
    if (r.centroide) await sendImage(phone, mapImageUrl(r.centroide.lat, r.centroide.lon), `🌱 ${codigo}`);
    await sendText(phone, formatarRelatorioCAR({ codigo, ...r, linkMapa }) + rodapeCota(restantes));
  } catch {
    await sendText(phone, '❌ Código CAR inválido. Formato: RJ-XXXXXXX-XXXXXXXXXXXX');
  }
}

async function consultarSIGEF(phone: string, termo: string, restantes: number): Promise<void> {
  await sendText(phone, `🏛 Buscando *${termo}* na base SIGEF/RJ...`);
  const parcela = await buscarSIGEF(termo);
  const linkMapa = parcela?.centroide ? `${MAP_BASE}?lat=${parcela.centroide.lat.toFixed(6)}&lon=${parcela.centroide.lon.toFixed(6)}` : undefined;
  if (parcela?.centroide) await sendImage(phone, mapImageUrl(parcela.centroide.lat, parcela.centroide.lon), `🏛 ${parcela.nome || 'Parcela SIGEF'}`);
  await sendText(phone, formatarRelatorioSIGEF({ termo, parcela, linkMapa }) + rodapeCota(restantes));
}

async function consultarPlanta(phone: string, mun: string, restantes: number): Promise<void> {
  await sendText(phone, `🗺 Buscando plantas de *${mun}*...`);
  const plantas = await findPlantasMunicipio(mun);
  await sendText(phone, formatarPlantas(mun, plantas) + rodapeCota(restantes));
}

async function consultarLocal(phone: string, lat: number, lon: number, restantes: number): Promise<void> {
  await sendText(phone, '⏳ Consultando dados do ponto... aguarde.');
  try {
    await sendImage(phone, mapImageUrl(lat, lon), `📍 ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    const r = await consultarCoordenada(lat, lon);
    await sendText(phone, formatarRelatorio({
      lat, lon, municipio: r.municipio, imoveis: r.imoveis, sigef: r.sigef,
      embargos: r.embargos, plantas: r.plantas, temPlantas: r.temPlantas,
      linkPlantas: r.linkPlantas, linkMapa: r.linkMapa,
    }) + rodapeCota(restantes));
  } catch (err) {
    console.error('[WA] erro localização:', err);
    await sendText(phone, '❌ Erro ao processar a localização. Tente novamente.');
  }
}

// Executa uma consulta SOMENTE se houver cota/assinatura
async function comCota(phone: string, exec: (restantes: number) => Promise<void>): Promise<void> {
  const a = await verificarAcesso(phone);
  if (!a.liberado) { await enviarPaywall(phone, a.usadas); return; }
  await exec(a.restantes);
}

// ══ Roteador de texto ═════════════════════════════════════════
async function tratarTexto(phone: string, texto: string): Promise<void> {
  const t = texto.trim();
  const lower = t.toLowerCase();

  if (SAUDACOES.includes(lower) || lower === '0') { await setEstado(phone, ''); await enviarMenu(phone); return; }

  // Consome intenção pendente do menu guiado
  const sess = await getSessao(phone);
  if (sess.estado === 'aguard_car')       { await setEstado(phone, ''); await comCota(phone, r => consultarCAR(phone, t, r)); return; }
  if (sess.estado === 'aguard_sigef')     { await setEstado(phone, ''); await comCota(phone, r => consultarSIGEF(phone, t, r)); return; }
  if (sess.estado === 'aguard_municipio') { await setEstado(phone, ''); await comCota(phone, r => consultarPlanta(phone, t, r)); return; }

  // Detecção automática por prefixo/padrão
  const mSigef = t.match(RE_SIGEF);
  if (mSigef) { await comCota(phone, r => consultarSIGEF(phone, mSigef[1].trim(), r)); return; }
  const mPlanta = t.match(RE_PLANTA);
  if (mPlanta) { await comCota(phone, r => consultarPlanta(phone, mPlanta[1].trim(), r)); return; }
  const mCar = t.match(RE_CAR);
  if (mCar) { await comCota(phone, r => consultarCAR(phone, mCar[1], r)); return; }

  // Não reconhecido → menu
  await enviarMenu(phone);
}

// ══ Roteador de botões/lista ══════════════════════════════════
async function tratarInteractive(phone: string, id: string): Promise<void> {
  switch (id) {
    case 'menu_car':
      await setEstado(phone, 'aguard_car');
      await sendText(phone, '🌱 *Consultar CAR*\nDigite o código do imóvel:\n_Ex: RJ-3304557-XXXXXXXXXXXX_');
      break;
    case 'menu_sigef':
      await setEstado(phone, 'aguard_sigef');
      await sendText(phone, '🏛 *Consultar SIGEF*\nDigite o código SIGEF, o código do imóvel (13 díg.) ou a matrícula:\n_Ex: 5120100113558_');
      break;
    case 'menu_plantas':
      await setEstado(phone, 'aguard_municipio');
      await sendText(phone, '🗺 *Plantas / PAL*\nDigite o município:\n_Ex: Seropédica_');
      break;
    case 'assinar':
      await setEstado(phone, '');
      await sendText(phone,
        `⭐ *Assine o JM MapStudio*\n\nConsultas ilimitadas (CAR, SIGEF, plantas) + mapa completo:\n${MAP_BASE}\n\n` +
        `Já é assinante? Cadastre *este número de WhatsApp* no seu perfil (telefone) para liberar aqui.`);
      break;
    case 'menu':
    default:
      await setEstado(phone, '');
      await enviarMenu(phone);
  }
}

// ── POST ──────────────────────────────────────────────────────
async function handlePost(req: Request): Promise<Response> {
  const rawBody = new Uint8Array(await req.arrayBuffer());
  if (!await validateSignature(req, rawBody)) return new Response('Forbidden', { status: 403 });

  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(rawBody)); }
  catch { return new Response('Bad Request', { status: 400 }); }

  for (const msg of extractMessages(body)) {
    const phone = soDigitos(msg.from) || msg.from;
    const resumo = msg.type === 'location' ? `${msg.location?.latitude},${msg.location?.longitude}`
                 : msg.type === 'interactive' ? (msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || '')
                 : (msg.text?.body ?? '');

    // Idempotência (ignora reentregas do Meta)
    if (!await registrarMensagem(msg.id, msg.from, msg.type, resumo)) {
      console.log('[WA] duplicada ignorada:', msg.id); continue;
    }
    await markRead(msg.id);

    if (await excedeuFlood(msg.from)) {
      await sendText(msg.from, '⏳ Muitas mensagens seguidas. Aguarde um minuto.');
      continue;
    }

    try {
      if (msg.type === 'interactive') {
        await tratarInteractive(msg.from, msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || 'menu');
      } else if (msg.type === 'location' && msg.location) {
        await setEstado(phone, '');
        await comCota(msg.from, r => consultarLocal(msg.from, msg.location!.latitude, msg.location!.longitude, r));
      } else if (msg.type === 'text') {
        await tratarTexto(msg.from, msg.text?.body ?? '');
      } else {
        await enviarMenu(msg.from);
      }
    } catch (err) {
      console.error('[WA] erro ao tratar:', err);
      await sendText(msg.from, '❌ Ocorreu um erro. Digite *menu* para recomeçar.');
    }
  }

  return new Response('OK', { status: 200 });
}

serve((req: Request) => {
  if (req.method === 'GET')  return handleVerify(req);
  if (req.method === 'POST') return handlePost(req);
  return new Response('Method Not Allowed', { status: 405 });
});
