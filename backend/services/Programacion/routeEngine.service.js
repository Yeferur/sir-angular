const axios = require('axios');

const ROUTE_ENGINE_URL = 'http://127.0.0.1:8001/optimize-route';

async function ordenarParadas({ puntos, destino }) {
  if (!destino?.lat || !destino?.lng) {
    throw new Error('Destino inválido');
  }

  const payload = {
    points: puntos.map(p => ({
      lat: Number(p.Latitud ?? p.lat),
      lng: Number(p.Longitud ?? p.lng)
    })),
    destination: {
      lat: Number(destino.lat),
      lng: Number(destino.lng)
    }
  };

  const res = await axios.post(ROUTE_ENGINE_URL, payload, {
    timeout: 8000
  });

  if (!res.data || !Array.isArray(res.data.ordered_points)) {
    throw new Error('Respuesta inválida del motor de rutas');
  }

  return res.data.ordered_points.map((p, i) => ({
    ...p,
    orden: i + 1
  }));
}

module.exports = { ordenarParadas };
