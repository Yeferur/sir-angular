# Quick Reference - Despliegue Sir-Angular

## 📋 Cambios hechos

```
✅ Puerto WebSocket: 5000 → 6000
✅ Frontend WebSocket: URL dinámica (/ws)
✅ Frontend API: URL relativa (/api)
✅ Nginx configurado para proxy
✅ PM2 configurado para auto-restart
✅ Variables de entorno separadas
```

## 🚀 En VPS (Ubuntu)

```bash
# Preparar VPS
sudo apt update && sudo apt upgrade -y
sudo apt install -y nodejs nginx
sudo npm install -g pm2 serve

# Clonar proyecto
cd /home/ubuntu && git clone tu_repo sir-angular

# Ejecutar
cd sir-angular && chmod +x deploy.sh && ./deploy.sh

# Configurar Nginx
sudo cp nginx.conf /etc/nginx/sites-available/sir-angular
# Editar dominio: sudo nano /etc/nginx/sites-available/sir-angular
sudo ln -s /etc/nginx/sites-available/sir-angular /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx

# SSL (opcional pero recomendado)
sudo certbot --nginx -d tu_dominio.com
```

## 📝 Archivos a editar en VPS

| Archivo | Qué cambiar |
|---------|-----------|
| `backend/.env` | BD credenciales, JWT_SECRET |
| `nginx.conf` | tu_dominio.com |
| `ecosystem.config.js` | Rutas si están diferentes |

## ✅ Verificar

```bash
pm2 status              # Ver procesos
pm2 logs                # Ver logs
curl http://tu_vps      # Frontend
curl http://tu_vps/api  # API
```

## 📦 Archivos nuevos

- `ecosystem.config.js` - PM2 config
- `nginx.conf` - Nginx config
- `backend/.env.production` - Variables prod
- `deploy.sh` - Script automático
- `DEPLOY_GUIDE.md` - Guía completa

## 🔌 Puertos

| Servicio | Puerto | Acceso |
|----------|--------|--------|
| Nginx | 80/443 | Público |
| Frontend | 3000 | Nginx |
| API | 4000 | Nginx |
| WebSocket | 6000 | Nginx |

---

**Listo para producción. Solo edita `.env` y ejecuta `deploy.sh`**
