// ─────────────────────────────────────────────────────────────
// whatsapp.ts — Envio via Meta WhatsApp Cloud API
// ─────────────────────────────────────────────────────────────

import type { Municipio, ImovelCAR, EmbargoIBAMA, ParcelaSIGEF, PlantaPAL } from './geo.ts';

const GRAPH_API = 'https://graph.facebook.com/v19.0';
const MAP_BASE  = 'https://jm-saas.vercel.app';
const INCRA_ACERVO = 'https://acervofundiario.incra.gov.br/acervo/acv.php';

// URL de imagem de mapa para sendImage.
// Padrão: WMS GetMap do SICAR (sem chave, confiável) mostrando as parcelas CAR
// ao redor do ponto, sobre fundo branco. Para um mapa com base (ruas/satélite),
// configure o secret STATIC_MAP_TEMPLATE com {lat} {lon} {zoom} — ex. Geoapify/MapTiler.
export function mapImageUrl(lat: number, lon: number, zoom = 15): string {
  const tpl = Deno.env.get('STATIC_MAP_TEMPLATE');
  if (tpl) {
    return tpl.replace(/{lat}/g, String(lat)).replace(/{lon}/g, String(lon)).replace(/{zoom}/g, String(zoom));
  }
  // Fallback keyless: SICAR WMS GetMap (parcelas CAR do RJ, fundo branco)
  const d = 0.012; // ~1,3 km de raio
  const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
  return 'https://geoserver.car.gov.br/geoserver/sicar/ows?service=WMS&request=GetMap' +
    '&layers=sicar:sicar_imoveis_rj&version=1.1.1&srs=EPSG:4326' +
    '&format=image/png&width=640&height=480&bgcolor=0xFFFFFF&transparent=false' +
    `&bbox=${bbox}`;
}

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

export async function sendImage(to: string, imageUrl: string, caption = ''): Promise<boolean> {
  return postMessage({
    messaging_product: 'whatsapp', to, type: 'image',
    image: { link: imageUrl, caption: caption.slice(0, 1024) },
  });
}

// Botões de resposta rápida (máx. 3; título até 20 chars)
export async function sendButtons(
  to: string, body: string, botoes: { id: string; titulo: string }[], rodape = '',
): Promise<boolean> {
  return postMessage({
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body.slice(0, 1024) },
      ...(rodape ? { footer: { text: rodape.slice(0, 60) } } : {}),
      action: { buttons: botoes.slice(0, 3).map(b => ({ type: 'reply', reply: { id: b.id, title: b.titulo.slice(0, 20) } })) },
    },
  });
}

// Lista de opções (até 10 linhas no total)
export async function sendList(
  to: string, body: string, tituloBotao: string,
  linhas: { id: string; titulo: string; descricao?: string }[], rodape = '',
): Promise<boolean> {
  return postMessage({
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body.slice(0, 1024) },
      ...(rodape ? { footer: { text: rodape.slice(0, 60) } } : {}),
      action: {
        button: tituloBotao.slice(0, 20),
        sections: [{ title: 'Consultas', rows: linhas.slice(0, 10).map(l => ({
          id: l.id, title: l.titulo.slice(0, 24), description: (l.descricao || '').slice(0, 72),
        })) }],
      },
    },
  });
}

// Menu principal com botões guiados
export async function enviarMenu(to: string): Promise<boolean> {
  return sendButtons(
    to,
    '👋 *JM MapStudio*\nConsulta fundiária do RJ.\n\nToque numa opção ou *envie sua localização* 📍',
    [
      { id: 'menu_car',     titulo: '🌱 Consultar CAR' },
      { id: 'menu_sigef',   titulo: '🏛 Consultar SIGEF' },
      { id: 'menu_plantas', titulo: '🗺 Plantas/PAL' },
    ],
    'JM Topografia e Engenharia',
  );
}

// Mensagem de cota esgotada (paywall) com botão de assinatura
export async function enviarPaywall(to: string, usadas: number): Promise<boolean> {
  return sendButtons(
    to,
    `🔒 Você já usou suas *${usadas} consultas gratuitas*.\n\n` +
    `Assine o *JM MapStudio* para consultas *ilimitadas* — CAR, SIGEF, plantas e mais.\n\n` +
    `Já é assinante? Cadastre este WhatsApp no seu perfil para liberar.`,
    [
      { id: 'assinar',  titulo: '⭐ Assinar agora' },
      { id: 'menu',     titulo: '↩ Voltar ao menu' },
    ],
    'Acesso ilimitado para assinantes',
  );
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
    '👋 *Bem-vindo ao JM MapStudio!*\n' +
    '_Consulta fundiária do RJ direto no WhatsApp_\n\n' +
    '📍 *Envie sua localização* e receba tudo do ponto:\n' +
    '   CAR · SIGEF · plantas · embargos IBAMA\n\n' +
    '🔢 *Ou escolha uma consulta:*\n' +
    '  *1* — 🌱 CAR (digite: CAR + código)\n' +
    '  *2* — 🏛 SIGEF (digite: SIGEF + código/matrícula)\n' +
    '  *3* — 🗺 Plantas (digite: PLANTA + município)\n\n' +
    '💬 *Exemplos:*\n' +
    '  • _CAR RJ-3304557-XXXXXXXXXXXX_\n' +
    '  • _SIGEF 5120100113558_\n' +
    '  • _PLANTA Seropédica_\n\n' +
    'Digite *ajuda* a qualquer momento.\n' +
    `🌐 Mapa completo: ${MAP_BASE}`
  );
}

// ── Relatório por localização ─────────────────────────────────
export function formatarRelatorio(params: {
  lat: number;
  lon: number;
  municipio: Municipio | null;
  imoveis: ImovelCAR[];
  sigef: ParcelaSIGEF[];
  embargos: EmbargoIBAMA[];
  plantas: PlantaPAL[];
  temPlantas: boolean;
  linkPlantas: string;
  linkMapa: string;
}): string {
  const { lat, lon, municipio, imoveis, sigef, embargos, plantas, linkMapa } = params;
  const linhas: string[] = [];

  linhas.push('📍 *Relatório Fundiário — JM MapStudio*');
  linhas.push(`📌 \`${lat.toFixed(6)}, ${lon.toFixed(6)}\``);
  linhas.push('');

  // Município
  if (municipio) {
    linhas.push(`🏙️ *${municipio.nome} — ${municipio.uf}*  ·  IBGE ${municipio.codigo}`);
  } else {
    linhas.push('⚠️ Município não identificado (cobertura: RJ).');
  }

  // CAR / SICAR
  linhas.push('');
  linhas.push('🌱 *CAR / SICAR*');
  if (imoveis.length > 0) {
    linhas.push(`  ${imoveis.length} imóvel(is):`);
    for (const im of imoveis.slice(0, 3)) {
      linhas.push(`  ▸ ${im.codigo}`);
      linhas.push(`     ${im.area} · ${im.tipo} · ${im.situacao}`);
    }
    if (imoveis.length > 3) linhas.push(`  _(+${imoveis.length - 3} no mapa)_`);
  } else {
    linhas.push('  Nenhum imóvel CAR nesse ponto.');
  }

  // SIGEF / INCRA
  linhas.push('');
  linhas.push('🏛 *SIGEF / INCRA*');
  if (sigef.length > 0) {
    linhas.push(`  ${sigef.length} parcela(s) certificada(s):`);
    for (const pc of sigef.slice(0, 3)) {
      linhas.push(`  ▸ ${pc.nome || pc.imovel || pc.codigo}`);
      linhas.push(`     ${pc.area} · ${pc.status}${pc.matricula ? ' · Matríc. ' + pc.matricula : ''}`);
    }
    if (sigef.length > 3) linhas.push(`  _(+${sigef.length - 3} no mapa)_`);
  } else {
    linhas.push('  Nenhuma parcela SIGEF nesse ponto.');
  }

  // Embargos IBAMA
  linhas.push('');
  if (embargos.length > 0) {
    linhas.push(`🚨 *EMBARGOS IBAMA* — ${embargos.length}`);
    for (const em of embargos.slice(0, 2)) {
      linhas.push(`  ▸ TAI ${em.numTai} · ${em.area} · ${em.situacao}`);
    }
  } else {
    linhas.push('🚨 *EMBARGOS IBAMA*: ✅ nenhum');
  }

  // Plantas PAL
  if (plantas.length > 0) {
    linhas.push('');
    linhas.push(`🗺️ *PLANTAS / PAL* — ${plantas.length} no acervo`);
    for (const pl of plantas.slice(0, 3)) {
      linhas.push(`  ▸ ${pl.titulo}${pl.bairro ? ' · ' + pl.bairro : ''}`);
    }
    linhas.push(`  📂 Ver no mapa (aba Fundiário)`);
  }

  linhas.push('');
  linhas.push('──────────────────');
  linhas.push(`🔗 ${linkMapa}`);
  linhas.push('_JM Topografia e Engenharia_');

  return linhas.join('\n');
}

// ── Relatório de parcela SIGEF ────────────────────────────────
export function formatarRelatorioSIGEF(params: {
  termo: string;
  parcela: ParcelaSIGEF | null;
  linkMapa?: string;
}): string {
  const { termo, parcela, linkMapa } = params;
  if (!parcela) {
    return (
      `🏛 *Busca SIGEF: ${termo}*\n\n` +
      '❌ Não encontrado na base SIGEF do RJ.\n\n' +
      '_Aceita: código SIGEF, código do imóvel (13 díg.) ou matrícula._\n' +
      `🌐 Consulta oficial: ${INCRA_ACERVO}`
    );
  }
  const l: string[] = [];
  l.push(`🏛 *${parcela.nome || 'Parcela SIGEF'}*`);
  l.push('');
  l.push(`📐 *Área:* ${parcela.area}`);
  l.push(`🏷️ *Status:* ✅ ${parcela.status}`);
  if (parcela.situacao)  l.push(`📋 *Situação:* ${parcela.situacao}`);
  if (parcela.matricula) l.push(`📜 *Matrícula:* ${parcela.matricula}`);
  if (parcela.imovel)    l.push(`🆔 *Cód. imóvel:* ${parcela.imovel}`);
  l.push(`🔑 *SIGEF:* ${parcela.codigo}`);
  if (linkMapa) { l.push(''); l.push(`🔗 Ver no mapa: ${linkMapa}`); }
  l.push('_JM Topografia e Engenharia_');
  return l.join('\n');
}

// ── Lista de plantas PAL de um município ──────────────────────
export function formatarPlantas(municipio: string, plantas: PlantaPAL[]): string {
  if (plantas.length === 0) {
    return (
      `🗺️ *Plantas — ${municipio}*\n\n` +
      'Nenhuma planta cadastrada para este município ainda.\n\n' +
      `Contribua com o acervo e ganhe acesso grátis: ${MAP_BASE}`
    );
  }
  const l: string[] = [];
  l.push(`🗺️ *Plantas / PAL — ${municipio}*`);
  l.push(`_${plantas.length} no acervo_`);
  l.push('');
  for (const pl of plantas.slice(0, 8)) {
    l.push(`▸ *${pl.titulo}*`);
    const meta = [pl.tipo, pl.bairro, pl.data].filter(Boolean).join(' · ');
    if (meta) l.push(`   ${meta}`);
    if (pl.url) l.push(`   📂 ${pl.url}`);
  }
  if (plantas.length > 8) l.push(`_(+${plantas.length - 8} — veja no mapa)_`);
  l.push('');
  l.push('_JM Topografia e Engenharia_');
  return l.join('\n');
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
    lat: params.lat, lon: params.lon,
    imoveis: params.imoveis,
    sigef: [], embargos: [], plantas: [],
    temPlantas: params.temPlantas, linkPlantas: params.linkPlantas,
    linkMapa: `${MAP_BASE}?lat=${params.lat}&lon=${params.lon}`,
    municipio: params.municipio ? { ...params.municipio, uf: 'RJ' } : null,
  });
}
