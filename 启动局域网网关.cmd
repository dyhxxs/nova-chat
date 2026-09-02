@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_lan_gateway.ps1" -GatewayHost "192.168.0.113"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_lan_download.ps1"
echo.
echo Nova Chat LAN services are ready.
pause
