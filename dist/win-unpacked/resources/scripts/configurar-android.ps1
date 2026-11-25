<#
.SYNOPSIS
  Liga o botão "Android TV" do TV Box ao Android instalado em dual boot.
.DESCRIPTION
  Sem parâmetros: lista as entradas de boot (UEFI e do gerenciador do Windows) para você achar o Android.
  Com -Guid: cria a tarefa agendada "TVBox\ReiniciarNoAndroid" (roda como SYSTEM, sem janela de UAC),
  que marca o Android para o PRÓXIMO boot apenas e reinicia. Depois do Android, o PC volta a iniciar no Windows.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\configurar-android.ps1
  powershell -ExecutionPolicy Bypass -File .\configurar-android.ps1 -Guid '{1a2b3c4d-....}' -Firmware
.NOTES
  Rode como administrador.
  -Firmware: use quando a entrada aparece em "bcdedit /enum firmware" (GRUB do Bliss OS/Android-x86 em UEFI).
  Sem -Firmware: entrada criada no gerenciador de boot do Windows (ex.: instalador .exe do Android-x86).
#>
param(
  [string]$Guid,
  [switch]$Firmware
)
$ErrorActionPreference = 'Stop'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Abra o PowerShell como administrador.' }

if (-not $Guid) {
  Write-Host "=== Entradas UEFI (use com -Firmware) ===" -ForegroundColor Cyan
  bcdedit /enum firmware | Select-String -Pattern '^(identifier|identificador|description|descrição)' | ForEach-Object { $_.Line }
  Write-Host "`n=== Gerenciador de boot do Windows ===" -ForegroundColor Cyan
  bcdedit /enum osloader | Select-String -Pattern '^(identifier|identificador|description|descrição)' | ForEach-Object { $_.Line }
  Write-Host "`nProcure a entrada do Android (ex.: 'Bliss OS', 'Android-x86', 'GRUB', 'ubuntu') e rode de novo com -Guid '{...}'."
  return
}

if ($Guid -notmatch '^\{[0-9a-fA-F-]{36}\}$') { throw "GUID inválido: $Guid (formato {xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx})" }

$marcar = if ($Firmware) { "bcdedit /set {fwbootmgr} bootsequence $Guid" } else { "bcdedit /bootsequence $Guid" }
$cmd = "$marcar && shutdown /r /t 0"

$acao = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c $cmd"
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskPath '\TVBox\' -TaskName 'ReiniciarNoAndroid' -Action $acao -Principal $principal -Force | Out-Null

# Usuários comuns precisam poder disparar a tarefa (schtasks /run). Dá permissão de leitura+execução aos usuários autenticados.
try {
  $svc = New-Object -ComObject 'Schedule.Service'; $svc.Connect()
  $tarefa = $svc.GetFolder('\TVBox').GetTask('ReiniciarNoAndroid')
  $sddl = $tarefa.GetSecurityDescriptor(0xF)
  if ($sddl -notmatch '\(A;;GRGX;;;AU\)') { $tarefa.SetSecurityDescriptor($sddl + '(A;;GRGX;;;AU)', 0) }
} catch {
  Write-Warning "Não consegui liberar a tarefa para usuário comum ($($_.Exception.Message)). Se o botão falhar com 'Acesso negado', use uma conta administradora no TV Box."
}

Write-Host "Pronto. Tarefa \TVBox\ReiniciarNoAndroid criada: $cmd" -ForegroundColor Green
Write-Host 'Teste: schtasks /run /tn "TVBox\ReiniciarNoAndroid"  (o PC vai reiniciar no Android)'
