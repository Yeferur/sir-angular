function obtenerReservasSinAsignar(buses = [], reservasActuales = []) {
    const idsAsignados = new Set(
        (buses || [])
            .flatMap(bus => bus?.reservas || [])
            .map(reserva => String(reserva?.Id_Reserva ?? reserva?.idReserva ?? '').trim())
            .filter(Boolean)
    );

    return (reservasActuales || []).filter(reserva => {
        const idReserva = String(reserva?.Id_Reserva ?? reserva?.idReserva ?? '').trim();
        return idReserva && !idsAsignados.has(idReserva);
    });
}

module.exports = {
    obtenerReservasSinAsignar,
};
