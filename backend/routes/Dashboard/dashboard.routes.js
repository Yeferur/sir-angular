const express = require('express');
const router = express.Router();
const dashboardController = require('../../controllers/Dashboard/dashboard.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkAnyPermission } = require('../../middlewares/permissionsMiddleware');

const dashboardReadPermission = checkAnyPermission(['INFORMES.LEER', 'DASHBOARD.LEER']);

router.get('/stats', authMiddleware, dashboardReadPermission, dashboardController.getDashboardStats);
router.get('/income-history', authMiddleware, dashboardReadPermission, dashboardController.getIncomeHistory);
router.get('/daily-income', authMiddleware, dashboardReadPermission, dashboardController.getDailyIncome);
router.get('/daily-passengers', authMiddleware, dashboardReadPermission, dashboardController.getDailyPassengers);
router.get('/passengers-by-channel', authMiddleware, dashboardReadPermission, dashboardController.getPassengersByChannel);
router.get('/passenger-distribution', authMiddleware, dashboardReadPermission, dashboardController.getPassengerDistribution);
router.get('/passengers-distribution', authMiddleware, dashboardReadPermission, dashboardController.getPassengerDistribution);
router.get('/tour-occupancy', authMiddleware, dashboardReadPermission, dashboardController.getTourOccupancy);

module.exports = router;
