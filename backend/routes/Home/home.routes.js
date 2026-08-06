const express = require('express');
const controller = require('../../controllers/Home/home.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');

const router = express.Router();

router.get('/summary', authMiddleware, controller.getSummary);

module.exports = router;
