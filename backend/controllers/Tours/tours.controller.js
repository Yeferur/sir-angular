// backend/controllers/Tours/tours.controller.js
const { crearTour, obtenerPreciosTour, upsertPreciosTour, crearPlanTour, obtenerTours, obtenerTourPorId, actualizarTour, eliminarTour, obtenerDisponibilidadTour } = require('../../services/Tours/tours.service');

exports.crearTour = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const data = await crearTour(req.body, userId);
    res.status(201).json(data);
  } catch (e) {
    console.error('Error al crear tour:', e);
    res.status(400).json({ error: e.message || 'Error al crear tour' });
  }
};

exports.getPrecios = async (req, res) => {
  try {
    const { id } = req.params;
    const { Id_Plan, Id_Moneda } = req.query;
    const rows = await obtenerPreciosTour(id, Id_Plan, Id_Moneda);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener precios del tour' });
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
    res.json({ success: true, Id_Plan: planId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar precios' });
  }
};

exports.getTours = async (req, res) => {
  try {
    const tours = await obtenerTours();
    res.json(tours);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener tours' });
  }
};

exports.getTourById = async (req, res) => {
  try {
    const { id } = req.params;
    const tour = await obtenerTourPorId(id);
    if (!tour) {
      return res.status(404).json({ error: 'Tour no encontrado' });
    }
    res.json(tour);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener el tour' });
  }
};

exports.getDisponibilidad = async (req, res) => {
  try {
    const { id } = req.params;
    const dispo = await obtenerDisponibilidadTour(id);
    res.json(dispo);
  } catch (e) {
    console.error('Error al obtener disponibilidad:', e);
    res.status(500).json({ error: 'Error al obtener disponibilidad del tour' });
  }
};

exports.updateTour = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || null;
    const data = await actualizarTour(id, req.body, userId);
    res.json(data);
  } catch (e) {
    console.error('Error al actualizar tour:', e);
    res.status(400).json({ error: e.message || 'Error al actualizar tour' });
  }
};

exports.deleteTour = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || null;
    const data = await eliminarTour(id, userId);
    res.json(data);
  } catch (e) {
    console.error('Error al eliminar tour:', e);
    res.status(400).json({ error: e.message || 'Error al eliminar tour' });
  }
};
