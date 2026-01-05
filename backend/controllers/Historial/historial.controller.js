const historialService = require('../../services/Historial/historial.service');

// Obtener historial filtrado y paginado
exports.getHistorial = async (req, res) => {
  try {
    const {
      usuario = '',
      tipoAccion = '',
      tablaAfectada = '',
      fechaInicio = '',
      fechaFin = '',
      search = '',
      page = 1,
      limit = 10
    } = req.query;

    const result = await historialService.getHistorial({
      usuario,
      tipoAccion,
      tablaAfectada,
      fechaInicio,
      fechaFin,
      search,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    return res.json(result);
  } catch (e) {
    console.error('Error obteniendo historial:', e);
    return res.status(500).json({ error: 'Error obteniendo historial' });
  }
};

// Exportar historial a CSV
exports.exportHistorial = async (req, res) => {
  try {
    const {
      usuario = '',
      tipoAccion = '',
      tablaAfectada = '',
      fechaInicio = '',
      fechaFin = ''
    } = req.query;

    const data = await historialService.exportarHistorial({
      usuario,
      tipoAccion,
      tablaAfectada,
      fechaInicio,
      fechaFin
    });

    // Convertir a CSV
    const headers = ['Fecha', 'Usuario', 'Acción', 'Tabla', 'ID Registro', 'Descripción', 'IP Address'];
    const csv = [
      headers.join(','),
      ...data.map(row => [
        new Date(row.Fecha_Accion).toLocaleString('es-ES'),
        row.Usuario_Nombre || '',
        row.Tipo_Accion,
        row.Tabla_Afectada,
        row.Id_Registro || '',
        `"${(row.Descripcion || '').replace(/"/g, '""')}"`,
        row.IP_Address || ''
      ].join(','))
    ].join('\n');

    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename="historial-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (e) {
    console.error('Error exportando historial:', e);
    return res.status(500).json({ error: 'Error exportando historial' });
  }
};

// Legacy function - Obtener historial por tabla e ID
exports.obtenerHistorial = async (req, res) => {
  try {
    const tabla = String(req.query.tabla || '').trim();
    const id = req.query.id ? Number(req.query.id) : null;

    if (!tabla) return res.status(400).json({ error: 'Se requiere el parámetro tabla' });

    const registros = await historialService.getHistorialByTableAndId(tabla, id);
    res.json(registros);
  } catch (err) {
    console.error('Error obteniendo historial:', err);
    res.status(500).json({ error: 'Error consultando historial' });
  }
};
