// ================================================================
// Supabase Edge Function: stripe-webhook  v2.2
// Processa pagamentos Stripe → cria acesso → envia e-mails (Gmail SMTP)
// ================================================================
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// Secrets obrigatórios (Supabase Dashboard → Settings → Edge Functions):
//   STRIPE_SECRET_KEY      — sk_live_... ou sk_test_...
//   STRIPE_WEBHOOK_SECRET  — whsec_... (do painel Stripe → Webhooks)
//   GMAIL_USER             — comercial@jmtopografiaeng.com
//   GMAIL_APP_PASSWORD     — App Password do Gmail (sem espaços)
//
// Secrets opcionais (têm valores padrão):
//   ADMIN_EMAIL            — e-mail do administrador (padrão: juancarlos.agricart@gmail.com)
//   APP_URL                — URL da plataforma (padrão: https://agricart-jca.github.io/jm-mapstudio)
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { SmtpClient } from 'https://deno.land/x/smtp@v0.7.0/mod.ts'

// ── Clientes ──────────────────────────────────────────────────
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const adminClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// ── Configuração ──────────────────────────────────────────────
const ADMIN_EMAIL      = Deno.env.get('ADMIN_EMAIL')        ?? 'juancarlos.agricart@gmail.com'
const APP_URL          = Deno.env.get('APP_URL')             ?? 'https://agricart-jca.github.io/jm-mapstudio'
const RESET_URL        = `${APP_URL}/reset-password.html`
const GMAIL_USER       = Deno.env.get('GMAIL_USER')          ?? 'comercial@jmtopografiaeng.com'
const GMAIL_APP_PASS   = Deno.env.get('GMAIL_APP_PASSWORD')  ?? ''

// ── Busca usuário por e-mail (com paginação completa) ─────────
async function buscarUsuarioPorEmail(email: string): Promise<string | null> {
  let pagina = 1
  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page: pagina,
      perPage: 50,
    })
    if (error) {
      console.error(`[Auth] Erro ao listar usuários (pág ${pagina}):`, error.message)
      break
    }
    if (!data?.users?.length) break

    const encontrado = data.users.find(u => u.email?.toLowerCase() === email)
    if (encontrado) {
      console.log(`[Auth] Usuário encontrado na pág ${pagina}: ${encontrado.id}`)
      return encontrado.id
    }

    // Última página — parar
    if (data.users.length < 50) break
    pagina++
  }
  return null
}

// ── Gera senha provisória segura (12 chars) ───────────────────
function gerarSenhaProvisoria(): string {
  const M = 'ABCDEFGHJKMNPQRSTUVWXYZ'
  const m = 'abcdefghjkmnpqrstuvwxyz'
  const n = '23456789'
  const s = '!@#$'
  const todos = M + m + n + s

  const partes = [
    M[Math.floor(Math.random() * M.length)],
    m[Math.floor(Math.random() * m.length)],
    n[Math.floor(Math.random() * n.length)],
    s[Math.floor(Math.random() * s.length)],
  ]
  for (let i = 0; i < 8; i++) {
    partes.push(todos[Math.floor(Math.random() * todos.length)])
  }
  return partes.sort(() => Math.random() - 0.5).join('')
}

// ── Envia e-mail via Gmail SMTP ───────────────────────────────
async function enviarEmail(
  para: string,
  assunto: string,
  html: string,
  tentativas = 3
): Promise<boolean> {
  if (!GMAIL_APP_PASS) {
    console.error('[Email] GMAIL_APP_PASSWORD não configurada — e-mail NÃO enviado para:', para)
    return false
  }

  for (let t = 1; t <= tentativas; t++) {
    const client = new SmtpClient()
    try {
      await client.connectTLS({
        hostname: 'smtp.gmail.com',
        port: 465,
        username: GMAIL_USER,
        password: GMAIL_APP_PASS,
      })
      await client.send({
        from: `JM MapStudio <${GMAIL_USER}>`,
        to: para,
        subject: assunto,
        content: 'auto',
        html,
      })
      await client.close()
      console.log(`[Email] ✅ Enviado para ${para}`)
      return true
    } catch (err) {
      try { await client.close() } catch (_) { /* ignorar */ }
      console.error(`[Email] ❌ Tentativa ${t}/${tentativas} falhou para ${para}:`, err)
      if (t < tentativas) await new Promise(r => setTimeout(r, 1500 * t))
    }
  }

  console.error(`[Email] ❌ Todas as ${tentativas} tentativas falharam para ${para}`)
  return false
}

// ── Template: e-mail de acesso ao comprador ───────────────────
function htmlAcesso(
  primeiroNome: string,
  email: string,
  senha: string | null,
  plano: string,
  linkAcesso: string
): string {
  const secaoCredenciais = senha
    ? `
      <tr>
        <td style="padding:6px 0;color:#555;font-size:13px">Senha:</td>
        <td style="padding:6px 0;color:#c0392b;font-size:16px;font-weight:800;letter-spacing:2px;font-family:monospace">${senha}</td>
      </tr>`
    : `
      <tr>
        <td colspan="2" style="padding:10px 0">
          <div style="background:#fff8e1;border:1px solid #ffd54f;border-radius:6px;padding:12px 14px;font-size:12px;color:#795548;line-height:1.6">
            🔑 Você já possui uma senha cadastrada. Use-a para acessar a plataforma.<br>
            Caso não lembre, clique em <strong>"Esqueci minha senha"</strong> na tela de login.
          </div>
        </td>
      </tr>`

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#c0392b,#8e1a13);padding:32px 36px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;letter-spacing:.5px">JM MapStudio</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px">JM Topografia e Engenharia</p>
    </div>

    <!-- Corpo -->
    <div style="padding:36px">
      <h2 style="margin:0 0 8px;color:#1a1a2e;font-size:18px">
        ${senha ? `Bem-vindo, ${primeiroNome}! 🎉` : `Acesso confirmado, ${primeiroNome}! ✅`}
      </h2>
      <p style="color:#555;line-height:1.7;margin:0 0 24px">
        Seu pagamento foi confirmado e seu acesso ao <strong>JM MapStudio</strong> está ativo.
      </p>

      <!-- Credenciais -->
      <div style="background:#f8f9fa;border:1.5px solid #e0e0e0;border-radius:10px;padding:20px 24px;margin-bottom:24px">
        <p style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888">
          Dados de acesso
        </p>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:6px 0;color:#555;font-size:13px;width:90px">E-mail:</td>
            <td style="padding:6px 0;color:#1a1a2e;font-size:13px;font-weight:600">${email}</td>
          </tr>
          ${secaoCredenciais}
          <tr>
            <td style="padding:6px 0;color:#555;font-size:13px">Plano:</td>
            <td style="padding:6px 0;color:#1a1a2e;font-size:13px;font-weight:600">${plano}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#555;font-size:13px">Status:</td>
            <td style="padding:6px 0;color:#27ae60;font-size:13px;font-weight:700">✅ Ativo</td>
          </tr>
        </table>
      </div>

      <!-- Botão -->
      <div style="text-align:center;margin-bottom:24px">
        <a href="${linkAcesso}"
           style="display:inline-block;background:linear-gradient(135deg,#c0392b,#922b21);color:#fff;
                  padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;
                  font-size:15px;letter-spacing:.3px">
          Acessar o JM MapStudio →
        </a>
      </div>

      ${senha ? `
      <!-- Aviso de troca de senha -->
      <div style="background:#fff8e1;border:1px solid #ffd54f;border-radius:8px;padding:14px 16px;margin-bottom:24px">
        <p style="margin:0;font-size:12px;color:#795548;line-height:1.6">
          ⚠️ <strong>Recomendamos trocar sua senha</strong> após o primeiro acesso.<br>
          Dentro da plataforma, clique em <strong>"Minha conta"</strong> → <strong>"Alterar senha"</strong>.
        </p>
      </div>` : ''}

      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="margin:0;font-size:12px;color:#999;text-align:center;line-height:1.7">
        Dúvidas? Entre em contato:<br>
        <a href="mailto:comercial@jmtopografiaeng.com" style="color:#c0392b;text-decoration:none">
          comercial@jmtopografiaeng.com
        </a> · (21) 99997-6196
      </p>
    </div>
  </div>
</body>
</html>`
}

// ── Template: notificação ao administrador ────────────────────
function htmlAdmin(
  email: string,
  nome: string,
  telefone: string,
  plano: string,
  valorCentavos: number,
  dataPagamento: string,
  userId: string,
  statusCriacao: string,
  emailEnviado: boolean
): string {
  const valor = (valorCentavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const statusBadge = statusCriacao === 'criado'
    ? '<span style="background:#e8f5e9;color:#2e7d32;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">✅ Usuário criado</span>'
    : '<span style="background:#fff3e0;color:#e65100;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">⚠️ Usuário já existia</span>'
  const emailBadge = emailEnviado
    ? '<span style="background:#e8f5e9;color:#2e7d32;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">✅ Enviado</span>'
    : '<span style="background:#fce4ec;color:#c62828;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">❌ FALHOU — reenviar manualmente</span>'

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#1a237e,#0d1b6b);padding:28px 36px">
      <h1 style="margin:0;color:#fff;font-size:18px;font-weight:800">🎉 Novo Assinante — JM MapStudio</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,.7);font-size:12px">${dataPagamento}</p>
    </div>
    <div style="padding:32px">
      <table style="width:100%;border-collapse:collapse">
        <tr style="border-bottom:1px solid #f0f0f0">
          <td style="padding:10px 0;color:#777;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;width:130px">Nome</td>
          <td style="padding:10px 0;color:#1a1a2e;font-size:14px;font-weight:600">${nome || '—'}</td>
        </tr>
        <tr style="border-bottom:1px solid #f0f0f0">
          <td style="padding:10px 0;color:#777;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px">E-mail</td>
          <td style="padding:10px 0;color:#1a1a2e;font-size:14px">${email}</td>
        </tr>
        <tr style="border-bottom:1px solid #f0f0f0">
          <td style="padding:10px 0;color:#777;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px">Telefone</td>
          <td style="padding:10px 0;color:#1a1a2e;font-size:14px">${telefone || '—'}</td>
        </tr>
        <tr style="border-bottom:1px solid #f0f0f0">
          <td style="padding:10px 0;color:#777;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px">Plano</td>
          <td style="padding:10px 0;color:#1a1a2e;font-size:14px;font-weight:600">${plano}</td>
        </tr>
        <tr style="border-bottom:1px solid #f0f0f0">
          <td style="padding:10px 0;color:#777;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px">Valor pago</td>
          <td style="padding:10px 0;color:#27ae60;font-size:18px;font-weight:800">${valor}</td>
        </tr>
        <tr style="border-bottom:1px solid #f0f0f0">
          <td style="padding:10px 0;color:#777;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px">Usuário</td>
          <td style="padding:10px 0">${statusBadge}</td>
        </tr>
        <tr style="border-bottom:1px solid #f0f0f0">
          <td style="padding:10px 0;color:#777;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px">E-mail ao cliente</td>
          <td style="padding:10px 0">${emailBadge}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#777;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px">User ID</td>
          <td style="padding:10px 0;color:#888;font-size:11px;font-family:monospace">${userId}</td>
        </tr>
      </table>

      <div style="margin-top:24px;text-align:center">
        <a href="${APP_URL}/admin-users.html"
           style="display:inline-block;background:#1a237e;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">
          Ver Painel de Assinantes →
        </a>
      </div>
    </div>
  </div>
</body>
</html>`
}

// ── Salva / atualiza perfil (upsert seguro) ───────────────────
async function salvarPerfil(
  userId: string,
  email: string,
  nome: string,
  telefone: string,
  customerId: string,
  plano: string
) {
  const { error } = await adminClient.from('profiles').upsert({
    id:                 userId,
    email,
    name:               nome || email.split('@')[0],
    phone:              telefone || null,
    stripe_customer_id: customerId,
    plan_name:          plano.toLowerCase(),
    status:             'active',
    subscribed_at:      new Date().toISOString(),
    updated_at:         new Date().toISOString(),
  }, { onConflict: 'id' })

  if (error) {
    console.error('[DB] Erro ao salvar perfil:', error.message)
  } else {
    console.log(`[DB] Perfil salvo para userId: ${userId}`)
  }
}

// ── Salva / atualiza assinatura ───────────────────────────────
async function salvarAssinatura(sub: Stripe.Subscription, userId: string, priceId: string) {
  const planName = sub.items.data[0]?.price?.recurring?.interval === 'year' ? 'anual' : 'mensal'
  const { error } = await adminClient.from('subscriptions').upsert({
    id:                   sub.id,
    user_id:              userId,
    status:               sub.status,
    price_id:             priceId,
    plan_name:            planName,
    current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
    current_period_end:   new Date(sub.current_period_end   * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
    stripe_customer_id:   sub.customer as string,
    updated_at:           new Date().toISOString(),
  }, { onConflict: 'id' })

  if (error) {
    console.error('[DB] Erro ao salvar assinatura:', error.message)
  } else {
    console.log(`[DB] Assinatura salva: ${sub.id}`)
  }
}

// ── Handler principal ─────────────────────────────────────────
serve(async (req) => {
  const assinatura = req.headers.get('stripe-signature')
  const corpo = await req.text()

  if (!assinatura) {
    console.error('[Webhook] Requisição sem assinatura Stripe — rejeitada')
    return new Response('Assinatura ausente', { status: 400 })
  }

  let evento: Stripe.Event
  try {
    evento = await stripe.webhooks.constructEventAsync(
      corpo,
      assinatura,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch (err) {
    console.error('[Webhook] ❌ Assinatura inválida:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  console.log(`\n[Webhook] ══ Evento: ${evento.type} (${evento.id}) ══`)

  // Processar sem bloquear a resposta (evita timeout do Stripe)
  processarEvento(evento).catch(err => {
    console.error('[Webhook] Erro não tratado:', err)
  })

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

// ── Processamento assíncrono do evento ────────────────────────
async function processarEvento(evento: Stripe.Event) {
  switch (evento.type) {

    // ── PAGAMENTO CONFIRMADO ──────────────────────────────────
    case 'checkout.session.completed': {
      const sessao     = evento.data.object as Stripe.Checkout.Session
      const email      = (sessao.customer_email || sessao.customer_details?.email || '').toLowerCase().trim()
      const nome       = sessao.customer_details?.name || ''
      const telefone   = sessao.customer_details?.phone || ''
      const customerId = sessao.customer as string
      const subId      = sessao.subscription as string
      const valor      = sessao.amount_total ?? 0

      console.log(`[Checkout] Email: ${email} | Sub: ${subId} | Customer: ${customerId}`)

      if (!email) {
        console.error('[Checkout] ❌ E-mail do comprador ausente — verifique configuração do Stripe Checkout')
        return
      }

      if (!subId) {
        console.error('[Checkout] ❌ subscription_id ausente — verifique se modo é "subscription"')
        return
      }

      // Recuperar dados do plano
      let sub: Stripe.Subscription
      let plano = 'Mensal'
      let priceId = ''
      try {
        sub = await stripe.subscriptions.retrieve(subId)
        const interval = sub.items.data[0]?.price?.recurring?.interval
        plano   = interval === 'year' ? 'Anual' : 'Mensal'
        priceId = sub.items.data[0]?.price?.id || ''
        console.log(`[Checkout] Plano: ${plano} | Price: ${priceId}`)
      } catch (err) {
        console.error('[Checkout] ❌ Erro ao buscar assinatura Stripe:', err)
        return
      }

      const dataPagamento = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

      // ── Buscar ou criar usuário ──────────────────────────────
      let userId: string
      let statusCriacao: string
      let senhaProvisoria: string | null = null

      const userId_existente = await buscarUsuarioPorEmail(email)

      if (userId_existente) {
        // Usuário já existe — atualizar apenas
        userId = userId_existente
        statusCriacao = 'existente'
        console.log(`[Auth] Usuário existente encontrado: ${userId}`)
      } else {
        // Criar novo usuário com senha provisória
        senhaProvisoria = gerarSenhaProvisoria()
        console.log(`[Auth] Criando novo usuário para: ${email}`)

        const { data: novoUsuario, error: erroCriacao } = await adminClient.auth.admin.createUser({
          email,
          password: senhaProvisoria,
          email_confirm: true,
          user_metadata: {
            name:               nome,
            phone:              telefone,
            stripe_customer_id: customerId,
          },
        })

        if (erroCriacao || !novoUsuario?.user) {
          console.error('[Auth] ❌ Erro ao criar usuário:', erroCriacao?.message)
          // Última tentativa: procurar por e-mail novamente (pode ter sido criado por race condition)
          const recheck = await buscarUsuarioPorEmail(email)
          if (recheck) {
            userId = recheck
            statusCriacao = 'existente'
            senhaProvisoria = null
            console.log(`[Auth] Encontrado após segunda tentativa: ${userId}`)
          } else {
            console.error('[Auth] ❌ Não foi possível criar ou encontrar o usuário — abortando')
            return
          }
        } else {
          userId = novoUsuario.user.id
          statusCriacao = 'criado'
          console.log(`[Auth] ✅ Novo usuário criado: ${userId}`)
        }
      }

      // ── Salvar dados no banco ────────────────────────────────
      await salvarPerfil(userId, email, nome, telefone, customerId, plano)
      await salvarAssinatura(sub!, userId, priceId)

      // ── Enviar e-mail ao comprador ───────────────────────────
      console.log(`[Email] Enviando e-mail de acesso para: ${email}`)
      const primeiroNome = nome ? nome.split(' ')[0] : 'Cliente'
      const emailComprador = await enviarEmail(
        email,
        `✅ Acesso liberado ao JM MapStudio — Plano ${plano}`,
        htmlAcesso(primeiroNome, email, senhaProvisoria, plano, APP_URL)
      )

      // ── Enviar notificação ao admin ──────────────────────────
      console.log(`[Email] Enviando notificação ao admin: ${ADMIN_EMAIL}`)
      await enviarEmail(
        ADMIN_EMAIL,
        `🎉 Novo assinante: ${nome || email} — ${plano}`,
        htmlAdmin(email, nome, telefone, plano, valor, dataPagamento, userId, statusCriacao, emailComprador)
      )

      console.log(`[Checkout] ✅ Concluído para ${email} | Status: ${statusCriacao} | Email: ${emailComprador ? 'enviado' : 'FALHOU'}`)
      break
    }

    // ── ASSINATURA ATUALIZADA ─────────────────────────────────
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = evento.data.object as Stripe.Subscription
      console.log(`[Sub] Atualização: ${sub.id} | Status: ${sub.status}`)

      const { data: perfil } = await adminClient
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', sub.customer as string)
        .maybeSingle()

      if (perfil) {
        const priceId = sub.items.data[0]?.price?.id || ''
        await salvarAssinatura(sub, perfil.id, priceId)
        // Reativar status se assinatura voltou a ser ativa
        if (sub.status === 'active') {
          await adminClient.from('profiles')
            .update({ status: 'active', updated_at: new Date().toISOString() })
            .eq('id', perfil.id)
        }
      } else {
        console.warn(`[Sub] Perfil não encontrado para customer: ${sub.customer}`)
      }
      break
    }

    // ── ASSINATURA CANCELADA ──────────────────────────────────
    case 'customer.subscription.deleted': {
      const sub = evento.data.object as Stripe.Subscription
      console.log(`[Sub] Cancelada: ${sub.id}`)

      await adminClient.from('subscriptions')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('id', sub.id)

      await adminClient.from('profiles')
        .update({ status: 'inactive', updated_at: new Date().toISOString() })
        .eq('stripe_customer_id', sub.customer as string)

      console.log(`[Sub] ✅ Acesso desativado para customer: ${sub.customer}`)
      break
    }

    // ── PAGAMENTO FALHOU ──────────────────────────────────────
    case 'invoice.payment_failed': {
      const invoice = evento.data.object as Stripe.Invoice
      console.log(`[Invoice] Pagamento falhou: ${invoice.id}`)

      if (invoice.subscription) {
        await adminClient.from('subscriptions')
          .update({ status: 'past_due', updated_at: new Date().toISOString() })
          .eq('id', invoice.subscription as string)
      }
      break
    }

    default:
      console.log(`[Webhook] Evento ignorado: ${evento.type}`)
  }
}
