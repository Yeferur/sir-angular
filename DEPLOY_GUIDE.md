# Guía de Despliegue Sir-Angular en VPS (Ubuntu + Nginx + PM2)

## 📋 Resumen de cambios realizados

1. ✅ Puerto WebSocket cambiado de **5000** a **6000**
2. ✅ Frontend WebSocket configurado para usar URL dinámica (`/ws`)
3. ✅ Archivo Nginx configurado para proxy reverso
4. ✅ Archivo PM2 ecosystem creado para gestionar procesos
5. ✅ Variables de entorno separadas para producción

---

## 🚀 Instrucciones de despliegue en VPS

### Paso 1: Preparar el VPS (una sola vez)

```bash
# Actualizar sistema
sudo apt update
sudo apt upgrade -y

# Instalar Node.js 18+ y npm
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Instalar Nginx
sudo apt install -y nginx

# Instalar PM2 globalmente
sudo npm install -g pm2

# Instalar serve para servir el frontend
sudo npm install -g serve

# (Opcional) Instalar Certbot para SSL
sudo apt install -y certbot python3-certbot-nginx
```

### Paso 2: Clonar/Copiar el proyecto

```bash
cd /home/ubuntu
git clone tu_repositorio.git sir-angular
# O copiar por SCP/SFTP

cd sir-angular
```

### Paso 3: Instalar dependencias

```bash
# Backend
cd backend
npm install
# Crear directorio de logs
mkdir -p logs

cd ../frontend
npm install

# Construir el frontend (solo una vez)
npm run build
```

### Paso 4: Configurar variables de entorno

```bash
# Backend - Copiar .env.production a .env
cd backend
cp .env.production .env

# Editar con tus valores reales
nano .env
# Cambiar:
# - DB_HOST (si es remoto)
# - DB_USER
# - DB_PASS
# - JWT_SECRET (con algo más seguro)
```

### Paso 5: Actualizar rutas en ecosystem.config.js

```bash
nano ecosystem.config.js
# Cambiar:
# - /home/ubuntu/sir-angular por tu ruta actual (si es diferente)
```

### Paso 6: Configurar Nginx

```bash
# Copiar configuración
sudo cp nginx.conf /etc/nginx/sites-available/sir-angular

# Editar para tu dominio
sudo nano /etc/nginx/sites-available/sir-angular
# Cambiar "tu_dominio.com" por tu dominio real

# Habilitar sitio
sudo ln -s /etc/nginx/sites-available/sir-angular /etc/nginx/sites-enabled/

# Desactivar default (opcional)
sudo rm /etc/nginx/sites-enabled/default

# Verificar sintaxis
sudo nginx -t

# Reiniciar Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx  # Para que inicie con el sistema
```

### Paso 7: Iniciar aplicaciones con PM2

```bash
# Desde la raíz del proyecto
pm2 start ecosystem.config.js

# Guardar configuración de PM2 para que arranque con el SO
pm2 startup
pm2 save

# Ver estado
pm2 status
pm2 logs
```

### Paso 8: Configurar SSL (Letsencrypt)

```bash
# Solo si tienes un dominio válido
sudo certbot --nginx -d tu_dominio.com -d www.tu_dominio.com

# El certificado se renovará automáticamente
```

---

## 🔍 Verificación

```bash
# Ver si todo está corriendo
pm2 status

# Ver logs en tiempo real
pm2 logs sir-backend
pm2 logs sir-frontend

# Verificar puertos
netstat -tlnp | grep -E ':(3000|4000|6000|80|443)'

# Verificar Nginx
curl localhost  # Debe responder con Angular
curl localhost/api/  # Debe conectar al backend
```

---

## 🛠️ Tareas comunes

### Actualizar código

```bash
cd /home/ubuntu/sir-angular

# Pull código
git pull origin main

# Backend
cd backend && npm install && cd ..

# Frontend (solo si hay cambios)
cd frontend && npm install && npm run build && cd ..

# Reiniciar procesos
pm2 restart sir-backend sir-frontend
```

### Ver logs

```bash
pm2 logs sir-backend
pm2 logs sir-frontend
pm2 monit  # Monitor en tiempo real
```

### Detener/Reiniciar

```bash
pm2 stop sir-backend
pm2 restart sir-backend
pm2 restart all
```

---

## 📝 Puertos en uso

- **80/443** - Nginx (frontal público)
- **3000** - Frontend (solo accesible desde Nginx)
- **4000** - Backend API (solo accesible desde Nginx)
- **6000** - WebSocket (solo accesible desde Nginx)

---

## 🔐 Seguridad - Cambios obligatorios

⚠️ **ANTES de subir a producción, cambiar:**

1. `JWT_SECRET` en `.env`
2. Contraseña de base de datos (`DB_PASS`)
3. Dominio en `nginx.conf`
4. Ruta de proyecto en `ecosystem.config.js` si es diferente

---

## 📞 Troubleshooting

### WebSocket no conecta
- ✅ Verificar que puerto 6000 está abierto
- ✅ Verificar que Nginx proxy a `/ws`
- ✅ Ver logs: `pm2 logs sir-backend`

### Frontend no ve API
- ✅ Verificar URL en Frontend `environment.ts` (debe ser relativa `/api`)
- ✅ Verificar que Nginx proxea `/api` al puerto 4000

### PM2 no inicia
- ✅ Verificar rutas en `ecosystem.config.js`
- ✅ Ver logs: `pm2 logs`
- ✅ Verificar permisos: `sudo pm2 startup`

