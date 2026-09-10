Write-Host "=== Enabling WSL2 and Virtual Machine Platform ===" -ForegroundColor Cyan

# Enable required Windows features
dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /quiet /norestart
dism /online /enable-feature /featurename:VirtualMachinePlatform /all /quiet /norestart

Write-Host "`nFeatures enabled. Installing WSL2 kernel update..." -ForegroundColor Yellow
wsl --install -d Ubuntu --no-launch

Write-Host "`nSetting WSL2 as default..." -ForegroundColor Yellow
wsl --set-default-version 2

Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "A RESTART is required. After restart, run:"
Write-Host "  docker compose -f infra/docker-compose.test.yml up -d" -ForegroundColor Cyan
