const SHARED_TOUR_IDS = Object.freeze([1, 5]);
const SHARED_CAPACITY_SOURCE_ID = 5;

function annotateSharedCapacity(tours = []) {
  const byId = new Map((tours || []).map((tour) => [Number(tour.Id_Tour), tour]));
  const capacitySource = byId.get(SHARED_CAPACITY_SOURCE_ID);
  const sharedCapacity = Number(capacitySource?.cupos || 0);
  const sharedOccupancy = SHARED_TOUR_IDS.reduce(
    (total, id) => total + Number(byId.get(id)?.NumeroPasajeros || 0),
    0,
  );

  return (tours || []).map((tour) => SHARED_TOUR_IDS.includes(Number(tour.Id_Tour))
    ? {
      ...tour,
      Tours_Cupo_Compartido: [...SHARED_TOUR_IDS],
      Fuente_Cupo_Compartido: SHARED_CAPACITY_SOURCE_ID,
      Cupo_Compartido: sharedCapacity,
      Ocupacion_Compartida: sharedOccupancy,
    }
    : tour);
}

function consolidateCapacityAlerts(rows = [], limit = 8) {
  const byTourAndDate = new Map((rows || []).map((row) => [
    `${Number(row.Id_Tour)}:${String(row.Fecha).slice(0, 10)}`,
    row,
  ]));
  const dates = new Set((rows || []).map((row) => String(row.Fecha).slice(0, 10)));
  const alerts = [];

  for (const date of dates) {
    const linkedRows = SHARED_TOUR_IDS
      .map((id) => byTourAndDate.get(`${id}:${date}`))
      .filter(Boolean);
    if (linkedRows.length) {
      const source = byTourAndDate.get(`${SHARED_CAPACITY_SOURCE_ID}:${date}`);
      const capacity = Number(source?.Capacidad || 0);
      const occupied = linkedRows.reduce((sum, row) => sum + Number(row.Ocupados || 0), 0);
      const percentage = capacity > 0 ? Math.round((occupied / capacity) * 100) : null;
      if ((capacity <= 0 && occupied > 0) || (percentage !== null && percentage >= 80)) {
        const names = SHARED_TOUR_IDS
          .map((id) => byTourAndDate.get(`${id}:${date}`)?.Nombre_Tour)
          .filter(Boolean);
        alerts.push({
          tourId: 1,
          tourName: names.join(' y ') || 'Cupo compartido',
          date,
          capacity,
          occupied,
          percentage,
          status: capacity <= 0 ? 'missing' : percentage >= 100 ? 'full' : percentage >= 90 ? 'critical' : 'warning',
        });
      }
    }
  }

  for (const row of rows || []) {
    const tourId = Number(row.Id_Tour);
    if (SHARED_TOUR_IDS.includes(tourId)) continue;
    const capacity = Number(row.Capacidad || 0);
    const occupied = Number(row.Ocupados || 0);
    const percentage = capacity > 0 ? Math.round((occupied / capacity) * 100) : null;
    if ((capacity <= 0 && occupied > 0) || (percentage !== null && percentage >= 80)) {
      alerts.push({
        tourId,
        tourName: row.Nombre_Tour,
        date: String(row.Fecha).slice(0, 10),
        capacity,
        occupied,
        percentage,
        status: capacity <= 0 ? 'missing' : percentage >= 100 ? 'full' : percentage >= 90 ? 'critical' : 'warning',
      });
    }
  }

  return alerts.sort((a, b) => {
    const severity = (alert) => alert.status === 'missing' ? 2 : (alert.percentage || 0) / 100;
    return severity(b) - severity(a) || a.date.localeCompare(b.date) || a.tourId - b.tourId;
  }).slice(0, limit);
}

module.exports = {
  SHARED_TOUR_IDS,
  SHARED_CAPACITY_SOURCE_ID,
  annotateSharedCapacity,
  consolidateCapacityAlerts,
};
