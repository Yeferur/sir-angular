const { calcularRutaEntrePuntos } = require('../../services/Programacion/rutas.service');

exports.getRutas = async(req, res) => {
 try {
    const { puntos, destino } = req.body;
    console.log(puntos);
    if (!Array.isArray(puntos) || puntos.length < 2) {
      return res.status(400).json({ error: 'Debe enviar al menos 2 puntos válidos.' });
    }
    const ruta = await calcularRutaEntrePuntos(puntos, destino);
    res.json({ ruta });
  } catch (err) {
    console.error('Error generando ruta:', err);
    res.status(500).json({ error: 'Error generando ruta' });
  }
}

