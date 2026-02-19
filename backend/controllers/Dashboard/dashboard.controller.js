const dashboardService = require('../../services/Dashboard/dashboard.service');

async function getDashboardStats(req, res) {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate
        };
        const stats = await dashboardService.getDashboardStatsSvc(filters);
        res.json(stats);
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function getIncomeHistory(req, res) {
    try {
        const year = req.query.year || new Date().getFullYear();
        const data = await dashboardService.getIncomeHistorySvc(year);
        res.json(data);
    } catch (error) {
        console.error('Error fetching income history:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function getPassengerDistribution(req, res) {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate
        };
        const data = await dashboardService.getPassengerDistributionSvc(filters);
        res.json(data);
    } catch (error) {
        console.error('Error fetching passenger distribution:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function getTourOccupancy(req, res) {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate
        };
        const data = await dashboardService.getTourOccupancySvc(filters);
        res.json(data);
    } catch (error) {
        console.error('Error fetching tour occupancy:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

module.exports = {
    getDashboardStats,
    getIncomeHistory,
    getPassengerDistribution,
    getTourOccupancy
};
