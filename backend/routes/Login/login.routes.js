const express = require('express');
const router = express.Router();
const loginController = require('../../controllers/Login/login.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.post('/login', loginController.login);
router.post('/auth/forgot-password', loginController.forgotPassword);
router.post('/auth/reset-password', loginController.resetPassword);
router.post('/logout', authMiddleware, loginController.logout);
router.post('/logout/all', authMiddleware, loginController.logoutAllSessions);
router.post('/forceLogout', authMiddleware, checkPermission('USUARIOS.ACTUALIZAR'), loginController.forceLogout);

module.exports = router;

