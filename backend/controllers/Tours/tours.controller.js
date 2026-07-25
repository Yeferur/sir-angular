// backend/controllers/Tours/tours.controller.js
const { crearTour, obtenerPreciosTour, upsertPreciosTour, crearPlanTour, obtenerTours, obtenerTourPorId, actualizarTour, eliminarTour, obtenerDisponibilidadTour, obtenerCanalesComision } = require('../../services/Tours/tours.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

exports.crearTour = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const data = await crearTour(req.body, userId);
    return sendSuccess(res, { data, message: 'Tour creado correctamente', status: 201 });
  } catch (e) {
    console.error('Error al crear tour:', e);
    return sendError(res, { status: 400, message: e.message || 'Error al crear tour', errorCode: 'BAD_REQUEST' });
  }
};

exports.getPrecios = async (req, res) => {
  try {
    const { id } = req.params;
    const { Id_Plan, Id_Moneda } = req.query;
    const rows = await obtenerPreciosTour(id, Id_Plan, Id_Moneda);
    return sendSuccess(res, { data: rows, message: 'Precios obtenidos correctamente' });
  } catch (e) {
    console.error(e);
    return sendError(res, { status: 500, message: 'Error al obtener precios del tour', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.updatePrecios = async (req, res) => {
  try {
    const { id } = req.params;
    const { Id_Plan, Id_Moneda, precios, Nombre_Plan } = req.body;
    if (!precios || typeof precios !== 'object') return res.status(400).json({ error: 'Payload inválido: precios' });

    let planId = Id_Plan || null;
    if (!planId && Nombre_Plan) {
      // crear plan y usar su id
      planId = await crearPlanTour(id, Nombre_Plan);
    }

    const userId = req.user?.id || null;
    await upsertPreciosTour(id, planId || null, Id_Moneda || null, precios, userId);
    return sendSuccess(res, { data: { Id_Plan: planId }, message: 'Precios actualizados correctamente' });
  } catch (e) {
    console.error(e);
    return sendError(res, { status: 500, message: 'Error al actualizar precios', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.getTours = async (req, res) => {

  try {
    const tours = await obtenerTours();

    return sendSuccess(res, {
      data: tours,
      message: 'Tours obtenidos correctamente'
    });
  } catch (e) {
    console.error(e);
    return sendError(res, {
      status: 500,
      message: 'Error al obtener tours',
      errorCode: 'INTERNAL_ERROR'
    });
  }
};

exports.getTourById = async (req, res) => {
  try {
    const { id } = req.params;
    const tour = await obtenerTourPorId(id);
    if (!tour) {
      return sendError(res, { status: 404, message: 'Tour no encontrado', errorCode: 'NOT_FOUND' });
    }
    return sendSuccess(res, { data: tour, message: 'Tour obtenido correctamente' });
  } catch (e) {
    console.error(e);
    return sendError(res, { status: 500, message: 'Error al obtener el tour', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.getDisponibilidad = async (req, res) => {
  try {
    const { id } = req.params;
    const dispo = await obtenerDisponibilidadTour(id);
    return sendSuccess(res, { data: dispo, message: 'Disponibilidad obtenida correctamente' });
  } catch (e) {
    console.error('Error al obtener disponibilidad:', e);
    return sendError(res, { status: 500, message: 'Error al obtener disponibilidad del tour', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.updateTour = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || null;
    const data = await actualizarTour(id, req.body, userId);
    return sendSuccess(res, { data, message: 'Tour actualizado correctamente' });
  } catch (e) {
    console.error('Error al actualizar tour:', e);
    return sendError(res, { status: 400, message: e.message || 'Error al actualizar tour', errorCode: 'BAD_REQUEST' });
  }
};

exports.deleteTour = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || null;
    const data = await eliminarTour(id, userId);
    return sendSuccess(res, { data, message: 'Tour desactivado correctamente' });
  } catch (e) {
    console.error('Error al desactivar tour:', e);
    return sendError(res, { status: 400, message: e.message || 'Error al desactivar tour', errorCode: 'BAD_REQUEST' });
  }
};

exports.getCanalesComision = async (req, res) => {
  try {
    const canales = await obtenerCanalesComision();
    return sendSuccess(res, { data: canales, message: 'Canales con comisión obtenidos correctamente' });
  } catch (e) {
    console.error(e);
    return sendError(res, { status: 500, message: 'Error al obtener canales con comisión', errorCode: 'INTERNAL_ERROR' });
  }
};
