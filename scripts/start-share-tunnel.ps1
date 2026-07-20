# Start local share API + HTTPS tunnel for GitHub Pages
# Usage: powershell -File scripts/start-share-tunnel.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "Ensure serve.py is listening on 127.0.0.1:8765 (python serve.py)"
Write-Host "Starting Cloudflare quick tunnel..."
Write-Host "Copy the https://*.trycloudflare.com URL into js/email-config.js apiUrl, then push Pages."
Write-Host ""

npx --yes cloudflared tunnel --url http://127.0.0.1:8765
