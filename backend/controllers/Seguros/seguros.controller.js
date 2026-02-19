const segurosService = require('../../services/Seguros/seguros.service');

async function listar(req, res) {
    try {
        const filtros = req.query;
        const data = await segurosService.listarSeguros(filtros);
        res.json(data);
    } catch (error) {
        console.error('Error al listar seguros:', error);
        res.status(500).json({ error: 'Error interno al listar seguros' });
    }
}

async function exportarExcel(req, res) {
    try {
        const filtros = req.query;
        await segurosService.generarExcelSeguros(filtros, res);
    } catch (error) {
        console.error('Error al exportar Excel de seguros:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error al generar el Excel' });
        }
    }
}

module.exports = {
    listar,
    exportarExcel
};
