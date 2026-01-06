# Sir-Angular - Cambios para Producción

## ✅ Cambios realizados

### 1️⃣ Puerto WebSocket: 5000 → 6000
- `backend/websocket.js` - Puerto cambiado a 6000
- `frontend/src/app/services/WebSocket/web-socket.ts` - URL dinámica

### 2️⃣ Configuración de producción
- `ecosystem.config.js` - Configuración PM2 lista
- `nginx.conf` - Proxy reverso configurado
- `backend/.env.production` - Variables de producción
- `DEPLOY_GUIDE.md` - Guía completa de despliegue
- `deploy.sh` - Script de automatización

### 3️⃣ Cambios clave

#### Backend (`server.js`)
```
Puerto API: 4000 ✅
Puerto WebSocket: 6000 ✅
```

#### Frontend (Angular)
```
WebSocket conecta a: /ws (a través de Nginx)
API conecta a: /api (a través de Nginx)
Ambas URLs relativas (funcionan en cualquier dominio)
```

#### Nginx
```
:80/443 (público)
  → localhost:3000 (frontend)
  → localhost:4000 (API /api)
  → localhost:6000 (WebSocket /ws)
```

---

## 🚀 Despliegue rápido en VPS

```bash
# En tu máquina local - preparar
cd /ruta/del/proyecto

# Copiar a VPS
scp -r . ubuntu@tu_vps:/home/ubuntu/sir-angular/

# En el VPS
ssh ubuntu@tu_vps
cd /home/ubuntu/sir-angular

# Hacer ejecutable el script
chmod +x deploy.sh

# Ejecutar
./deploy.sh

# Configurar Nginx
sudo cp nginx.conf /etc/nginx/sites-available/sir-angular
sudo nano /etc/nginx/sites-available/sir-angular  # Cambiar dominio
sudo ln -s /etc/nginx/sites-available/sir-angular /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 📋 Checklist antes de producción

- [ ] Cambiar `JWT_SECRET` en `backend/.env`
- [ ] Cambiar contraseña de BD en `backend/.env`
- [ ] Actualizar dominio en `nginx.conf`
- [ ] Verificar ruta del proyecto en `ecosystem.config.js`
- [ ] Instalar certificado SSL (Certbot)
- [ ] Probar WebSocket: `pm2 logs sir-backend`
- [ ] Probar API: `curl localhost/api/`

---

## 📞 Comandos útiles en VPS

```bash
# Ver estado
pm2 status

# Ver logs
pm2 logs sir-backend
pm2 logs sir-frontend

# Reiniciar
pm2 restart all

# Actualizar código
git pull && ./deploy.sh

# Ver puertos en uso
netstat -tlnp | grep -E ':(3000|4000|6000|80|443)'
```

---

## 🔗 Archivos importantes

- **Despliegue**: `DEPLOY_GUIDE.md` (guía completa)
- **Automatización**: `deploy.sh` (script de instalación)
- **PM2**: `ecosystem.config.js` (gestión de procesos)
- **Nginx**: `nginx.conf` (configuración web server)
- **Backend .env**: `backend/.env.production` (variables)

---

## ⚠️ IMPORTANTE

**El WebSocket ahora se conecta automáticamente a `/ws` en lugar de `localhost:5000`**

Esto significa que funcionará:
- ✅ En desarrollo: `http://localhost:4200/ws` 
- ✅ En producción: `https://tudominio.com/ws`
- ✅ Automáticamente con HTTP o HTTPS

No hay hardcoding de localhost, es completamente dinámico.

