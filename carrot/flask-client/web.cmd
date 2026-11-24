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

set "VENV_PY=%~dp0.venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
  echo [setup] Creating .venv ...
  "%PY%" -m venv .venv
  if errorlevel 1 (
    echo [error] Failed to create .venv
    pause
    exit /b 1
  )
)

if not exist "%VENV_PY%" (
  echo [error] Missing "%VENV_PY%"
  pause
  exit /b 1
)

rem Smoke-check pip. Broken _vendor (e.g. rich.segment) is common after a
rem partial upgrade or copying .venv between machines / network drives.
"%VENV_PY%" -c "import pip" >nul 2>&1
if errorlevel 1 goto :repair_venv

echo [setup] Installing requirements.txt ...
"%VENV_PY%" -m pip install --upgrade pip
if errorlevel 1 goto :repair_venv

"%VENV_PY%" -m pip install -r "%~dp0requirements.txt"
if errorlevel 1 (
  echo [warn] pip install failed — trying ensurepip + retry ...
  "%VENV_PY%" -m ensurepip --upgrade >nul 2>&1
  "%VENV_PY%" -m pip install --upgrade pip
  if errorlevel 1 goto :repair_venv
  "%VENV_PY%" -m pip install -r "%~dp0requirements.txt"
  if errorlevel 1 goto :repair_venv
)

goto :start_app

:repair_venv
echo [warn] Broken or unusable .venv/pip — recreating .venv ...
if exist ".venv" (
  rmdir /s /q ".venv"
  if exist ".venv" (
    echo [error] Could not delete .venv. Close other programs using it, then delete the folder manually and rerun web.cmd.
    pause
    exit /b 1
  )
)
"%PY%" -m venv .venv
if errorlevel 1 (
  echo [error] Failed to recreate .venv
  pause
  exit /b 1
)
if not exist "%VENV_PY%" (
  echo [error] Missing "%VENV_PY%" after recreate
  pause
  exit /b 1
)
echo [setup] Installing requirements.txt into fresh .venv ...
"%VENV_PY%" -m pip install --upgrade pip
if errorlevel 1 (
  echo [error] pip upgrade failed on fresh .venv
  pause
  exit /b 1
)
"%VENV_PY%" -m pip install -r "%~dp0requirements.txt"
if errorlevel 1 (
  echo [error] pip install failed on fresh .venv
  pause
  exit /b 1
)

:start_app
echo [start] Starting Flask UI. Chrome should open automatically...
"%VENV_PY%" "%~dp0app.py"
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo [error] app.py exited with code %EC%
)
pause
exit /b %EC%
