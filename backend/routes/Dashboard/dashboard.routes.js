const express = require('express');
const router = express.Router();
const dashboardController = require('../../controllers/Dashboard/dashboard.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkAnyPermission } = require('../../middlewares/permissionsMiddleware');

const dashboardReadPermission = checkAnyPermission(['INFORMES.LEER', 'DASHBOARD.LEER']);

router.get('/stats', authMiddleware, dashboardReadPermission, dashboardController.getDashboardStats);
router.get('/income-history', authMiddleware, dashboardReadPermission, dashboardController.getIncomeHistory);
router.get('/passengers-distribution', authMiddleware, dashboardReadPermission, dashboardController.getPassengerDistribution);
router.get('/tour-occupancy', authMiddleware, dashboardReadPermission, dashboardController.getTourOccupancy);

module.exports = router;
