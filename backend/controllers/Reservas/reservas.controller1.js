// controllers/reservas.controller.js
const {
  crearReserva,
  obtenerReserva,
  filtrarReservas,
  verificarCupos
} = require('../../services/Reservas/reservas.service');

const { ejecutarTool } = require('../../AI/tool-runner'); // por si usas el flujo de token para crear punto

exports.listar = async (req, res) => {
  const data = await filtrarReservas(req.query || {});
  res.json(data);
};

exports.obtener = async (req, res) => {
  const { id } = req.params;
  const data = await obtenerReserva(id);
  if (!data) return res.status(404).json({ error: 'Reserva no encontrada' });
  res.json(data);
};

exports.crear = async (req, res) => {
  const payload = req.body;
  const out = await crearReserva(payload);
  res.status(201).json(out);
};

exports.disponibilidad = async (req, res) => {
  const { Fecha_Tour, Id_Tour, Cantidad = 1 } = req.query;
  if (!Fecha_Tour || !Id_Tour) return res.status(400).json({ error: 'Fecha_Tour e Id_Tour son requeridos' });
  const r = await verificarCupos({ Fecha_Tour, Id_Tour: Number(Id_Tour), Cantidad: Number(Cantidad) });
  res.json(r);
};

exports.confirmarCrearPunto = async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token requerido' });
  const r = await ejecutarTool('confirmar_crear_punto', { token });
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
};
