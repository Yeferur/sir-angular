const express = require('express');
const router = express.Router();
const dashboardController = require('../../controllers/Dashboard/dashboard.controller');

router.get('/stats', dashboardController.getDashboardStats);
router.get('/income-history', dashboardController.getIncomeHistory);
router.get('/passengers-distribution', dashboardController.getPassengerDistribution);
router.get('/tour-occupancy', dashboardController.getTourOccupancy);

module.exports = router;
