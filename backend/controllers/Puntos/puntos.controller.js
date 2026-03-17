const { obtenerPuntos, obtenerPuntosQuery, obtenerHorario, obtenerHorariosPorPunto, obtenerPuntosPorDireccion, crearPunto, crearHorariosParaPunto, obtenerPuntoPorId, actualizarPunto, eliminarPunto } = require('../../services/Puntos/puntos.service');
const ExcelJS = require('exceljs');

exports.exportarPuntosExcel = async (req, res) => {
  const q = req.query.q || '';
  try {
    const result = await obtenerPuntos({ page: 1, limit: 10000, q });
    const puntos = result.rows || [];

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Puntos de Encuentro');

    worksheet.columns = [
      { header: 'ID del Punto', key: 'id', width: 15 },
      { header: 'Nombre del Punto', key: 'nombre', width: 40 },
      { header: 'Ruta', key: 'ruta', width: 20 },
      { header: 'Posición', key: 'posicion', width: 15 }
    ];

    puntos.forEach(p => {
      worksheet.addRow({
        id: p.Id_Punto,
        nombre: p.Nombre_Punto || p.NombrePunto,
        ruta: p.ruta || 'PENDIENTE',
        posicion: p.posicion !== undefined ? p.posicion : ''
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Puntos_Encuentro.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error al exportar puntos a Excel:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.getPuntos = async (req, res) => {
  const page = req.query.page || 1;
  const limit = req.query.limit || 10;
  const q = req.query.q || '';

  try {
    const result = await obtenerPuntos({ page, limit, q });
    res.json({ data: result.rows, total: result.total });
  } catch (error) {
    console.error('Error al obtener puntos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.getPuntosQuery = async (req, res) => {
  const query = req.query.query || "";
  try {
    const puntos = await obtenerPuntosQuery(query);
    res.json(puntos);
  } catch (error) {
    console.error('Error al obtener puntos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.getPuntosByDireccion = async (req, res) => {
  const direccion = req.query.direccion || '';
  try {
    const puntos = await obtenerPuntosPorDireccion(direccion);
    res.json(puntos);
  } catch (error) {
    console.error('Error al buscar punto por direccion:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.getHorario = async (req, res) => {
  const { Id_Punto, Id_Tour } = req.query;
  console.log(Id_Punto, Id_Tour);
  try {
    const horario = await obtenerHorario(Id_Punto, Id_Tour);
    res.json(horario);
    console.log(horario);
  } catch (error) {
    console.error('Error al obtener horario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.getHorariosPorPunto = async (req, res) => {
  const Id_Punto = req.query.Id_Punto;
  if (!Id_Punto) return res.status(400).json({ error: 'Id_Punto es requerido' });
  try {
    const horarios = await obtenerHorariosPorPunto(Id_Punto);
    res.json(horarios);
  } catch (error) {
    console.error('Error al obtener horarios por punto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.createPunto = async (req, res) => {
  const { NombrePunto, Nombre_Punto, Sector, Direccion, Latitud, Longitud } = req.body || {};
  const nombre = NombrePunto || Nombre_Punto;
  if (!nombre || String(nombre).trim().length === 0) {
    return res.status(400).json({ error: 'Nombre del punto es requerido' });
  }

  const payload = {
    Nombre_Punto: nombre,
    Sector: Sector || null,
    Direccion: Direccion || null,
    Latitud: Latitud ?? null,
    Longitud: Longitud ?? null
  };

  try {
    const userId = req.user?.id || null;
    const result = await crearPunto(payload, userId);
    const insertId = result.insertId;

    // Si el cliente envía horarios, insertarlos asociados al punto recién creado
    const horarios = Array.isArray(req.body.horarios) ? req.body.horarios : [];
    if (horarios.length) {
      try {
        await crearHorariosParaPunto(insertId, horarios, userId);
      } catch (err) {
        console.error('Error al crear horarios para punto:', err);
      }
    }

    res.status(201).json({ message: 'Punto creado', insertId });
  } catch (error) {
    console.error('Error al crear punto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.getPuntoById = async (req, res) => {
  const id = req.params.id;
  try {
    const punto = await obtenerPuntoPorId(id);
    if (!punto) return res.status(404).json({ error: 'Punto no encontrado' });
    res.json(punto);
  } catch (err) {
    console.error('Error al obtener punto por id:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.updatePunto = async (req, res) => {
  const id = req.params.id;
  try {
    const userId = req.user?.id || null;
    const payload = req.body || {};
    await actualizarPunto(id, payload, userId);
    res.json({ message: 'Punto actualizado' });
  } catch (err) {
    console.error('Error al actualizar punto:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.deletePunto = async (req, res) => {
  const id = req.params.id;
  try {
    const userId = req.user?.id || null;
    await eliminarPunto(id, userId);
    res.json({ message: 'Punto eliminado' });
  } catch (err) {
    console.error('Error al eliminar punto:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
