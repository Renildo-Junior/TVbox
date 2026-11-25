<#
.SYNOPSIS
  Prepara o PC para o TV Box: instala os emuladores, baixa os cores do RetroArch e cria as pastas de jogos.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\instalar-emuladores.ps1
  powershell -ExecutionPolicy Bypass -File .\instalar-emuladores.ps1 -PastaJogos D:\Jogos -SemDolphin
.NOTES
  Rode como administrador (os instaladores do winget pedem). Precisa de internet.
  BIOS de PS1/PS2 e os jogos NÃO são baixados: use os dumps do seu próprio console/discos.
#>
param(
  [string]$PastaJogos = "$env:USERPROFILE\Jogos",
  [string]$PastaEmuladores = 'C:\Emuladores',
  [switch]$SemDolphin
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$falhas = @()

function Write-Etapa($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }

# --- 1. checagem do processador (PCSX2 2.x exige 64 bits + SSE4.1; AVX2 ajuda muito) ---
Write-Etapa 'Verificando o processador'
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
Write-Host "CPU: $($cpu.Name)  |  núcleos: $($cpu.NumberOfCores)  |  RAM: $([math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1)) GB"
if (-not [Environment]::Is64BitOperatingSystem) { Write-Warning 'Windows 32 bits: PCSX2, DuckStation e o próprio TV Box exigem 64 bits.' }

# --- 2. emuladores via winget ---
Write-Etapa 'Instalando emuladores (winget)'
$pacotes = [ordered]@{
  'RetroArch' = 'Libretro.RetroArch'
  'PCSX2'     = 'PCSX2Team.PCSX2'
  'PPSSPP'    = 'PPSSPPTeam.PPSSPP'
}
if (-not $SemDolphin) { $pacotes['Dolphin'] = 'DolphinEmulator.Dolphin' }

if (Get-Command winget -ErrorAction SilentlyContinue) {
  foreach ($nome in $pacotes.Keys) {
    Write-Host "- $nome ($($pacotes[$nome]))"
    winget install --id $pacotes[$nome] -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { $falhas += "$nome (winget código $LASTEXITCODE)" } # -1978335189 = já instalado
  }
} else {
  Write-Warning 'winget não encontrado (Windows antigo?). Instale manualmente pelos sites listados no fim.'
  $falhas += $pacotes.Keys
}

# --- 3. DuckStation (PS1) — versão portátil oficial ---
Write-Etapa 'Baixando DuckStation (PS1)'
try {
  $destino = Join-Path $PastaEmuladores 'DuckStation'
  New-Item -ItemType Directory -Force $destino | Out-Null
  $zip = Join-Path $env:TEMP 'duckstation.zip'
  Invoke-WebRequest 'https://github.com/stenzek/duckstation/releases/download/latest/duckstation-windows-x64-release.zip' -OutFile $zip -UseBasicParsing
  Expand-Archive $zip -DestinationPath $destino -Force
  Remove-Item $zip
  Write-Host "OK em $destino"
} catch { $falhas += "DuckStation ($($_.Exception.Message))" }

# --- 4. cores do RetroArch ---
Write-Etapa 'Baixando cores do RetroArch'
$ra = @('C:\RetroArch-Win64', (Join-Path $PastaEmuladores 'RetroArch')) | Where-Object { Test-Path (Join-Path $_ 'retroarch.exe') } | Select-Object -First 1
if ($ra) {
  $cores = Join-Path $ra 'cores'
  New-Item -ItemType Directory -Force $cores | Out-Null
  # pcsx_rearmed = PS1 que roda SEM BIOS (usado pelo TV Box enquanto a pasta bios\ps1 estiver vazia)
  foreach ($core in 'snes9x', 'fceumm', 'genesis_plus_gx', 'mgba', 'mupen64plus_next', 'fbneo', 'pcsx_rearmed') {
    try {
      $zip = Join-Path $env:TEMP "$core.zip"
      Invoke-WebRequest "https://buildbot.libretro.com/nightly/windows/x86_64/latest/${core}_libretro.dll.zip" -OutFile $zip -UseBasicParsing
      Expand-Archive $zip -DestinationPath $cores -Force
      Remove-Item $zip
      Write-Host "- $core OK"
    } catch { $falhas += "core $core ($($_.Exception.Message))" }
  }
} else { $falhas += 'cores do RetroArch (retroarch.exe não encontrado)' }

# --- 5. pastas de jogos ---
Write-Etapa "Criando pastas de jogos em $PastaJogos"
foreach ($p in 'ps2', 'ps1', 'psp', 'gamecube', 'n64', 'snes', 'nes', 'megadrive', 'gba', 'arcade') {
  New-Item -ItemType Directory -Force (Join-Path $PastaJogos "$p\capas") | Out-Null
}
Write-Host 'Coloque cada jogo na pasta do sistema. Capa opcional: imagem com o mesmo nome do jogo (.png/.jpg) ao lado dele ou em "capas".'

# --- 6. pastas de BIOS (o TV Box copia daqui para cada emulador sozinho) ---
Write-Etapa "Criando pastas de BIOS em $PastaJogos\bios"
$leiame = @{
  'ps1'    = "BIOS do PlayStation 1 (ex.: SCPH1001.BIN, scph5501.bin), extraída do SEU console.`r`nSem BIOS aqui, o TV Box abre os jogos de PS1 no RetroArch (core PCSX ReARMed), que funciona sem ela.`r`nCom BIOS, usa o DuckStation (melhor compatibilidade)."
  'ps2'    = "BIOS do PlayStation 2 (arquivo .bin de ~4 MB, ex.: SCPH-39001), extraída do SEU console com o programa ps2bios-dumper.`r`nSem ela o PCSX2 não abre jogos."
  'arcade' = "BIOS de arcade para o FBNeo (ex.: neogeo.zip para jogos Neo-Geo; pgm.zip; decocass.zip).`r`nA maioria dos jogos de arcade não precisa de BIOS; só os da placa Neo-Geo e alguns outros."
}
foreach ($p in $leiame.Keys) {
  $dir = Join-Path $PastaJogos "bios\$p"
  New-Item -ItemType Directory -Force $dir | Out-Null
  Set-Content -Path (Join-Path $dir 'LEIA-ME.txt') -Value $leiame[$p] -Encoding UTF8
}
Write-Host 'Copie as BIOS para essas pastas; ao abrir, o TV Box distribui para o DuckStation, PCSX2 e RetroArch.'

# --- resumo ---
Write-Etapa 'Resumo'
if ($falhas.Count) {
  Write-Warning ("Não concluído: " + ($falhas -join '; '))
  Write-Host @'
Instalação manual:
  RetroArch   https://www.retroarch.com/?page=platforms
  PCSX2       https://pcsx2.net/downloads
  DuckStation https://github.com/stenzek/duckstation/releases
  PPSSPP      https://www.ppsspp.org/download
  Dolphin     https://dolphin-emu.org/download
Depois ajuste os caminhos em "emuladores" no config.json do TV Box.
'@
} else { Write-Host 'Tudo instalado.' -ForegroundColor Green }
Write-Host @'

Lembretes:
  - BIOS: copie para Jogos\bios\ps1, ps2 e arcade (dump do seu console). O TV Box distribui sozinho.
  - Controle: RetroArch reconhece sozinho. No PCSX2 e no DuckStation abra uma vez
    Configurações > Controles > Porta 1 > "Mapeamento automático" e escolha o controle.
  - Para sair de qualquer jogo ou app: SEGURE Select + Start por 1,5 s. O TV Box volta sozinho.
'@
