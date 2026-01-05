// backend/routes/Programacion/programacion.routes.inteligente.js
const express = require('express');
const router = express.Router();

const { getRutas } = require('../../controllers/Programacion/rutas.controller');

router.post('/ruta-optima', getRutas);

module.exports = router;