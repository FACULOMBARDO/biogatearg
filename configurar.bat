@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  ===== Configuración de Flex Scanner =====
echo.
echo  Usá solo letras y números en la contraseña (sin espacios ni símbolos).
echo.
set /p CID=  App ID (Client ID) de Mercado Libre: 
set /p CSEC=  Clave secreta (Client Secret) de Mercado Libre: 
set /p DOM=  Tu dominio de ngrok (ej: pepito.ngrok-free.app): 
set /p PASS=  Contraseña para entrar al panel: 
set /p TOKEN=  Authtoken de ngrok (Enter para saltear si ya lo cargaste): 

set "DOM=%DOM:https://=%"
set "DOM=%DOM:http://=%"
set "DOM=%DOM:/=%"

> .env echo ML_CLIENT_ID=%CID%
>> .env echo ML_CLIENT_SECRET=%CSEC%
>> .env echo BASE_URL=https://%DOM%
>> .env echo ADMIN_PASSWORD=%PASS%

if not "%TOKEN%"=="" (
  if exist "%~dp0ngrok.exe" ( "%~dp0ngrok.exe" config add-authtoken %TOKEN% ) else ( ngrok config add-authtoken %TOKEN% )
)

echo.
echo  Listo, configuración guardada.
echo.
echo  IMPORTANTE: en tu aplicación de Mercado Libre, la "URI de redirect" tiene que ser exactamente:
echo.
echo      https://%DOM%/auth/callback
echo.
echo  Después abrí iniciar.bat
echo.
pause
