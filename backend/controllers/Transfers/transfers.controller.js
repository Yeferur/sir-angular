const {
  getServiciosTransferSvc,
  crearTransferSvc
} = require('../../services/Transfers/transfers.service');

const { getRangosSvc, getPreciosPorRangoSvc } = require('../../services/Transfers/transfers.service');
const { filtrarTransfersSvc } = require('../../services/Transfers/transfers.service');

exports.getServicios = async (_req, res) => {
  try {
    const rows = await getServiciosTransferSvc();
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener servicios de transfer' });
  }
};

exports.getRangos = async (_req, res) => {
  try {
    const rows = await getRangosSvc();
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener rangos' });
  }
};

exports.getPrecios = async (req, res) => {
  try {
    const { Id_Rango } = req.query;
    if (!Id_Rango) return res.status(400).json({ error: 'Falta Id_Rango' });
    const rows = await getPreciosPorRangoSvc(Id_Rango);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener precios' });
  }
};

exports.getTransfers = async (req, res) => {
  try {
    const data = await filtrarTransfersSvc(req.query || {});
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener transfers' });
  }
};

exports.createTransfer = async (req, res) => {
  try {
    const payload = req.body;
    if (!payload) return res.status(400).json({ success: false, error: 'Falta body' });

    const result = await crearTransferSvc(payload);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: 'Error al crear transfer' });
  }
};
