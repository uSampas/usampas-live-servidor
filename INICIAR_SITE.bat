@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   ==========================================
echo             uSampas LIVE
 echo      Seu mundo. Sua sala. Sua galera.
echo   ==========================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado.
  echo Instale a versao 20 ou superior: https://nodejs.org/
  echo.
  pause
  exit /b 1
)
echo Servidor disponivel em http://localhost:3000
echo Abra o link no Chrome ou Edge.
echo.
start "" http://localhost:3000
node server.js
echo.
pause
