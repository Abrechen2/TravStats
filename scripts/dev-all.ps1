# Startet Backend (Port 8000) und Frontend (Port 3000) parallel.
$root = Split-Path -Parent $PSScriptRoot
Write-Host "TravStats Dev — Backend :8000 | Frontend :3000" -ForegroundColor Cyan
$backend  = Start-Process "npm" -ArgumentList "run","dev" -WorkingDirectory "$root\backend"  -PassThru
$frontend = Start-Process "npm" -ArgumentList "run","dev" -WorkingDirectory "$root\frontend" -PassThru
Write-Host "PIDs — Backend: $($backend.Id)  Frontend: $($frontend.Id)" -ForegroundColor Green
Write-Host "Beide Prozesse stoppen: taskkill /F /PID $($backend.Id) /PID $($frontend.Id)"
Wait-Process -Id $backend.Id, $frontend.Id
