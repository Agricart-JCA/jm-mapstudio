# ================================================================
# JM MapStudio — Reenvio Manual de Acesso
# Use para compradores que pagaram mas não receberam credenciais
# ================================================================
# Como rodar:
#   1. Preencha as seções CONFIGURAÇÃO e COMPRADORES abaixo
#   2. Abra PowerShell como Administrador
#   3. cd "C:\Users\ENGENHARIA\Desktop\jm-saas"
#   4. .\reenviar-acesso.ps1
# ================================================================

# ── CONFIGURAÇÃO — preencha antes de rodar ────────────────────
$SUPABASE_URL      = "https://zzjizqiafnnuqmrkhjqj.supabase.co"
$SERVICE_ROLE_KEY  = "COLE_AQUI_SUA_SERVICE_ROLE_KEY"   # Supabase → Settings → API → service_role
$APP_URL           = "https://agricart-jca.github.io/jm-mapstudio"
$RESET_URL         = "$APP_URL/reset-password.html"
$FORGOT_URL        = "$APP_URL/forgot-password.html"

# ── Gmail SMTP ────────────────────────────────────────────────
$GMAIL_USER        = "comercial@jmtopografiaeng.com"
$GMAIL_APP_PASS    = "jdwjytlcmqlfkdn"   # App Password (sem espaços)

# ── COMPRADORES — preencha com os dados reais dos compradores ─
$compradores = @(
    @{
        email = "EMAIL_DO_COMPRADOR_1@exemplo.com"
        nome  = "Nome do Comprador 1"
        plano = "Mensal"
    },
    @{
        email = "EMAIL_DO_COMPRADOR_2@exemplo.com"
        nome  = "Nome do Comprador 2"
        plano = "Mensal"
    }
)

# ================================================================
# NÃO ALTERE ABAIXO DESTA LINHA
# ================================================================

function Gerar-Senha {
    $M = "ABCDEFGHJKMNPQRSTUVWXYZ"
    $m = "abcdefghjkmnpqrstuvwxyz"
    $n = "23456789"
    $s = "!@#`$"
    $todos = $M + $m + $n + $s
    $arr = @(
        $M[(Get-Random -Maximum $M.Length)],
        $m[(Get-Random -Maximum $m.Length)],
        $n[(Get-Random -Maximum $n.Length)],
        $s[(Get-Random -Maximum $s.Length)]
    )
    for ($i = 0; $i -lt 8; $i++) {
        $arr += $todos[(Get-Random -Maximum $todos.Length)]
    }
    return ($arr | Sort-Object { Get-Random }) -join ""
}

function Enviar-Email($para, $assunto, $htmlBody) {
    try {
        $credential = New-Object PSCredential(
            $GMAIL_USER,
            (ConvertTo-SecureString $GMAIL_APP_PASS -AsPlainText -Force)
        )
        Send-MailMessage `
            -From "JM MapStudio <$GMAIL_USER>" `
            -To $para `
            -Subject $assunto `
            -Body $htmlBody `
            -BodyAsHtml `
            -SmtpServer "smtp.gmail.com" `
            -Port 587 `
            -UseSsl `
            -Credential $credential `
            -Encoding UTF8
        Write-Host "  [Email] Enviado!" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  [Email] FALHOU: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

function Buscar-Usuario($email) {
    $headers = @{
        "apikey"        = $SERVICE_ROLE_KEY
        "Authorization" = "Bearer $SERVICE_ROLE_KEY"
    }
    $pagina = 1
    while ($true) {
        try {
            $resp = Invoke-RestMethod `
                -Uri "$SUPABASE_URL/auth/v1/admin/users?page=$pagina&per_page=50" `
                -Method GET `
                -Headers $headers
            $users = $resp.users
            if (-not $users -or $users.Count -eq 0) { break }
            $encontrado = $users | Where-Object { $_.email -eq $email }
            if ($encontrado) { return $encontrado }
            if ($users.Count -lt 50) { break }
            $pagina++
        } catch {
            Write-Host "  [Auth] Erro ao buscar usuários: $($_.Exception.Message)" -ForegroundColor Yellow
            break
        }
    }
    return $null
}

function Criar-Usuario($email, $nome, $senha) {
    $headers = @{
        "apikey"        = $SERVICE_ROLE_KEY
        "Authorization" = "Bearer $SERVICE_ROLE_KEY"
        "Content-Type"  = "application/json"
    }
    $body = @{
        email          = $email
        password       = $senha
        email_confirm  = $true
        user_metadata  = @{ name = $nome }
    } | ConvertTo-Json -Depth 3

    try {
        $resp = Invoke-RestMethod `
            -Uri "$SUPABASE_URL/auth/v1/admin/users" `
            -Method POST `
            -Headers $headers `
            -Body $body
        return $resp
    } catch {
        Write-Host "  [Auth] Erro ao criar usuário: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

function Definir-Senha($userId, $novaSenha) {
    $headers = @{
        "apikey"        = $SERVICE_ROLE_KEY
        "Authorization" = "Bearer $SERVICE_ROLE_KEY"
        "Content-Type"  = "application/json"
    }
    $body = @{ password = $novaSenha } | ConvertTo-Json

    try {
        Invoke-RestMethod `
            -Uri "$SUPABASE_URL/auth/v1/admin/users/$userId" `
            -Method PUT `
            -Headers $headers `
            -Body $body | Out-Null
        return $true
    } catch {
        Write-Host "  [Auth] Erro ao definir senha: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

function Ativar-Perfil($userId, $email, $nome, $plano) {
    $headers = @{
        "apikey"        = $SERVICE_ROLE_KEY
        "Authorization" = "Bearer $SERVICE_ROLE_KEY"
        "Content-Type"  = "application/json"
        "Prefer"        = "return=minimal"
    }
    $body = @{
        id        = $userId
        email     = $email
        name      = $nome
        status    = "active"
        plan_name = $plano.ToLower()
        subscribed_at = (Get-Date).ToString("o")
        updated_at    = (Get-Date).ToString("o")
    } | ConvertTo-Json

    try {
        Invoke-RestMethod `
            -Uri "$SUPABASE_URL/rest/v1/profiles?id=eq.$userId" `
            -Method PATCH `
            -Headers $headers `
            -Body $body | Out-Null
        Write-Host "  [DB] Perfil ativado" -ForegroundColor Green
    } catch {
        # Tenta upsert se PATCH falhar (perfil pode não existir)
        try {
            Invoke-RestMethod `
                -Uri "$SUPABASE_URL/rest/v1/profiles" `
                -Method POST `
                -Headers ($headers + @{ "Prefer" = "resolution=merge-duplicates" }) `
                -Body $body | Out-Null
            Write-Host "  [DB] Perfil criado via upsert" -ForegroundColor Green
        } catch {
            Write-Host "  [DB] Aviso ao salvar perfil: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

function Montar-EmailAcesso($primeiroNome, $email, $senha, $plano) {
    return @"
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#c0392b,#8e1a13);padding:32px 36px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800">JM MapStudio</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px">JM Topografia e Engenharia</p>
    </div>
    <div style="padding:36px">
      <h2 style="margin:0 0 8px;color:#1a1a2e;font-size:18px">Olá, $primeiroNome! 🎉</h2>
      <p style="color:#555;line-height:1.7;margin:0 0 24px">
        Seu pagamento foi confirmado. Segue abaixo seus dados de acesso ao <strong>JM MapStudio</strong>.
      </p>
      <div style="background:#f8f9fa;border:1.5px solid #e0e0e0;border-radius:10px;padding:20px 24px;margin-bottom:24px">
        <p style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;color:#888">Suas credenciais</p>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#555;font-size:13px;width:90px">Login:</td>
              <td style="padding:6px 0;color:#1a1a2e;font-size:13px;font-weight:600">$email</td></tr>
          <tr><td style="padding:6px 0;color:#555;font-size:13px">Senha:</td>
              <td style="padding:6px 0;color:#c0392b;font-size:16px;font-weight:800;letter-spacing:2px;font-family:monospace">$senha</td></tr>
          <tr><td style="padding:6px 0;color:#555;font-size:13px">Plano:</td>
              <td style="padding:6px 0;color:#1a1a2e;font-size:13px;font-weight:600">$plano</td></tr>
        </table>
      </div>
      <div style="text-align:center;margin-bottom:24px">
        <a href="$APP_URL" style="display:inline-block;background:linear-gradient(135deg,#c0392b,#922b21);color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
          Acessar o JM MapStudio →
        </a>
      </div>
      <div style="background:#fff8e1;border:1px solid #ffd54f;border-radius:8px;padding:14px 16px;margin-bottom:24px">
        <p style="margin:0;font-size:12px;color:#795548;line-height:1.6">
          ⚠️ <strong>Recomendamos trocar sua senha</strong> após o primeiro acesso.<br>
          Dentro da plataforma, clique em <strong>"Minha conta"</strong> → <strong>"Alterar senha"</strong>.
        </p>
      </div>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="margin:0;font-size:12px;color:#999;text-align:center;line-height:1.7">
        Dúvidas? <a href="mailto:comercial@jmtopografiaeng.com" style="color:#c0392b;text-decoration:none">comercial@jmtopografiaeng.com</a>
        · (21) 99997-6196
      </p>
    </div>
  </div>
</body>
</html>
"@
}

# ── EXECUÇÃO PRINCIPAL ─────────────────────────────────────────

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "  JM MapStudio — Reenvio Manual de Acesso" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

# Validar configurações mínimas
if ($SERVICE_ROLE_KEY -eq "COLE_AQUI_SUA_SERVICE_ROLE_KEY") {
    Write-Host "ERRO: Preencha a SERVICE_ROLE_KEY no início do script!" -ForegroundColor Red
    Write-Host "Encontre em: Supabase Dashboard → Settings → API → service_role" -ForegroundColor Yellow
    exit 1
}

if ($compradores[0].email -like "*@exemplo.com") {
    Write-Host "ERRO: Preencha os e-mails reais dos compradores no script!" -ForegroundColor Red
    exit 1
}

$resultados = @()

foreach ($c in $compradores) {
    $email = $c.email.Trim().ToLower()
    $nome  = $c.nome.Trim()
    $plano = $c.plano
    $primeiroNome = ($nome -split " ")[0]

    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host "  Comprador: $nome <$email>" -ForegroundColor White
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray

    # 1. Buscar ou criar usuário
    $usuario = Buscar-Usuario $email
    $senha   = Gerar-Senha
    $userId  = $null

    if ($usuario) {
        $userId = $usuario.id
        Write-Host "  [Auth] Usuário existente: $userId" -ForegroundColor Yellow
        Write-Host "  [Auth] Definindo nova senha provisória..."
        $ok = Definir-Senha $userId $senha
        if (-not $ok) {
            Write-Host "  [Auth] Falha ao definir senha — pulando" -ForegroundColor Red
            continue
        }
    } else {
        Write-Host "  [Auth] Usuário não encontrado — criando..."
        $novoUser = Criar-Usuario $email $nome $senha
        if ($novoUser -and $novoUser.id) {
            $userId = $novoUser.id
            Write-Host "  [Auth] Criado: $userId" -ForegroundColor Green
        } else {
            Write-Host "  [Auth] Falha ao criar usuário — pulando" -ForegroundColor Red
            continue
        }
    }

    # 2. Ativar perfil no banco
    Write-Host "  [DB] Ativando perfil..."
    Ativar-Perfil $userId $email $nome $plano

    # 3. Enviar e-mail
    Write-Host "  [Email] Enviando e-mail de acesso..."
    $html = Montar-EmailAcesso $primeiroNome $email $senha $plano
    $enviado = Enviar-Email $email "✅ Acesso liberado ao JM MapStudio" $html

    $resultados += [PSCustomObject]@{
        Email   = $email
        Nome    = $nome
        UserId  = $userId
        Senha   = $senha
        Email   = if ($enviado) { "✅ Enviado" } else { "❌ FALHOU" }
    }

    Start-Sleep -Seconds 1  # Evitar rate limit do Resend
}

# ── RESUMO FINAL ─────────────────────────────────────────────
Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "  RESUMO" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

foreach ($r in $resultados) {
    Write-Host "`nComprador: $($r.Nome) <$($r.Email)>"
    Write-Host "  User ID: $($r.UserId)"
    Write-Host "  Senha:   $($r.Senha)" -ForegroundColor Yellow
    Write-Host "  Status:  $($r.Email)"
}

Write-Host "`n⚠️  IMPORTANTE: Guarde as senhas acima em local seguro." -ForegroundColor Yellow
Write-Host "   Os compradores receberão o e-mail com as credenciais."
Write-Host "   Oriente-os a trocar a senha após o primeiro acesso.`n"
