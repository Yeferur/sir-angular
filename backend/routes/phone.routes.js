const express = require('express');
const router = express.Router();
const phoneController = require('../controllers/phone.controller');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.post('/phone/check-whatsapp', authMiddleware, phoneController.checkWhatsApp);

module.exports = router;
