const express = require('express');

const { authMiddleware } = require('../../middlewares/authMiddleware');
const { postIaChat } = require('../../controllers/IA/ia.controller');

const router = express.Router();

router.post('/chat', authMiddleware, postIaChat);

module.exports = router;
