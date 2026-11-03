Write-Host ""
Write-Host "=== LIMO - Iniciando ===" -ForegroundColor Green

# 1. Docker (Postgres, Redis, MinIO)
Write-Host "[1/4] Subindo infraestrutura (Docker)..." -ForegroundColor Cyan
docker compose up -d 2>&1 | Out-Null
Start-Sleep -Seconds 3
Write-Host "Infraestrutura OK!" -ForegroundColor Green

# 2. Migrations
Write-Host "[2/4] Rodando migrations..." -ForegroundColor Cyan
node --env-file=.env node_modules/tsx/dist/cli.mjs packages/db/src/migrate.ts
Write-Host "Banco OK!" -ForegroundColor Green

# 3. API via PM2 (reinicia automaticamente se cair)
Write-Host "[3/4] Iniciando API com PM2..." -ForegroundColor Cyan
$running = pm2 list 2>&1 | Select-String "limo-api"
if ($running) {
    pm2 restart limo-api 2>&1 | Out-Null
    Write-Host "API reiniciada no PM2" -ForegroundColor Green
} else {
    pm2 start ecosystem.config.cjs 2>&1 | Out-Null
    Write-Host "API iniciada no PM2" -ForegroundColor Green
}

# 4. Frontend em janela separada
Write-Host "[4/4] Iniciando Frontend..." -ForegroundColor Cyan
Start-Process "cmd.exe" -ArgumentList "/k", "cd /d `"$PSScriptRoot\apps\web`" && npx vite --port 3000"
Start-Sleep -Seconds 4

Write-Host ""
Write-Host "=== LIMO rodando ===" -ForegroundColor Green
Write-Host "  Frontend : http://localhost:3000" -ForegroundColor Yellow
Write-Host "  API      : http://localhost:3001" -ForegroundColor Yellow
Write-Host "  Logs API : pm2 logs limo-api" -ForegroundColor Yellow
Write-Host ""
Start-Process "http://localhost:3000"
