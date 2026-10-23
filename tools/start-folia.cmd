@echo off
rem Start Folia through Explorer so it is NOT inside DSH's kill-on-close Job Object.
rem Double-click this file, or run:  start-folia.cmd -Restart
setlocal
set SCRIPT=%~dp0start-folia.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
echo.
pause
