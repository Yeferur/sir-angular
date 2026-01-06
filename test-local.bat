@echo off
REM Script para probar la configuración antes de subir a VPS
REM Requiere Node.js instalado

echo ========================================
echo   Sir-Angular - Prueba Local
echo ========================================
echo.

REM Verificar Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Node.js no está instalado
    pause
    exit /b 1
)

REM Verificar PM2
pm2 -v >nul 2>&1
if %errorlevel% neq 0 (
    echo Instalando PM2 globalmente...
    npm install -g pm2
)

echo.
echo [1] Instalando dependencias...
cd backend
call npm install
if %errorlevel% neq 0 goto error
cd ..
cd frontend
call npm install
if %errorlevel% neq 0 goto error
cd ..

echo.
echo [2] Deteniendo procesos anteriores...
pm2 delete sir-backend sir-frontend 2>nul

echo.
echo [3] Iniciando aplicaciones con PM2...
pm2 start ecosystem.config.js

echo.
echo [4] Guardando configuración PM2...
pm2 save

echo.
echo ========================================
echo   ✓ Todo listo!
echo ========================================
echo.
echo URLs para probar:
echo   Frontend: http://localhost:3000 (o http://localhost si Nginx está activo)
echo   API:      http://localhost:4000/api
echo   WebSocket: ws://localhost:6000
echo.
echo Comandos útiles:
echo   pm2 logs                - Ver logs en tiempo real
echo   pm2 status              - Ver estado
echo   pm2 restart all         - Reiniciar
echo   pm2 stop all            - Detener
echo.
pause
goto end

:error
echo.
echo Error durante la instalación
pause
exit /b 1

:end
