@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem ASCII-only script: UTF-8 Cyrillic breaks cmd.exe parenthesis blocks on many PCs.

set "PY="
where py >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%I in ('py -3 -c "import sys; print(sys.executable)" 2^>nul') do set "PY=%%I"
)
if not defined PY (
  where python >nul 2>&1
  if not errorlevel 1 (
    for /f "delims=" %%I in ('python -c "import sys; print(sys.executable)" 2^>nul') do set "PY=%%I"
  )
)
if not defined PY (
  where python3 >nul 2>&1
  if not errorlevel 1 (
    for /f "delims=" %%I in ('python3 -c "import sys; print(sys.executable)" 2^>nul') do set "PY=%%I"
  )
)

if not defined PY (
  echo [error] Python 3.10+ not found in PATH.
  echo Install from https://www.python.org/ and enable "Add python.exe to PATH".
  echo Or install from Microsoft Store, then reopen this window.
  pause
  exit /b 1
)

echo [setup] Using: %PY%

if not exist ".venv\Scripts\python.exe" (
  echo [setup] Creating .venv ...
  "%PY%" -m venv .venv
  if errorlevel 1 (
    echo [error] Failed to create .venv
    pause
    exit /b 1
  )
)

set "VENV_PY=%~dp0.venv\Scripts\python.exe"
if not exist "%VENV_PY%" (
  echo [error] Missing "%VENV_PY%"
  pause
  exit /b 1
)

echo [setup] Installing requirements.txt ...
"%VENV_PY%" -m pip install --upgrade pip
if errorlevel 1 (
  echo [error] pip upgrade failed
  pause
  exit /b 1
)
"%VENV_PY%" -m pip install -r "%~dp0requirements.txt"
if errorlevel 1 (
  echo [error] pip install failed
  pause
  exit /b 1
)

echo [start] Starting Flask UI. Chrome should open automatically...
"%VENV_PY%" "%~dp0app.py"
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo [error] app.py exited with code %EC%
)
pause
exit /b %EC%
