const express = require('express');
const router = express.Router();
const dashboardController = require('../../controllers/Dashboard/dashboard.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/stats', authMiddleware, checkPermission('DASHBOARD.LEER'), dashboardController.getDashboardStats);
router.get('/income-history', authMiddleware, checkPermission('DASHBOARD.LEER'), dashboardController.getIncomeHistory);
router.get('/passengers-distribution', authMiddleware, checkPermission('DASHBOARD.LEER'), dashboardController.getPassengerDistribution);
router.get('/tour-occupancy', authMiddleware, checkPermission('DASHBOARD.LEER'), dashboardController.getTourOccupancy);

module.exports = router;
