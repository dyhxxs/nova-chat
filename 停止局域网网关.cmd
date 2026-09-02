@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop_lan_download.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop_lan_gateway.ps1"
echo.
pause
