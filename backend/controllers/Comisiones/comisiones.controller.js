const comisionesService = require('../../services/Comisiones/comisiones.service');

async function listar(req, res) {
    try {
        const filtros = req.query; // { Id_Tour, Fecha, ... }
        const data = await comisionesService.listarComisiones(filtros);
        res.json(data);
    } catch (error) {
        console.error('Error al listar comisiones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
}

async function exportarExcel(req, res) {
    try {
        const filtros = req.query;
        await comisionesService.generarExcelComisiones(filtros, res);
    } catch (error) {
        console.error('Error al exportar comisiones:', error);
        if (!res.headersSent) {
            res.status(500).send('Error al generar el archivo Excel.');
        }
    }
}

module.exports = {
    listar,
    exportarExcel
};
