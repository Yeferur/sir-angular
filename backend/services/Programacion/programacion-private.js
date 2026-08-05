const PRIVATE_BUS_CAPACITY = 38;

function normalizeText(value) {
    return String(value ?? '').trim();
}

function privateBusKey(bus, fallbackIndex = 0) {
    const reservationId = normalizeText(bus?.Id_Reserva_Privada || bus?.Id_Reserva || bus?.idReserva);
    const index = Math.max(1, Number(bus?.indice || bus?.Indice_Privado || fallbackIndex + 1));
    return `${reservationId}:${index}`;
}

function reconcilePrivateBuses(generatedBuses, savedRows) {
    const savedByReservation = new Map();

    for (const row of savedRows || []) {
        const reservationId = normalizeText(row?.Id_Reserva_Privada || row?.idReserva);
        if (!reservationId) continue;
        if (!savedByReservation.has(reservationId)) savedByReservation.set(reservationId, []);
        savedByReservation.get(reservationId).push(row);
    }

    for (const rows of savedByReservation.values()) {
        rows.sort((a, b) => Number(a?.Orden_Bus || 0) - Number(b?.Orden_Bus || 0));
    }

    return (generatedBuses || []).map((bus, globalIndex) => {
        const reservationId = normalizeText(bus?.Id_Reserva_Privada || bus?.Id_Reserva);
        const privateIndex = Math.max(1, Number(bus?.indice || 1));
        const saved = savedByReservation.get(reservationId)?.[privateIndex - 1];
        const defaultIdentifier = normalizeText(bus?.id) || `Bus ${globalIndex + 1}`;

        return {
            ...bus,
            id: normalizeText(saved?.Placa_Display) || defaultIdentifier,
            guia: normalizeText(saved?.Guia),
            persistido: Boolean(saved),
            nuevo: !saved,
        };
    });
}

function createPrivateValidationError(message, details = []) {
    const error = new Error(message);
    error.statusCode = 400;
    error.errorCode = 'PRIVATE_PROGRAM_VALIDATION_ERROR';
    error.details = details;
    return error;
}

function validatePrivateAssignments(submittedBuses, expectedBuses, { requireGuides = true } = {}) {
    if (!Array.isArray(submittedBuses) || !Array.isArray(expectedBuses)) {
        throw createPrivateValidationError('La programación privada no tiene un formato válido.');
    }

    const expectedByKey = new Map();
    expectedBuses.forEach((bus, index) => expectedByKey.set(privateBusKey(bus, index), { bus, index }));

    const submittedByKey = new Map();
    const duplicateKeys = new Set();
    submittedBuses.forEach((bus, index) => {
        const key = privateBusKey(bus, index);
        if (submittedByKey.has(key)) duplicateKeys.add(key);
        submittedByKey.set(key, bus);
    });

    const details = [];
    if (duplicateKeys.size) {
        details.push('Hay vehículos privados repetidos en la solicitud.');
    }

    for (const key of expectedByKey.keys()) {
        if (!submittedByKey.has(key)) {
            const reservationId = key.split(':')[0];
            details.push(`La reserva ${reservationId} cambió y debe volver a cargarse antes de guardar.`);
        }
    }

    for (const key of submittedByKey.keys()) {
        if (!expectedByKey.has(key)) {
            const reservationId = key.split(':')[0] || 'desconocida';
            details.push(`La reserva ${reservationId} ya no pertenece a la programación privada activa.`);
        }
    }

    if (details.length) {
        throw createPrivateValidationError('Las reservas privadas cambiaron mientras se editaban.', details);
    }

    const normalized = [];
    for (const [key, expected] of expectedByKey.entries()) {
        const submitted = submittedByKey.get(key) || {};
        const source = expected.bus;
        const reservationId = normalizeText(source?.Id_Reserva_Privada || source?.Id_Reserva);
        const guide = normalizeText(submitted?.guia || submitted?.Guia);
        const identifier = normalizeText(submitted?.id || submitted?.Placa_Display)
            || normalizeText(source?.id)
            || `Bus ${expected.index + 1}`;

        if (requireGuides && !guide) {
            details.push(`La reserva ${reservationId} tiene un vehículo sin guía.`);
        }
        if (identifier.length > 20) {
            details.push(`El identificador ${identifier} supera los 20 caracteres permitidos.`);
        }
        if (guide.length > 100) {
            details.push(`La guía de la reserva ${reservationId} supera los 100 caracteres permitidos.`);
        }

        normalized.push({
            ...source,
            id: identifier,
            placa: identifier,
            guia: guide,
            capacidad: Number(source?.capacidad || PRIVATE_BUS_CAPACITY),
            ocupados: Number(source?.ocupados || 0),
            indice: Math.max(1, Number(source?.indice || 1)),
            idReserva: reservationId,
            Id_Reserva_Privada: reservationId,
        });
    }

    if (details.length) {
        throw createPrivateValidationError('Faltan datos para completar la programación privada.', details);
    }

    return normalized;
}

module.exports = {
    PRIVATE_BUS_CAPACITY,
    privateBusKey,
    reconcilePrivateBuses,
    validatePrivateAssignments,
};
