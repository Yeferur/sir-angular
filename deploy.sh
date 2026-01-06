#!/bin/bash

# Script de despliegue rápido para Sir-Angular
# Uso: ./deploy.sh

set -e

echo "🚀 Iniciando despliegue de Sir-Angular..."

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar que PM2 está instalado
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 no está instalado. Instálalo con: npm install -g pm2${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Instalando dependencias backend...${NC}"
cd backend
npm install
mkdir -p logs
cd ..

echo -e "${YELLOW}📦 Instalando dependencias frontend...${NC}"
cd frontend
npm install
echo -e "${YELLOW}🏗️  Construyendo frontend...${NC}"
npm run build
cd ..

echo -e "${YELLOW}⚙️  Configurando variables de entorno...${NC}"
if [ ! -f backend/.env ]; then
    cp backend/.env.production backend/.env
    echo -e "${YELLOW}⚠️  Archivo .env creado. ¡EDITA LOS VALORES ANTES DE INICIAR!${NC}"
    echo -e "${YELLOW}   nano backend/.env${NC}"
    read -p "Presiona Enter cuando hayas configurado .env..."
fi

echo -e "${YELLOW}📋 Actualizando rutas en ecosystem.config.js...${NC}"
CURRENT_PATH=$(pwd)
echo -e "${YELLOW}   Ruta actual: ${CURRENT_PATH}${NC}"

echo -e "${YELLOW}🛑 Deteniendo aplicaciones anteriores...${NC}"
pm2 delete sir-backend sir-frontend 2>/dev/null || true

echo -e "${YELLOW}🚀 Iniciando aplicaciones con PM2...${NC}"
pm2 start ecosystem.config.js

echo -e "${YELLOW}💾 Guardando configuración PM2...${NC}"
pm2 save

echo -e "${GREEN}✅ ¡Despliegue completado!${NC}"
echo ""
echo -e "${GREEN}Estado actual:${NC}"
pm2 status

echo ""
echo -e "${YELLOW}Próximos pasos:${NC}"
echo "1. Verificar logs: pm2 logs"
echo "2. Configurar Nginx (ver DEPLOY_GUIDE.md)"
echo "3. Acceder a: http://localhost"
echo ""
