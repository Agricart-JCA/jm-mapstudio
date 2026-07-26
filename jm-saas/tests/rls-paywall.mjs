// ================================================================
// tests/rls-paywall.mjs — Teste de segurança RLS (Tarefa 1)
// Cria um usuário comum descartável e tenta 6 ataques. TODOS devem falhar.
// Um controle positivo garante que o uso legítimo (editar nome) ainda funciona.
//
// Uso:  node tests/rls-paywall.mjs
// Requer Node 18+ (fetch nativo). A anon key é PÚBLICA (protegida por RLS),
// não é segredo — pode ficar aqui, mas dá pra sobrescrever por env.
// ================================================================

const URL  = process.env.SUPABASE_URL      || 'https://zzjizqiafnnuqmrkhjqj.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6aml6cWlhZm5udXFtcmtoanFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2Nzk3NDMsImV4cCI6MjA5NDI1NTc0M30.D0vhrJY2qgLJdqI8T75dgPer_376ICDOlvSoQVSoovk';

let TOKEN = '', UID = '';
const H = () => ({ apikey: ANON, Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' });
const results = [];
function record(nome, ok, detalhe) {
  results.push({ nome, ok, detalhe });
  console.log(`${ok ? '✅ PASSOU' : '❌ FALHOU'}  ${nome}${detalhe ? `  — ${detalhe}` : ''}`);
}

async function signup() {
  const email = `rlstest-${Date.now()}@jmtopografiaeng-test.com`;
  const r = await fetch(`${URL}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'TesteRLS!2026' }),
  });
  const d = await r.json();
  TOKEN = d.access_token || '';
  UID = d.user?.id || d.id || '';
  if (!TOKEN || !UID) throw new Error('Falha ao criar usuário de teste: ' + JSON.stringify(d).slice(0, 200));
  console.log(`Usuário de teste: ${UID}\n`);
}

// Lê um campo do próprio perfil (verdade de fato após cada tentativa)
async function lerPerfil(campo) {
  const r = await fetch(`${URL}/rest/v1/profiles?id=eq.${UID}&select=${campo}`, { headers: H() });
  const d = await r.json();
  return Array.isArray(d) && d[0] ? d[0][campo] : undefined;
}

async function main() {
  await signup();

  // ── ATAQUE 1: ativar assinatura (status) no próprio perfil ──
  const st0 = await lerPerfil('status');
  await fetch(`${URL}/rest/v1/profiles?id=eq.${UID}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ status: 'active' }) });
  const st1 = await lerPerfil('status');
  record('Ataque 1 — auto-ativar assinatura (status) bloqueado', st1 === st0, `status: ${st0} → ${st1}`);

  // ── ATAQUE 2: virar admin (role) ──
  const rl0 = await lerPerfil('role');
  await fetch(`${URL}/rest/v1/profiles?id=eq.${UID}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ role: 'admin' }) });
  const rl1 = await lerPerfil('role');
  record('Ataque 2 — auto-promover a admin (role) bloqueado', rl1 === rl0 && rl1 !== 'admin', `role: ${rl0} → ${rl1}`);

  // ── ATAQUE 3: acesso vitalício (trial_expires_at + plan_name) ──
  const tr0 = await lerPerfil('trial_expires_at');
  await fetch(`${URL}/rest/v1/profiles?id=eq.${UID}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ trial_expires_at: '2099-12-31', plan_name: 'Vitalício' }) });
  const tr1 = await lerPerfil('trial_expires_at');
  record('Ataque 3 — auto-conceder vitalício (trial) bloqueado', tr1 === tr0, `trial_expires_at: ${tr0} → ${tr1}`);

  // ── ATAQUE 4: inserir assinatura falsa em subscriptions ──
  const r4 = await fetch(`${URL}/rest/v1/subscriptions`, { method: 'POST', headers: { ...H(), Prefer: 'return=representation' }, body: JSON.stringify({ id: `rls_${UID}`, user_id: UID, status: 'active', price_id: 'x' }) });
  const b4 = await r4.text();
  record('Ataque 4 — inserir assinatura falsa bloqueado', !r4.ok, `HTTP ${r4.status} ${b4.slice(0, 60)}`);

  // ── ATAQUE 5: ler assinatura de OUTRO usuário ──
  const r5 = await fetch(`${URL}/rest/v1/subscriptions?select=user_id,status`, { headers: H() });
  const b5 = await r5.json();
  const vazou = Array.isArray(b5) && b5.some(row => row.user_id && row.user_id !== UID);
  record('Ataque 5 — ler assinatura de outro usuário bloqueado', !vazou, `linhas visíveis: ${Array.isArray(b5) ? b5.length : '?'}`);

  // ── ATAQUE 6: publicar planta sem moderação (status=aprovado) ──
  const r6 = await fetch(`${URL}/rest/v1/plantas`, { method: 'POST', headers: { ...H(), Prefer: 'return=representation' }, body: JSON.stringify({ titulo: 'RLSTEST', municipio: 'T', contribuidor_id: UID, status: 'aprovado' }) });
  const b6 = await r6.json().catch(() => ({}));
  const publicou = r6.ok && Array.isArray(b6) && b6[0]?.status === 'aprovado';
  record('Ataque 6 — auto-publicar planta (moderação) bloqueado', !publicou, publicou ? 'planta ficou aprovada!' : `HTTP ${r6.status}`);

  // ── CONTROLE: editar o próprio nome DEVE funcionar ──
  const novoNome = 'Teste RLS ' + Date.now();
  await fetch(`${URL}/rest/v1/profiles?id=eq.${UID}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ name: novoNome }) });
  const nome1 = await lerPerfil('name');
  record('Controle — editar próprio nome funciona', nome1 === novoNome, `name → ${nome1}`);

  // ── Resultado ──
  const falhas = results.filter(r => !r.ok);
  console.log('\n' + '─'.repeat(56));
  if (falhas.length === 0) {
    console.log('✅ SEGURO — todos os ataques bloqueados e uso legítimo OK.');
    process.exit(0);
  } else {
    console.log(`🔴 VULNERÁVEL — ${falhas.length} verificação(ões) falharam. NÃO lançar.`);
    process.exit(1);
  }
}

main().catch(e => { console.error('Erro no teste:', e.message); process.exit(2); });
