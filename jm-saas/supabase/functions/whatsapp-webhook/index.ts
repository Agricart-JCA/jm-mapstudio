// ─────────────────────────────────────────────────────────────
// whatsapp-webhook/index.ts
// Supabase Edge Function — webhook Meta WhatsApp Cloud API
//
// Variáveis de ambiente necessárias (Supabase Secrets):
//   WHATSAPP_TOKEN        — token de acesso permanente (Meta)
//   WHATSAPP_PHONE_ID     — Phone Number ID (Meta)
//   WHATSAPP_VERIFY_TOKEN — token de verificação (você define)
// ─────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { consultarCoordenada } from '../_shared/geo.ts';
import { sendText, markRead, formatarResposta } from '../_shared/whatsapp.ts';

// ── GET — verificação do webhook pelo Meta ────────────────────
function handleVerify(req: Request): Response {
  const url    = new URL(req.url);
  const mode   = url.searchParams.get('hub.mode');
  const token  = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const expected = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';

  if (mode === 'subscribe' && token === expected && challenge) {
    console.log('[WA] Webhook verificado com sucesso');
    return new Response(challenge, { status: 200 });
  }
  console.warn('[WA] Falha na verificação do webhook');
  return new Response('Forbidden', { status: 403 });
}

// ── Extrai mensagem de localização do payload Meta ────────────
interface WaLocation {
  latitude: number;
  longitude: number;
}

interface WaMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  location?: WaLocation;
}

function extractMessages(body: unknown): WaMessage[] {
  try {
    const entry   = (body as Record<string, unknown>).entry as unknown[];
    const changes = (entry?.[0] as Record<string, unknown>)?.changes as unknown[];
    const value   = (changes?.[0] as Record<string, unknown>)?.value as Record<string, unknown>;
    return (value?.messages as WaMessage[]) ?? [];
  } catch {
    return [];
  }
}

// ── POST — mensagens recebidas ────────────────────────────────
async function handlePost(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const messages = extractMessages(body);

  for (const msg of messages) {
    const from = msg.from;

    // Marca como lida imediatamente
    await markRead(msg.id);

    // ── Localização ───────────────────────────────────────────
    if (msg.type === 'location' && msg.location) {
      const { latitude: lat, longitude: lon } = msg.location;
      console.log(`[WA] Localização recebida de ${from}: ${lat}, ${lon}`);

      try {
        await sendText(from,
          '⏳ Consultando dados... aguarde um momento.'
        );

        const resultado = await consultarCoordenada(lat, lon);

        const resposta = formatarResposta({
          lat,
          lon,
          municipio:   resultado.municipio,
          imoveis:     resultado.imoveis,
          temPlantas:  resultado.temPlantas,
          linkPlantas: resultado.linkPlantas,
        });

        await sendText(from, resposta);
        console.log(`[WA] Resposta enviada para ${from}`);
      } catch (err) {
        console.error('[WA] Erro na consulta:', err);
        await sendText(from,
          '❌ Ocorreu um erro ao processar sua localização. Tente novamente em instantes.'
        );
      }
      continue;
    }

    // ── Texto: ajuda ──────────────────────────────────────────
    if (msg.type === 'text') {
      const texto = (msg.text?.body ?? '').trim().toLowerCase();

      if (texto === 'ajuda' || texto === 'help' || texto === 'oi' || texto === 'olá') {
        await sendText(from,
          '👋 *JM MapStudio — Consulta Geoespacial*\n\n' +
          'Envie sua *localização* pelo WhatsApp e receba:\n' +
          '  • Município com área em km²\n' +
          '  • Imóveis CAR/SICAR na área\n' +
          '  • Links de plantas históricas (quando disponível)\n\n' +
          'Para enviar localização:\n' +
          '  📎 Anexar → Localização → Sua localização\n\n' +
          '🔗 Mapa completo: https://agricart-jca.github.io/jm-mapstudio'
        );
        continue;
      }

      // Qualquer outro texto
      await sendText(from,
        '📍 Envie sua *localização* para consultar dados do município e imóveis CAR.\n\n' +
        'Digite *ajuda* para mais informações.'
      );
    }
  }

  // Meta exige HTTP 200 para não reenviar o evento
  return new Response('OK', { status: 200 });
}

// ── Entry point ───────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'GET')  return handleVerify(req);
  if (req.method === 'POST') return handlePost(req);
  return new Response('Method Not Allowed', { status: 405 });
});
