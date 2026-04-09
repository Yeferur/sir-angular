// backend/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

const app = express();

// ✅ Expose uploads folder as static (for profile photos, etc.)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Compatibilidad: avatares antiguos pudieron quedar en /uploads o /uploads/usuarios.
app.get('/uploads/fotos_perfil/:filename', (req, res, next) => {
  const safeName = path.basename(req.params.filename || '');
  if (!safeName) return next();

  const candidates = [
    path.join(__dirname, 'uploads', 'fotos_perfil', safeName),
    path.join(__dirname, 'uploads', 'usuarios', safeName),
    path.join(__dirname, 'uploads', safeName),
  ];

  for (const filePath of candidates) {
    if (require('fs').existsSync(filePath)) {
      return res.sendFile(filePath);
    }
  }

  return next();
});

const loginRoutes = require('./routes/Login/login.routes');
const inicioRoutes = require('./routes/inicio.routes');
const reservasRoutes = require('./routes/Reservas/reserva.routes');
const puntosRoutes = require('./routes/Puntos/puntos.routes');
const programacionRoutes = require('./routes/Programacion/programacion.routes');
const rutasRoutes = require('./routes/Programacion/rutas.routes');
const sesionesRoutes = require('./routes/Usuarios/usuarios.routes');
const toursRoutes = require('./routes/Tours/tours.routes');
const transfersRoutes = require('./routes/Transfers/transfers.routes');
const historialNewRoutes = require('./routes/Historial/historial.routes');
const permisosRoutes = require('./routes/Permisos/permisos.routes');

app.use(cors());
app.use(express.json());

app.use('/api', loginRoutes);
app.use('/api', inicioRoutes);
app.use('/api', reservasRoutes);
app.use('/api', puntosRoutes);
app.use('/api', programacionRoutes);
app.use('/api', rutasRoutes);
app.use('/api', sesionesRoutes);
app.use('/api', transfersRoutes);
app.use('/api/tours', toursRoutes);
app.use('/api/historial', historialNewRoutes);
app.use('/api', permisosRoutes);
const dashboardRoutes = require('./routes/Dashboard/dashboard.routes');
app.use('/api/dashboard', dashboardRoutes);

const confirmacionRoutes = require('./routes/Confirmacion/confirmacion.routes');
app.use('/api/confirmacion', confirmacionRoutes);

const comisionesRoutes = require('./routes/Comisiones/comisiones.routes');
app.use('/api/comisiones', comisionesRoutes);

const segurosRoutes = require('./routes/Seguros/seguros.routes');
app.use('/api/seguros', segurosRoutes);

// ✅ Crear server HTTP (para compartir con WS)
const DEFAULT_PORT = Number(process.env.PORT || 4000);
const isDevelopment = process.env.NODE_ENV !== 'production';
const server = http.createServer(app);

// ✅ Iniciar WS en el MISMO server
const { initWebSocket } = require('./websocket');
initWebSocket(server);

let activePort = DEFAULT_PORT;

function startServer(port) {
  activePort = port;
  server.listen(port, () => {
    console.log(`✅ Backend HTTP corriendo en http://localhost:${activePort}`);
    console.log(`✅ WS corriendo en ws://localhost:${activePort}/ws`);
  });
}

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    if (isDevelopment && activePort === DEFAULT_PORT) {
      const fallbackPort = DEFAULT_PORT + 1;
      console.warn(
        `⚠️ Puerto ${DEFAULT_PORT} en uso. Reintentando automaticamente en ${fallbackPort} (modo desarrollo).`
      );
      startServer(fallbackPort);
      return;
    }

    console.error(`❌ Puerto ${activePort} en uso. Cierra el proceso previo o cambia PORT en .env.`);
    process.exit(1);
  }

  console.error('❌ Error iniciando el servidor:', err);
  process.exit(1);
});

// ✅ Levantar server
startServer(DEFAULT_PORT);
