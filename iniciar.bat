@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Flex Scanner - ngrok

where node >nul 2>nul
if errorlevel 1 (
  echo Falta instalar Node.js. Bajalo de https://nodejs.org ^(versión LTS^), instalalo y volvé a abrir este archivo.
  pause & exit /b
)

set "NGROK=ngrok"
if exist "%~dp0ngrok.exe" (
  set "NGROK=%~dp0ngrok.exe"
) else (
  where ngrok >nul 2>nul
  if errorlevel 1 (
    echo Falta ngrok. Descargalo de https://ngrok.com/download y poné ngrok.exe en esta misma carpeta.
    pause & exit /b
  )
)

if not exist .env (
  echo Primero abrí configurar.bat
  pause & exit /b
)

if not exist node_modules (
  echo Instalando lo necesario ^(solo la primera vez^)...
  call npm install --omit=dev
)

for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="BASE_URL" set "BASE_URL=%%b"
set "DOMAIN=%BASE_URL:https://=%"

start "Flex Scanner - servidor" cmd /k node server.js
timeout /t 2 /nobreak >nul

echo.
echo  ==========================================================
echo   Panel ^(PC^):      %BASE_URL%
echo   Escáner ^(celu^):  %BASE_URL%/escanear
echo.
echo   Dejá esta ventana y la del servidor abiertas mientras escaneás.
echo   Para apagar todo, cerrá las dos ventanas.
echo  ==========================================================
echo.
start "" powershell -WindowStyle Hidden -Command "Start-Sleep 6; Start-Process '%BASE_URL%'"
"%NGROK%" http --url=%DOMAIN% 3000
pause
