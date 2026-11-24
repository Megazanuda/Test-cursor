@echo off
setlocal EnableExtensions

rem ============================================================
rem  Edit IP and port of the PC where web.cmd is already running.
rem  Example: HOST=172.17.97.71   PORT=3456
rem ============================================================
set "HOST=127.0.0.1"
set "PORT=3456"
rem ============================================================

set "URL=http://%HOST%:%PORT%"

echo Opening %URL% ...

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)

if defined CHROME (
  start "" "%CHROME%" "%URL%"
) else (
  start "" "%URL%"
)

exit /b 0
