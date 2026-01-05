const { generarListados, generarListadoManual } = require('../../services/Programacion/programacion.service');

exports.obtenerListadoBusesPorTour = async (req, res) => {
  const { fecha, tour } = req.query;

  if (!fecha || !tour) {
    return res.status(400).json({ error: 'Debe proporcionar la fecha y el ID del tour' });
  }

  try {
    const resultado = await generarListados(fecha, [parseInt(tour)]);
    res.json(resultado);
  } catch (error) {
    console.error('Error al generar el listado:', error);
    res.status(500).json({ error: 'Error interno al generar los listados de buses' });
  }
};

exports.obtenerListadoBusesPorTourManual = async (req, res) => {
  const { fecha, tour, combinacion } = req.query;
 const combinacionParsed = JSON.parse(combinacion); // <- aquí está el punto clave
  if (!fecha || !tour || !Array.isArray(combinacionParsed) || combinacionParsed.length === 0) {
    return res.status(400).json({ error: 'Datos incompletos: se requiere fecha, tour y combinación' });
  }

  try {
    // Puedes adaptar esta función para que use la combinación como entrada directa
    const listado = await generarListadoManual(fecha, parseInt(tour), combinacionParsed);

    res.json(listado);
  } catch (error) {
    console.error('❌ Error al generar listado manual:', error);
    res.status(500).json({ error: 'Error interno al procesar la combinación manual' });
  }
};
