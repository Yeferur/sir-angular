// backend/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

const app = express();

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
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// ✅ Crear server HTTP (para compartir con WS)
const HTTP_PORT = Number(process.env.PORT || 4000);
const server = http.createServer(app);

// ✅ Iniciar WS en el MISMO server
const { initWebSocket } = require('./websocket');
initWebSocket(server);

// ✅ Levantar server
server.listen(HTTP_PORT, () => {
  console.log(`✅ Backend HTTP corriendo en http://localhost:${HTTP_PORT}`);
  console.log(`✅ WS corriendo en ws://localhost:${HTTP_PORT}/ws`);
});
