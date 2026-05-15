// ─────────────────────────────────────────────────────────────
// whatsapp.ts — Funções de envio via Meta WhatsApp Cloud API
// ─────────────────────────────────────────────────────────────

const GRAPH_API = 'https://graph.facebook.com/v19.0';

function phoneId(): string {
  return Deno.env.get('WHATSAPP_PHONE_ID') ?? '';
}

function token(): string {
  return Deno.env.get('WHATSAPP_TOKEN') ?? '';
}

async function postMessage(body: unknown): Promise<boolean> {
  const res = await fetch(`${GRAPH_API}/${phoneId()}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[WA] Erro ao enviar mensagem:', err);
    return false;
  }
  return true;
}

// ── Texto simples ─────────────────────────────────────────────
export async function sendText(to: string, text: string): Promise<boolean> {
  return postMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  });
}

// ── Marca mensagem como lida ──────────────────────────────────
export async function markRead(messageId: string): Promise<void> {
  await fetch(`${GRAPH_API}/${phoneId()}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }),
  });
}

// ── Formata resposta de consulta geoespacial ──────────────────
export function formatarResposta(params: {
  lat: number;
  lon: number;
  municipio: { nome: string; codigo: string; areaKm2: number } | null;
  imoveis: { codigo: string; area: string; situacao: string; tipo: string }[];
  temPlantas: boolean;
  linkPlantas: string;
}): string {
  const { lat, lon, municipio, imoveis, temPlantas, linkPlantas } = params;

  const linhas: string[] = [];

  linhas.push('📍 *Consulta de Coordenada — JM MapStudio*');
  linhas.push(`\`${lat.toFixed(6)}, ${lon.toFixed(6)}\``);
  linhas.push('');

  if (municipio) {
    linhas.push(`🏙️ *Município:* ${municipio.nome}`);
    linhas.push(`📐 *Área:* ${municipio.areaKm2.toFixed(0)} km²`);
    linhas.push(`🔢 *Código IBGE:* ${municipio.codigo}`);
  } else {
    linhas.push('⚠️ Município não identificado (coordenada fora do RJ ou limite impreciso).');
  }

  if (temPlantas && linkPlantas) {
    linhas.push('');
    linhas.push(`🗺️ *Plantas históricas:* ${linkPlantas}`);
  }

  if (imoveis.length > 0) {
    linhas.push('');
    linhas.push(`🌱 *Imóveis CAR encontrados:* ${imoveis.length}`);
    for (const im of imoveis.slice(0, 3)) {
      linhas.push(`  • ${im.codigo} | ${im.area} | ${im.situacao} | ${im.tipo}`);
    }
    if (imoveis.length > 3) {
      linhas.push(`  _(+${imoveis.length - 3} outros — veja o mapa completo)_`);
    }
  } else {
    linhas.push('');
    linhas.push('🌱 Nenhum imóvel CAR encontrado nessa área.');
  }

  linhas.push('');
  linhas.push('🔗 Acesse o mapa completo: https://agricart-jca.github.io/jm-mapstudio');

  return linhas.join('\n');
}
