<#
  Cria o atalho "SisTI" na área de trabalho do Windows, com o ícone do sistema.
  O atalho abre o SisTI em janela própria (modo aplicativo do Edge ou do Chrome),
  sem barra de endereço; se nenhum dos dois existir, abre no navegador padrão.

  Uso (PowerShell, sem precisar de administrador):
    powershell -ExecutionPolicy Bypass -File criar-atalho.ps1 -Url https://sisti.empresa.local

  -TodosUsuarios  cria na área de trabalho pública (C:\Users\Public\Desktop); exige administrador.
  -Navegador      Edge (padrão), Chrome ou Padrao.
#>
param(
  [string]$Url = 'https://sisti.empresa.local',
  [ValidateSet('Edge', 'Chrome', 'Padrao')][string]$Navegador = 'Edge',
  [switch]$TodosUsuarios
)
$ErrorActionPreference = 'Stop'
$Url = $Url.TrimEnd('/')
if ($Url -notmatch '^https?://') { throw "Endereço inválido: $Url (use https://...)" }

# Ícone: fica numa pasta fixa, para o atalho não perder a imagem se o script for apagado.
$pastaIcone = if ($TodosUsuarios) { Join-Path $env:ProgramData 'SisTI' } else { Join-Path $env:LOCALAPPDATA 'SisTI' }
New-Item -ItemType Directory -Force $pastaIcone | Out-Null
$icone = Join-Path $pastaIcone 'sisti.ico'
$local = Join-Path $PSScriptRoot 'sisti.ico'
if (Test-Path $local) {
  Copy-Item $local $icone -Force
} else {
  try { Invoke-WebRequest -UseBasicParsing -Uri "$Url/sisti.ico" -OutFile $icone }
  catch { Write-Warning "Não consegui baixar o ícone de $Url/sisti.ico ($($_.Exception.Message)). O atalho usará o ícone do navegador." ; $icone = $null }
}

function Find-Navegador([string]$exe, [string[]]$pastas) {
  foreach ($p in $pastas) { if ($p) { $c = Join-Path $p $exe; if (Test-Path $c) { return $c } } }
  return $null
}
$edge = Find-Navegador 'msedge.exe' @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application", "$env:ProgramFiles\Microsoft\Edge\Application")
$chrome = Find-Navegador 'chrome.exe' @("$env:ProgramFiles\Google\Chrome\Application", "${env:ProgramFiles(x86)}\Google\Chrome\Application", "$env:LOCALAPPDATA\Google\Chrome\Application")
$exe = switch ($Navegador) { 'Edge' { if ($edge) { $edge } else { $chrome } } 'Chrome' { if ($chrome) { $chrome } else { $edge } } default { $null } }

$desktop = if ($TodosUsuarios) { [Environment]::GetFolderPath('CommonDesktopDirectory') } else { [Environment]::GetFolderPath('Desktop') }
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut((Join-Path $desktop 'SisTI.lnk'))
if ($exe) {
  $lnk.TargetPath = $exe
  $lnk.Arguments = "--app=$Url/"
  $lnk.WorkingDirectory = Split-Path $exe
} else {
  $lnk.TargetPath = "$env:WINDIR\explorer.exe"
  $lnk.Arguments = "$Url/"
}
if ($icone) { $lnk.IconLocation = "$icone,0" }
$lnk.Description = 'SisTI – Manutenção de TI'
$lnk.Save()
Write-Host "Atalho criado em $desktop\SisTI.lnk -> $Url"
