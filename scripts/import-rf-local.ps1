param([switch]$AllUFs)

$ErrorActionPreference = "Stop"

$DB_URL  = $env:DATABASE_URL
if (-not $DB_URL) { throw "Defina a variavel de ambiente DATABASE_URL antes de rodar." }
$RF_BASE = "https://dadosabertos.rfb.gov.br/CNPJ"
$DATA    = if ($env:RF_DATA_DIR) { $env:RF_DATA_DIR } else { Join-Path $PSScriptRoot "..\rf-data" }
$UF_FLAG = if ($AllUFs) { @() } else { @("--uf", "SP") }

function Download($url, $dest) {
    Write-Host "  Baixando $url ..."
    $attempt = 0
    while ($attempt -lt 5) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $dest -TimeoutSec 300 -UseBasicParsing
            return
        } catch {
            $attempt++
            Write-Host "  Tentativa $attempt falhou: $($_.Exception.Message). Aguardando 30s..."
            Start-Sleep -Seconds 30
        }
    }
    throw "Falhou apos 5 tentativas: $url"
}

function FixCsvExtensions($dir) {
    Get-ChildItem $dir -File | Where-Object { $_.Extension -eq "" } | ForEach-Object {
        Rename-Item $_.FullName "$($_.FullName).csv"
    }
}

function RunImport($extraArgs) {
    $env:DATABASE_URL = $DB_URL
    $tsx    = "node_modules\tsx\dist\cli.mjs"
    $script = "scripts\import-receita-federal.ts"
    $args   = @($tsx, $script,
        "--empresas",         "$DATA\empresas",
        "--estabelecimentos", "$DATA\estabelecimentos",
        "--municipios",       "$DATA\Municipios.csv"
    ) + $UF_FLAG + $extraArgs
    node @args
    if ($LASTEXITCODE -ne 0) { throw "Import falhou (exit $LASTEXITCODE)" }
}

$scope = if ($AllUFs) { "Brasil todo" } else { "apenas SP" }
Write-Host ""
Write-Host "=== Import Receita Federal ($scope) ===" -ForegroundColor Cyan
Write-Host "  DB: $DB_URL"
Write-Host ""

New-Item -ItemType Directory -Force -Path "$DATA\empresas"         | Out-Null
New-Item -ItemType Directory -Force -Path "$DATA\estabelecimentos" | Out-Null

# 1. Municipios
Write-Host "[1/4] Municipios..." -ForegroundColor Yellow
Download "$RF_BASE/Municipios.zip" "$DATA\Municipios.zip"
Expand-Archive -Force "$DATA\Municipios.zip" -DestinationPath $DATA
FixCsvExtensions $DATA
Remove-Item "$DATA\Municipios.zip" -Force
Write-Host "  OK" -ForegroundColor Green

# 2. Empresas (10 ZIPs)
Write-Host "[2/4] Empresas (0-9)..." -ForegroundColor Yellow
for ($i = 0; $i -le 9; $i++) {
    Write-Host "  Empresas$i.zip"
    Download "$RF_BASE/Empresas$i.zip" "$DATA\Empresas$i.zip"
    Expand-Archive -Force "$DATA\Empresas$i.zip" -DestinationPath "$DATA\empresas"
    FixCsvExtensions "$DATA\empresas"
    Remove-Item "$DATA\Empresas$i.zip" -Force
}
Write-Host "  OK" -ForegroundColor Green

# 3. Estabelecimentos chunk por chunk
Write-Host "[3/4] Estabelecimentos (chunk por chunk)..." -ForegroundColor Yellow
for ($i = 0; $i -le 9; $i++) {
    Write-Host "  Chunk $($i+1)/10: Estabelecimentos$i.zip" -ForegroundColor Cyan
    Download "$RF_BASE/Estabelecimentos$i.zip" "$DATA\Estabelecimentos$i.zip"
    Expand-Archive -Force "$DATA\Estabelecimentos$i.zip" -DestinationPath "$DATA\estabelecimentos"
    FixCsvExtensions "$DATA\estabelecimentos"
    Remove-Item "$DATA\Estabelecimentos$i.zip" -Force

    RunImport @("--skip-empresas")

    Remove-Item "$DATA\estabelecimentos\*.csv" -Force
}
Write-Host "  OK" -ForegroundColor Green

# 4. Pass final
Write-Host "[4/4] Atualizando razao social e porte..." -ForegroundColor Yellow
RunImport @("--skip-estab")
Write-Host "  OK" -ForegroundColor Green

Remove-Item $DATA -Recurse -Force
Write-Host ""
Write-Host "=== Concluido! ===" -ForegroundColor Green
