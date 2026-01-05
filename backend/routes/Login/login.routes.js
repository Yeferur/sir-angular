const express = require('express');
const router = express.Router();
const loginController = require('../../controllers/Login/login.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');

router.post('/login', loginController.login);
router.post('/logout', authMiddleware, loginController.logout);
router.post('/forceLogout', authMiddleware, loginController.forceLogout);

module.exports = router;

