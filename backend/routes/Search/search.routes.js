const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../../middlewares/authMiddleware');
const searchController = require('../../controllers/Search/search.controller');

router.get('/global', authMiddleware, searchController.globalSearch);

module.exports = router;
