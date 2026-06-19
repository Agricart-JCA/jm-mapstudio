// ─────────────────────────────────────────────────────────────
// sessao.ts — Estado da conversa (menu guiado) + controle de cota
// Usa as tabelas whatsapp_sessions / profiles via service_role.
// ─────────────────────────────────────────────────────────────

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Cota grátis de consultas por número antes de pedir assinatura
export const COTA_GRATIS = Number(Deno.env.get('WHATSAPP_COTA_GRATIS') ?? '5');

function headers() {
  return { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
}

// Só dígitos (normaliza para casar com profiles.phone)
export function soDigitos(s: string): string { return String(s || '').replace(/\D/g, ''); }

export interface Sessao {
  phone: string;
  estado: string;     // '' | 'aguard_car' | 'aguard_sigef' | 'aguard_municipio'
  consultas: number;
  assinante: boolean;
}

export async function getSessao(phone: string): Promise<Sessao> {
  const vazia: Sessao = { phone, estado: '', consultas: 0, assinante: false };
  if (!SB_URL || !SB_KEY) return vazia;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/whatsapp_sessions?phone=eq.${encodeURIComponent(phone)}&select=phone,estado,consultas,assinante`,
      { headers: headers() },
    );
    if (!r.ok) return vazia;
    const rows = await r.json() as Sessao[];
    return rows[0] ?? vazia;
  } catch { return vazia; }
}

// Define a intenção pendente (upsert)
export async function setEstado(phone: string, estado: string): Promise<void> {
  if (!SB_URL || !SB_KEY) return;
  try {
    await fetch(`${SB_URL}/rest/v1/whatsapp_sessions?on_conflict=phone`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ phone, estado, ultimo_em: new Date().toISOString() }),
    });
  } catch { /* não bloqueia */ }
}

// Incrementa o contador de consultas e devolve o total (via RPC atômica)
export async function incrementarConsulta(phone: string): Promise<number> {
  if (!SB_URL || !SB_KEY) return 0;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/wa_inc_consulta`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ p_phone: phone }),
    });
    if (!r.ok) return 0;
    return Number(await r.json()) || 0;
  } catch { return 0; }
}

// O número pertence a um assinante ativo? (vincula WhatsApp → conta)
export async function isAssinante(phone: string): Promise<boolean> {
  if (!SB_URL || !SB_KEY) return false;
  const dig = soDigitos(phone);
  const ddd11 = dig.slice(-11); // casa mesmo com/sem código do país
  try {
    // Busca perfis ativos (ou trial válido) e compara o telefone normalizado
    const r = await fetch(
      `${SB_URL}/rest/v1/profiles?or=(status.eq.active,status.eq.trial)&select=phone,status,trial_expires_at,stripe_customer_id`,
      { headers: headers() },
    );
    if (!r.ok) return false;
    const rows = await r.json() as Record<string, unknown>[];
    const agora = Date.now();
    return rows.some(p => {
      const pdig = soDigitos(String(p.phone || ''));
      if (!pdig || pdig.slice(-11) !== ddd11) return false;
      if (p.stripe_customer_id) return true;
      if (p.status === 'active') return true;
      if (p.status === 'trial' && p.trial_expires_at && new Date(String(p.trial_expires_at)).getTime() > agora) return true;
      return false;
    });
  } catch { return false; }
}

export interface Acesso { liberado: boolean; assinante: boolean; usadas: number; restantes: number; }

// Verifica se pode consultar: assinante = ilimitado; senão aplica cota grátis.
// Só incrementa quando NÃO é assinante e ainda há cota.
export async function verificarAcesso(phone: string): Promise<Acesso> {
  if (await isAssinante(phone)) {
    return { liberado: true, assinante: true, usadas: 0, restantes: -1 };
  }
  const total = await incrementarConsulta(phone);
  const restantes = Math.max(0, COTA_GRATIS - total);
  return { liberado: total <= COTA_GRATIS, assinante: false, usadas: total, restantes };
}
