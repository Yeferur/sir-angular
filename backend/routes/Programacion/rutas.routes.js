// backend/routes/Programacion/programacion.routes.inteligente.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

const { getRutas } = require('../../controllers/Programacion/rutas.controller');

router.post('/ruta-optima', authMiddleware, checkPermission('PROGRAMACION.CREAR'), getRutas);

module.exports = router;