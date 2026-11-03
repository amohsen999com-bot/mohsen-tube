@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
)
echo Starting Mohsen Tube on http://localhost:3000 ...
start "" "http://localhost:3000"
call npm run dev
pause
