const express = require('express');
const { exportarPuntosExcel, getPuntos, getPuntosQuery, getRutasPuntos, getPuntosByRuta, getOperatividadPuntosByRuta, updateOrdenPuntosByRuta, getPuntosByDireccion, getHorario, getHorariosPorPunto, validarCoordenadasPunto, createPunto, getPuntoById, updatePunto, deletePunto } = require('../../controllers/Puntos/puntos.controller');
const router = express.Router();
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission, checkAnyPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/puntos/exportar', authMiddleware, checkPermission('PUNTOS.EXPORTAR'), exportarPuntosExcel);
router.get('/puntos', authMiddleware, checkPermission('PUNTOS.LEER'), getPuntos);
router.get('/puntos/query', authMiddleware, checkPermission('PUNTOS.LEER'), getPuntosQuery);
router.get('/puntos/rutas', authMiddleware, checkPermission('PUNTOS.LEER'), getRutasPuntos);
router.get('/puntos/rutas/:ruta/operatividad', authMiddleware, checkPermission('PUNTOS.LEER'), getOperatividadPuntosByRuta);
router.put('/puntos/rutas/:ruta/orden', authMiddleware, checkPermission('PUNTOS.ORDENAR'), updateOrdenPuntosByRuta);
router.get('/puntos/rutas/:ruta', authMiddleware, checkPermission('PUNTOS.LEER'), getPuntosByRuta);
router.get('/puntos/direccion', authMiddleware, checkPermission('PUNTOS.LEER'), getPuntosByDireccion);
router.get('/puntos/horario', authMiddleware, checkPermission('PUNTOS.LEER'), getHorario);
router.get('/puntos/horarios', authMiddleware, checkPermission('PUNTOS.LEER'), getHorariosPorPunto);
router.post(
  '/puntos/validar-coordenadas',
  authMiddleware,
  checkAnyPermission(['PUNTOS.CREAR', 'PUNTOS.ACTUALIZAR']),
  validarCoordenadasPunto
);
router.post('/puntos', authMiddleware, checkPermission('PUNTOS.CREAR'), createPunto);
router.get('/puntos/:id', authMiddleware, checkPermission('PUNTOS.LEER'), getPuntoById);
router.put('/puntos/:id', authMiddleware, checkPermission('PUNTOS.ACTUALIZAR'), updatePunto);
router.delete('/puntos/:id', authMiddleware, checkPermission('PUNTOS.ELIMINAR'), deletePunto);

module.exports = router;
