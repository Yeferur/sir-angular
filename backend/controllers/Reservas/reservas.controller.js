// src/controllers/Reservas/reservas.controller.js
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const {
  filtrarReservas,
  obtenerReserva,
  verificarCupos,
  obtenerCanales,
  obtenerMonedas,
  obtenerTours,
  obtenerPlanesByTour,
  obtenerPreciosPorFiltro,
  obtenerHorarios,
  crearReservaConPasajerosYPagos,
  obtenerComisiones,
  // 🔽 nuevos servicios para edición
  obtenerReservaDetalle,
  actualizarReservaConPasajerosYPagos,
  getPuntoByIdSvc,
  verificarDniDuplicado,
} = require('../../services/Reservas/reservas.service');

const upload = multer({ storage: multer.memoryStorage() });
const websocketManager = require('../../websocketManager');

// --------- LISTADOS / CATÁLOGOS ----------
exports.getReservas = async (req, res) => {
  try { res.json(await filtrarReservas(req.query)); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Error al obtener reservas' }); }
};

exports.getReserva = async (req, res) => {
  try { res.json(await obtenerReserva(req.query.Id_Reserva)); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Error al obtener reserva' }); }
};

exports.getCupos = async (req, res) => {
  try {
    const { Fecha, Id_Tour, cantidad } = req.query;
    res.json(await verificarCupos(Fecha, Id_Tour, cantidad));
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Error al verificar cupos' });
  }
};

exports.getCanales = async (_req, res) => {
  try { res.json(await obtenerCanales()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Error al obtener canales' }); }
};

exports.getMonedas = async (_req, res) => {
  try { res.json(await obtenerMonedas()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Error al obtener monedas' }); }
};

exports.getTours = async (_req, res) => {
  try { res.json(await obtenerTours()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Error al obtener tours' }); }
};

exports.getPlanesByTour = async (req, res) => {
  try { res.json(await obtenerPlanesByTour(req.params.id)); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Error al obtener planes' }); }
};

exports.getPrecios = async (req, res) => {
  try {
    const { Id_Tour, Id_Plan, Id_Moneda } = req.query;
    res.json(await obtenerPreciosPorFiltro(Id_Tour, Id_Plan, Id_Moneda));
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Error al obtener precios' });
  }
};

exports.getHorarios = async (req, res) => {
  try {
    const { Id_Tour, Id_Punto } = req.query;
    console.log({ Id_Tour, Id_Punto });
    res.json(await obtenerHorarios(Id_Tour, Id_Punto));
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Error al obtener horarios' });
  }
};

// --------- CREACIÓN CON ARCHIVOS ----------
exports.saveReserva = [
  upload.any(),
  async (req, res) => {
    try {
      const payloadStr = req.body?.payload;
      if (!payloadStr) return res.status(400).json({ success: false, error: 'Falta payload' });

      let payload;
      try { payload = JSON.parse(payloadStr); }
      catch { return res.status(400).json({ success: false, error: 'Payload JSON inválido' }); }

      const filesMap = {};
      if (Array.isArray(req.files)) {
        for (const f of req.files) filesMap[f.fieldname] = f;
      }

      const userId = req.user?.id || null;
      const result = await crearReservaConPasajerosYPagos(payload, filesMap, userId);
      // Emitir evento WebSocket si la reserva se creó correctamente
      if (result && result.success && payload?.cabeceraReserva?.Fecha_Tour) {
        websocketManager.broadcastReservaEvento({
          type: 'reservaCreada',
          Fecha_Tour: payload.cabeceraReserva.Fecha_Tour,
          Id_Tour: payload.cabeceraReserva.Id_Tour,
          Id_Reserva: result.Id_Reserva || null
        });
      }
      return res.json(result);
    } catch (e) {
      console.error('Error al crear la reserva:', e);
      return res.status(500).json({ success: false, error: 'Error al crear la reserva' });
    }
  }
];

exports.getComisiones = async (req, res) => {
  try {
    const { Id_Tour, Id_Canal } = req.query;
    res.json(await obtenerComisiones(Id_Tour, Id_Canal));
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Error al obtener comisiones' });
  }
};

// --------- 💾 DETALLE PARA EDICIÓN ----------
exports.getReservaDetalle = async (req, res) => {
  try {
    const { id } = req.params; // :id
    const data = await obtenerReservaDetalle(id);
    if (!data) return res.status(404).json({ error: 'Reserva no encontrada' });
    res.json(data);
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Error al obtener detalle de la reserva' });
  }
};

// --------- ✏️ ACTUALIZACIÓN CON ARCHIVOS ----------
exports.updateReserva = [
  upload.any(),
  async (req, res) => {
    try {
      const { id } = req.params;
      const payloadStr = req.body?.payload;
      if (!payloadStr) return res.status(400).json({ success: false, error: 'Falta payload' });

      let payload;
      try { payload = JSON.parse(payloadStr); }
      catch { return res.status(400).json({ success: false, error: 'Payload JSON inválido' }); }

      const filesMap = {};
      if (Array.isArray(req.files)) {
        for (const f of req.files) filesMap[f.fieldname] = f; // f.buffer
      }

      const userId = req.user?.id || null;
      await actualizarReservaConPasajerosYPagos(id, payload, filesMap, userId);
      // Emitir evento WebSocket al actualizar reserva si hay fecha
      if (payload?.cabeceraReserva?.Fecha_Tour) {
        websocketManager.broadcastReservaEvento({
          type: 'reservaActualizada',
          Fecha_Tour: payload.cabeceraReserva.Fecha_Tour,
          Id_Tour: payload.cabeceraReserva.Id_Tour,
          Id_Reserva: id
        });
      }
      return res.json({ success: true });
    } catch (e) {
      console.error('Error al actualizar la reserva:', e);
      return res.status(500).json({ success: false, error: 'Error al actualizar la reserva' });
    }
  }
];

// --------- (opcional) Punto por Id ----------
exports.getPuntoById = async (req, res) => {
  try {
    const { id } = req.params;
    const pto = await getPuntoByIdSvc(id);
    if (!pto) return res.status(404).json({ error: 'Punto no encontrado' });
    res.json(pto);
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Error al obtener punto' });
  }
};

// --------- Verificar DNI duplicado ----------
exports.checkDniDuplicado = async (req, res) => {
  try {
    const { dni, fecha } = req.query;
    if (!dni || !fecha) {
      return res.status(400).json({ error: 'Se requieren DNI y fecha' });
    }
    const resultado = await verificarDniDuplicado(dni, fecha);
    res.json(resultado);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al verificar DNI' });
  }
};
