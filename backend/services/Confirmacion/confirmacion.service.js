const db = require('../../database/db');

/**
 * Obtiene la lista de pasajeros para un tour en una fecha específica.
 * Filtra por reservas que no estén canceladas.
 * 
 * @param {number} idTour - ID del tour.
 * @param {string} fecha - Fecha del tour (YYYY-MM-DD).
 * @returns {Promise<Array>} Lista de pasajeros.
 */
async function obtenerPasajerosPorTour(idTour, fecha) {
    const sql = `
    SELECT 
      p.Id_Pasajero,
      p.Id_Reserva,
      p.Nombre_Pasajero,
      p.DNI,
      p.Telefono_Pasajero,
      p.Tipo_Pasajero,
      p.Confirmacion,
      r.Telefono_Reportante,
      r.Nombre_Reportante,
      pt.Nombre_Punto AS PuntoEncuentro
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    LEFT JOIN horarios h ON r.Id_Horario = h.Id_Horario
    LEFT JOIN puntos pt ON h.Id_Punto = pt.Id_Punto
    WHERE h.Id_Tour = ?
      AND r.Fecha_Tour = ?
      AND (r.Estado IS NULL OR r.Estado != 'Cancelada')
    ORDER BY r.Id_Reserva, p.Nombre_Pasajero
  `;

    const [rows] = await db.query(sql, [idTour, fecha]);
    return rows;
}

/**
 * Actualiza el estado de confirmación de un pasajero.
 * 
 * @param {Array<{Id_Pasajero: number, Confirmacion: number}>} pasajeros - Lista de pasajeros a actualizar.
 * @returns {Promise<void>}
 */
async function actualizarConfirmacion(pasajeros) {
    if (!Array.isArray(pasajeros) || pasajeros.length === 0) return;

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        for (const p of pasajeros) {
            await conn.query(
                'UPDATE pasajeros SET Confirmacion = ? WHERE Id_Pasajero = ?',
                [p.Confirmacion ? 1 : 0, p.Id_Pasajero]
            );
        }

        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    obtenerPasajerosPorTour,
    actualizarConfirmacion
};
