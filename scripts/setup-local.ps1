$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot ".env.local"

@"
VITE_SUPABASE_URL=https://ezamgphhlkeqcntgvfvj.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_6YbXDlis6FDcj68SILDNdw__cDelwzT
"@ | Set-Content -Path $envPath -Encoding UTF8

Write-Host ""
Write-Host "Valora local environment configured successfully." -ForegroundColor Green
Write-Host "Created: $envPath"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  npm install"
Write-Host "  npm run dev"
Write-Host ""
