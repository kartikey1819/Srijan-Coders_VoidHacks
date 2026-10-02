@echo off
rem Abhedya-Chakra: one-click start. Opens http://127.0.0.1:8000 once the engine is ready.
rem Analyses the official file on first start (about a minute), then reopens the last case in seconds.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Setting up Python packages for the first time...
  py -3.12 -m venv .venv || python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install -q -e .
)
if not exist "web\dist\index.html" (
  echo The web interface is not built. Run: cd web ^&^& npm install ^&^& npm run build
  pause
  exit /b 1
)
set DATA=data\VoidHacks8_MuleAccount_2M_Transactions.csv
if not exist "%DATA%" set DATA=data\sample.csv
start "" /b cmd /c "timeout /t 4 /nobreak >nul && start http://127.0.0.1:8000"
".venv\Scripts\python.exe" -m abhedya serve --data "%DATA%"
pause
