const dashboardService = require('../../services/Dashboard/dashboard.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

async function getDashboardStats(req, res) {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate
        };
        const stats = await dashboardService.getDashboardStatsSvc(filters);
        return sendSuccess(res, { data: stats, message: 'Dashboard obtenido correctamente' });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
    }
}

async function getIncomeHistory(req, res) {
    try {
        const year = req.query.year || new Date().getFullYear();
        const data = await dashboardService.getIncomeHistorySvc(year);
        return sendSuccess(res, { data, message: 'Historial de ingresos obtenido correctamente' });
    } catch (error) {
        console.error('Error fetching income history:', error);
        return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
    }
}

async function getPassengerDistribution(req, res) {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate
        };
        const data = await dashboardService.getPassengerDistributionSvc(filters);
        return sendSuccess(res, { data, message: 'Distribucion de pasajeros obtenida correctamente' });
    } catch (error) {
        console.error('Error fetching passenger distribution:', error);
        return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
    }
}

async function getTourOccupancy(req, res) {
    try {
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate
        };
        const data = await dashboardService.getTourOccupancySvc(filters);
        return sendSuccess(res, { data, message: 'Ocupacion por tour obtenida correctamente' });
    } catch (error) {
        console.error('Error fetching tour occupancy:', error);
        return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
    }
}

module.exports = {
    getDashboardStats,
    getIncomeHistory,
    getPassengerDistribution,
    getTourOccupancy
};
