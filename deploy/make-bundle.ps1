# Creates chess-studio-bundle.tar.gz (without node_modules / local data) ready to copy to the server.
# Usage (from the project root):  powershell -ExecutionPolicy Bypass -File deploy\make-bundle.ps1
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$out = 'chess-studio-bundle.tar.gz'
if (Test-Path $out) { Remove-Item $out }
# Use Windows' own bsdtar explicitly (a GNU tar earlier on PATH mistakes "G:\" for a remote host).
& "$env:SystemRoot\System32\tar.exe" -czf $out `
  --exclude='node_modules' --exclude='.git' --exclude='data/bin' --exclude='data/*.sqlite*' `
  --exclude='apps/web/dist' --exclude='*.tar.gz' `
  package.json package-lock.json Dockerfile docker-compose.yml .dockerignore README.md packages apps data/openings data/counters.json deploy
if ($LASTEXITCODE -ne 0) { throw "tar failed ($LASTEXITCODE)" }
Write-Host "Created $((Resolve-Path $out).Path) ($([math]::Round((Get-Item $out).Length/1MB,2)) MB)"
