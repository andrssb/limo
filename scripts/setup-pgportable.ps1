param([string]$PgDir = "C:\pgsql", [string]$DataDir = "C:\pgdata")

$env:PATH += ";$PgDir\bin"

# 1. Init cluster
if (-not (Test-Path "$DataDir\PG_VERSION")) {
  Write-Host "Iniciando cluster PostgreSQL em $DataDir..."
  & "$PgDir\bin\initdb.exe" -D $DataDir -U postgres -E UTF8 -A trust
} else {
  Write-Host "Cluster já existe em $DataDir"
}

# 2. Start server
$status = & "$PgDir\bin\pg_ctl.exe" status -D $DataDir 2>&1
if ($status -match "no server running") {
  Write-Host "Subindo servidor PostgreSQL..."
  & "$PgDir\bin\pg_ctl.exe" start -D $DataDir -l "$DataDir\pg.log" -w
} else {
  Write-Host "Servidor já rodando"
}

Start-Sleep -Seconds 2

# 3. Create database
$dbExists = & "$PgDir\bin\psql.exe" -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='limo_db'" 2>&1
if ($dbExists -ne "1") {
  Write-Host "Criando banco limo_db..."
  & "$PgDir\bin\createdb.exe" -U postgres limo_db
} else {
  Write-Host "Banco limo_db já existe"
}

# 4. Run migrations
Write-Host "Rodando migrations..."
Set-Location (Join-Path $PSScriptRoot "..")
node --env-file=.env node_modules/tsx/dist/cli.mjs packages/db/src/migrate.ts
