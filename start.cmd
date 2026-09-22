@echo off
cd /d "%~dp0"
set "PENDULUM_EXTENSIONS=0"
if not exist "node_modules\vite\bin\vite.js" (
  echo Initial setup has not been completed.
  echo Double-click setup.cmd first.
  pause
  exit /b 1
)
if not exist ".runtime\openfisca-venv\Scripts\python.exe" (
  echo Python/OpenFisca setup has not been completed.
  echo Double-click setup.cmd first.
  pause
  exit /b 1
)
start "OpenFisca MCP" /b ".runtime\openfisca-venv\Scripts\python.exe" "openfisca-http.py"
node dev-all.mjs
pause
