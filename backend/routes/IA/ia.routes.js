const express = require('express');

const { authMiddleware } = require('../../middlewares/authMiddleware');
const { postIaChat } = require('../../controllers/IA/ia.controller');
const { denyClientAccess } = require('../../middlewares/clientAccessMiddleware');

const router = express.Router();

router.post('/chat', authMiddleware, denyClientAccess, postIaChat);

module.exports = router;
