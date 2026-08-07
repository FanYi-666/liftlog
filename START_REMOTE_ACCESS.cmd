@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-remote-access.ps1"
echo.
echo Remote access stopped. Press any key to close.
pause >nul
