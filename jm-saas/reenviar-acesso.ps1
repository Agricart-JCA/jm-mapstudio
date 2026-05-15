# ================================================================
# JM MapStudio - Reenvio Manual de Acesso (Gmail SMTP)
# ================================================================

$SUPABASE_URL     = "https://zzjizqiafnnuqmrkhjqj.supabase.co"
$SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6aml6cWlhZm5udXFtcmtoanFqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODY3OTc0MywiZXhwIjoyMDk0MjU1NzQzfQ.mCtufG0bkfCewLK6HpuPcU0dresa1pijm-mJPG-uVpQ"
$APP_URL          = "https://agricart-jca.github.io/jm-mapstudio"
$GMAIL_USER       = "juancarlos.agricart@gmail.com"
$GMAIL_APP_PASS   = "jqbbsqrrhxhdifvp"

$compradores = @(
    @{ email = "jordy.carlos@outlook.com";    nome = "Jordy Carlos"; plano = "Mensal" },
    @{ email = "leojp92@hotmail.com";         nome = "Leonardo";     plano = "Mensal" },
    @{ email = "thaisrocha.ufrrj@gmail.com";  nome = "Thais Rocha";  plano = "Mensal" }
)

# ================================================================

function Gerar-Senha {
    $M = "ABCDEFGHJKMNPQRSTUVWXYZ"
    $m = "abcdefghjkmnpqrstuvwxyz"
    $n = "23456789"
    $s = "!@#"
    $todos = $M + $m + $n + $s
    $arr = @(
        $M[(Get-Random -Maximum $M.Length)],
        $m[(Get-Random -Maximum $m.Length)],
        $n[(Get-Random -Maximum $n.Length)],
        $s[(Get-Random -Maximum $s.Length)]
    )
    for ($i = 0; $i -lt 8; $i++) { $arr += $todos[(Get-Random -Maximum $todos.Length)] }
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
        Write-Host "  [Email] Enviado com sucesso!" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  [Email] FALHOU: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

function Buscar-Usuario($email) {
    $headers = @{ "apikey" = $SERVICE_ROLE_KEY; "Authorization" = "Bearer $SERVICE_ROLE_KEY" }
    $pagina = 1
    while ($true) {
        try {
            $resp = Invoke-RestMethod -Uri "$SUPABASE_URL/auth/v1/admin/users?page=$pagina&per_page=50" -Method GET -Headers $headers
            $users = $resp.users
            if (-not $users -or $users.Count -eq 0) { break }
            $encontrado = $users | Where-Object { $_.email -eq $email }
            if ($encontrado) { return $encontrado }
            if ($users.Count -lt 50) { break }
            $pagina++
        } catch { break }
    }
    return $null
}

function Criar-Usuario($email, $nome, $senha) {
    $headers = @{ "apikey" = $SERVICE_ROLE_KEY; "Authorization" = "Bearer $SERVICE_ROLE_KEY"; "Content-Type" = "application/json" }
    $body = @{ email = $email; password = $senha; email_confirm = $true; user_metadata = @{ name = $nome } } | ConvertTo-Json -Depth 3
    try {
        return Invoke-RestMethod -Uri "$SUPABASE_URL/auth/v1/admin/users" -Method POST -Headers $headers -Body $body
    } catch {
        Write-Host "  [Auth] Erro ao criar: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

function Definir-Senha($userId, $novaSenha) {
    $headers = @{ "apikey" = $SERVICE_ROLE_KEY; "Authorization" = "Bearer $SERVICE_ROLE_KEY"; "Content-Type" = "application/json" }
    $body = @{ password = $novaSenha } | ConvertTo-Json
    try {
        Invoke-RestMethod -Uri "$SUPABASE_URL/auth/v1/admin/users/$userId" -Method PUT -Headers $headers -Body $body | Out-Null
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
        "Prefer"        = "resolution=merge-duplicates"
    }
    $body = @{
        id         = $userId
        email      = $email
        name       = $nome
        status     = "active"
        plan_name  = $plano.ToLower()
        updated_at = (Get-Date).ToString("o")
    } | ConvertTo-Json
    try {
        Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/profiles" -Method POST -Headers $headers -Body $body | Out-Null
        Write-Host "  [DB] Perfil ativado" -ForegroundColor Green
    } catch {
        Write-Host "  [DB] Aviso perfil: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Montar-Email($primeiroNome, $email, $senha, $plano) {
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
      <h2 style="margin:0 0 8px;color:#1a1a2e;font-size:18px">Ola, $primeiroNome!</h2>
      <p style="color:#555;line-height:1.7;margin:0 0 24px">Seu pagamento foi confirmado. Segue abaixo seus dados de acesso ao <strong>JM MapStudio</strong>.</p>
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
          Acessar o JM MapStudio
        </a>
      </div>
      <div style="background:#fff8e1;border:1px solid #ffd54f;border-radius:8px;padding:14px 16px;margin-bottom:24px">
        <p style="margin:0;font-size:12px;color:#795548;line-height:1.6">
          Recomendamos trocar sua senha apos o primeiro acesso.<br>
          Clique em "Minha conta" e depois "Alterar senha".
        </p>
      </div>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="margin:0;font-size:12px;color:#999;text-align:center;line-height:1.7">
        Duvidas? <a href="mailto:comercial@jmtopografiaeng.com" style="color:#c0392b;text-decoration:none">comercial@jmtopografiaeng.com</a>
        (21) 99997-6196
      </p>
    </div>
  </div>
</body>
</html>
"@
}

# ── EXECUCAO ──────────────────────────────────────────────────

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "  JM MapStudio - Reenvio de Acesso" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

$resultados = @()

foreach ($c in $compradores) {
    $email        = $c.email.Trim().ToLower()
    $nome         = $c.nome.Trim()
    $plano        = $c.plano
    $primeiroNome = ($nome -split " ")[0]

    Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  Comprador: $nome <$email>" -ForegroundColor White
    Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray

    $usuario = Buscar-Usuario $email
    $senha   = Gerar-Senha
    $userId  = $null

    if ($usuario) {
        $userId = $usuario.id
        Write-Host "  [Auth] Usuario existente: $userId" -ForegroundColor Yellow
        $ok = Definir-Senha $userId $senha
        if (-not $ok) { Write-Host "  [Auth] Falha ao definir senha" -ForegroundColor Red; continue }
    } else {
        Write-Host "  [Auth] Usuario nao encontrado - criando..."
        $novoUser = Criar-Usuario $email $nome $senha
        if ($novoUser -and $novoUser.id) {
            $userId = $novoUser.id
            Write-Host "  [Auth] Criado: $userId" -ForegroundColor Green
        } else {
            Write-Host "  [Auth] Falha ao criar usuario" -ForegroundColor Red
            continue
        }
    }

    Ativar-Perfil $userId $email $nome $plano

    Write-Host "  [Email] Enviando para $email..."
    $html    = Montar-Email $primeiroNome $email $senha $plano
    $enviado = Enviar-Email $email "Acesso liberado ao JM MapStudio" $html

    $statusEmail = if ($enviado) { "Enviado" } else { "FALHOU" }
    $resultados += [PSCustomObject]@{
        Nome   = $nome
        Email  = $email
        UserId = $userId
        Senha  = $senha
        Status = $statusEmail
    }

    Start-Sleep -Seconds 2
}

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "  RESUMO FINAL" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

foreach ($r in $resultados) {
    Write-Host "`nComprador: $($r.Nome) <$($r.Email)>"
    Write-Host "  User ID: $($r.UserId)"
    Write-Host "  Senha:   $($r.Senha)" -ForegroundColor Yellow
    Write-Host "  Email:   $($r.Status)"
}

Write-Host "`nGuarde as senhas acima em local seguro." -ForegroundColor Yellow
