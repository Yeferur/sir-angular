const express = require('express');
const cors = require('cors');
const app = express();
require('./websocket');
const loginRoutes = require('./routes/Login/login.routes');
const inicioRoutes = require('./routes/inicio.routes');
const reservasRoutes = require('./routes/Reservas/reserva.routes');
const puntosRoutes = require('./routes/Puntos/puntos.routes');

const programacionRoutes = require('./routes/Programacion/programacion.routes');
const rutasRoutes = require('./routes/Programacion/rutas.routes');
const sesionesRoutes = require('./routes/Usuarios/usuarios.routes');
const toursRoutes = require('./routes/Tours/tours.routes');
const transfersRoutes = require('./routes/Transfers/transfers.routes');
const phoneRoutes = require('./routes/phone.routes');
const historialRoutes = require('./routes/historial.routes');
const historialNewRoutes = require('./routes/Historial/historial.routes');
const permisosRoutes = require('./routes/Permisos/permisos.routes');

app.use(cors());
app.use(express.json());

const path = require('path');
// Servir archivos estáticos subidos (comprobantes, etc.)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


app.use('/api', loginRoutes);
app.use('/api', inicioRoutes);
app.use('/api', reservasRoutes);
app.use('/api', puntosRoutes);
app.use('/api', programacionRoutes);
app.use('/api', rutasRoutes);
app.use('/api', sesionesRoutes);
app.use('/api', transfersRoutes);
app.use('/api', phoneRoutes);
app.use('/api/tours', toursRoutes);
app.use('/api/historial', historialNewRoutes);
app.use('/api', permisosRoutes);

app.listen(4000, () => {
  console.log('Servidor backend corriendo en http://localhost:4000');
});
console.log('Servidor WebSocket corriendo en ws://localhost:6000');