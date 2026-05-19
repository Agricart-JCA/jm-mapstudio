// ─────────────────────────────────────────────────────────────
// whatsapp.ts — Envio via Meta WhatsApp Cloud API
// ─────────────────────────────────────────────────────────────

import type { Municipio, ImovelCAR, EmbargoIBAMA } from './geo.ts';

const GRAPH_API = 'https://graph.facebook.com/v19.0';

function phoneId(): string { return Deno.env.get('WHATSAPP_PHONE_ID') ?? ''; }
function token():   string { return Deno.env.get('WHATSAPP_TOKEN')    ?? ''; }

async function postMessage(body: unknown): Promise<boolean> {
  const res = await fetch(`${GRAPH_API}/${phoneId()}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('[WA] Erro ao enviar:', await res.text());
    return false;
  }
  return true;
}

export async function sendText(to: string, text: string): Promise<boolean> {
  return postMessage({
    messaging_product: 'whatsapp', to, type: 'text', text: { body: text },
  });
}

export async function markRead(messageId: string): Promise<void> {
  await fetch(`${GRAPH_API}/${phoneId()}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
  });
}

// ── Mensagem de boas-vindas ───────────────────────────────────
export function msgBoasVindas(): string {
  return (
    '👋 *Bem-vindo ao JM MapStudio!*\n\n' +
    'Consulte dados fundiários de qualquer imóvel rural diretamente aqui.\n\n' +
    '📍 *Envie sua localização* para consultar o ponto no mapa\n' +
    '🔎 *Digite o código CAR* para buscar por imóvel\n' +
    '   _Ex: RJ-3304557-XXXXXXXXXXXX_\n\n' +
    '💬 *Comandos disponíveis:*\n' +
    '  • *ajuda* — exibe este menu\n' +
    '  • *CAR [código]* — busca imóvel pelo código\n\n' +
    '🌐 Acesse o mapa completo:\n' +
    'https://agricart-jca.github.io/jm-mapstudio'
  );
}

// ── Relatório por localização ─────────────────────────────────
export function formatarRelatorio(params: {
  lat: number;
  lon: number;
  municipio: Municipio | null;
  imoveis: ImovelCAR[];
  embargos: EmbargoIBAMA[];
  temPlantas: boolean;
  linkPlantas: string;
  linkMapa: string;
}): string {
  const { lat, lon, municipio, imoveis, embargos, temPlantas, linkPlantas, linkMapa } = params;
  const linhas: string[] = [];

  linhas.push('📍 *Relatório Fundiário — JM MapStudio*');
  linhas.push(`📌 Coordenadas: \`${lat.toFixed(6)}, ${lon.toFixed(6)}\``);
  linhas.push('');

  // Município
  if (municipio) {
    linhas.push('🏙️ *MUNICÍPIO*');
    linhas.push(`  Nome: *${municipio.nome} — ${municipio.uf}*`);
    linhas.push(`  Área: ${municipio.areaKm2.toFixed(0)} km²`);
    linhas.push(`  IBGE: ${municipio.codigo}`);
  } else {
    linhas.push('⚠️ Município não identificado fora do RJ.');
  }

  // CAR / SICAR
  linhas.push('');
  linhas.push('🌱 *CAR / SICAR*');
  if (imoveis.length > 0) {
    linhas.push(`  ${imoveis.length} imóvel(is) encontrado(s):`);
    for (const im of imoveis.slice(0, 3)) {
      linhas.push(`  ▸ ${im.codigo}`);
      linhas.push(`     Área: ${im.area} | ${im.tipo}`);
      linhas.push(`     Status: ${im.situacao}`);
    }
    if (imoveis.length > 3)
      linhas.push(`  _(+${imoveis.length - 3} outros — veja no mapa)_`);
  } else {
    linhas.push('  Nenhum imóvel CAR encontrado nessa área.');
  }

  // Embargos IBAMA
  linhas.push('');
  linhas.push('🚨 *EMBARGOS IBAMA*');
  if (embargos.length > 0) {
    linhas.push(`  ⚠️ ${embargos.length} embargo(s) encontrado(s):`);
    for (const em of embargos.slice(0, 2)) {
      linhas.push(`  ▸ TAI: ${em.numTai}`);
      linhas.push(`     Área: ${em.area} | ${em.situacao}`);
      linhas.push(`     Emissão: ${em.dataEmissao}`);
    }
  } else {
    linhas.push('  ✅ Sem embargos IBAMA na área.');
  }

  // Plantas históricas
  if (temPlantas && linkPlantas) {
    linhas.push('');
    linhas.push('🗺️ *PLANTAS HISTÓRICAS*');
    linhas.push(`  📂 ${linkPlantas}`);
  }

  // Link do mapa
  linhas.push('');
  linhas.push('──────────────────');
  linhas.push(`🔗 Ver no mapa: ${linkMapa}`);
  linhas.push('_JM Topografia e Engenharia_');

  return linhas.join('\n');
}

// ── Relatório de imóvel CAR por código ───────────────────────
export function formatarRelatorioCAR(params: {
  codigo: string;
  imovel?: ImovelCAR;
  encontrado: boolean;
  linkMapa?: string;
}): string {
  const { codigo, imovel, encontrado, linkMapa } = params;
  if (!encontrado || !imovel) {
    return (
      `🔎 *Busca CAR: ${codigo}*\n\n` +
      '❌ Imóvel não encontrado no SICAR-RJ.\n\n' +
      '_Verifique o código e tente novamente._\n' +
      '_Formato: RJ-XXXXXXX-XXXXXXXXXXXX_'
    );
  }

  const linhas: string[] = [];
  linhas.push(`🔎 *Imóvel CAR: ${imovel.codigo}*`);
  linhas.push('');
  linhas.push(`📋 *Tipo:* ${imovel.tipo}`);
  linhas.push(`📐 *Área:* ${imovel.area}`);
  linhas.push(`🏷️ *Status:* ${imovel.situacao}`);
  if (linkMapa) {
    linhas.push('');
    linhas.push(`🔗 Ver no mapa: ${linkMapa}`);
  }
  linhas.push('_JM Topografia e Engenharia_');
  return linhas.join('\n');
}

// ── Mantido por compatibilidade ───────────────────────────────
export function formatarResposta(params: {
  lat: number; lon: number;
  municipio: { nome: string; codigo: string; areaKm2: number } | null;
  imoveis: ImovelCAR[];
  temPlantas: boolean;
  linkPlantas: string;
}): string {
  return formatarRelatorio({
    ...params,
    embargos: [],
    linkMapa: `https://agricart-jca.github.io/jm-mapstudio?lat=${params.lat}&lon=${params.lon}`,
    municipio: params.municipio ? { ...params.municipio, uf: 'RJ' } : null,
  });
}
