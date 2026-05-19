// ─────────────────────────────────────────────────────────────
// whatsapp-webhook/index.ts
// Supabase Edge Function — webhook Meta WhatsApp Cloud API
//
// Env vars necessárias:
//   WHATSAPP_TOKEN        — token de acesso permanente (Meta)
//   WHATSAPP_PHONE_ID     — Phone Number ID (Meta)
//   WHATSAPP_VERIFY_TOKEN — token de verificação (você define)
// ─────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { consultarCoordenada, buscarPorCodigoCAR } from '../_shared/geo.ts';
import {
  sendText, markRead,
  msgBoasVindas, formatarRelatorio, formatarRelatorioCAR,
} from '../_shared/whatsapp.ts';

const MAP_BASE = 'https://agricart-jca.github.io/jm-mapstudio';

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

// ── POST — mensagens recebidas ────────────────────────────────
async function handlePost(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); }
  catch { return new Response('Bad Request', { status: 400 }); }

  const messages = extractMessages(body);

  for (const msg of messages) {
    const from = msg.from;
    await markRead(msg.id);

    // ── LOCALIZAÇÃO ───────────────────────────────────────────
    if (msg.type === 'location' && msg.location) {
      const { latitude: lat, longitude: lon } = msg.location;
      console.log(`[WA] Localização de ${from}: ${lat}, ${lon}`);

      await sendText(from, '⏳ Consultando dados fundiários... aguarde um momento.');

      try {
        const resultado = await consultarCoordenada(lat, lon);
        const resposta  = formatarRelatorio({
          lat, lon,
          municipio:   resultado.municipio,
          imoveis:     resultado.imoveis,
          embargos:    resultado.embargos,
          temPlantas:  resultado.temPlantas,
          linkPlantas: resultado.linkPlantas,
          linkMapa:    resultado.linkMapa,
        });
        await sendText(from, resposta);
      } catch (err) {
        console.error('[WA] Erro consulta:', err);
        await sendText(from, '❌ Erro ao processar sua localização. Tente novamente em instantes.');
      }
      continue;
    }

    // ── TEXTO ─────────────────────────────────────────────────
    if (msg.type === 'text') {
      const texto = (msg.text?.body ?? '').trim();
      const lower = texto.toLowerCase();

      // Ajuda / boas-vindas
      if (['ajuda', 'help', 'oi', 'olá', 'ola', 'menu', 'inicio', 'início', 'start'].includes(lower)) {
        await sendText(from, msgBoasVindas());
        continue;
      }

      // Busca por código CAR: "CAR RJ-..." ou apenas "RJ-..."
      const carMatch = texto.match(/(?:CAR\s+)?([A-Z]{2}-\d{7}-[A-Z0-9]{12,})/i);
      if (carMatch) {
        const codigo = carMatch[1].toUpperCase();
        await sendText(from, `🔎 Buscando imóvel *${codigo}* no SICAR...`);
        try {
          const resultado = await buscarPorCodigoCAR(codigo);
          const linkMapa  = resultado.centroide
            ? `${MAP_BASE}?lat=${resultado.centroide.lat.toFixed(6)}&lon=${resultado.centroide.lon.toFixed(6)}`
            : undefined;
          const resposta  = formatarRelatorioCAR({ codigo, ...resultado, linkMapa });
          await sendText(from, resposta);
        } catch (err) {
          console.error('[WA] Erro busca CAR:', err);
          await sendText(from, `❌ Erro ao buscar o código *${codigo}*. Tente novamente.`);
        }
        continue;
      }

      // Qualquer outro texto
      await sendText(from,
        '📍 Envie sua *localização* para consultar dados fundiários.\n' +
        '🔎 Ou digite o *código CAR* do imóvel.\n\n' +
        'Digite *ajuda* para ver os comandos disponíveis.'
      );
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
