const SENSITIVE_COLUMN_PATTERNS = [
  'password',
  'contrasena',
  'contraseña',
  'token',
  'secret',
  'hash',
];

const IA_MODULE_PERMISSIONS = {
  reservas: 'RESERVAS.LEER',
  tours: 'TOURS.LEER',
  transfers: 'TRANSFERS.LEER',
  puntos: 'PUNTOS.LEER',
  canales_reservas: 'RESERVAS.LEER',
  horarios: 'RESERVAS.LEER',
  aforos: 'TOURS.LEER',
  pasajeros: 'RESERVAS.LEER',
  pagos_reservas: 'RESERVAS.LEER',
  pagos_transfers: 'TRANSFERS.LEER',
};

const IA_ALLOWED_TABLES = {
  reservas: {
    sqlName: 'reservas',
    logicalName: 'Reservas',
    permission: IA_MODULE_PERMISSIONS.reservas,
    description:
      'Cabecera de reservas de tours. Une con horarios por Id_Horario, con canales_reservas por Id_Canal y con pagos_reservas/pasajeros por Id_Reserva.',
    allowedColumns: [
      'Id_Reserva',
      'Tipo_Reserva',
      'Id_Horario',
      'Fecha_Tour',
      'Fecha_Registro',
      'Id_Canal',
      'Idioma_Reserva',
      'Telefono_Reportante',
      'Nombre_Reportante',
      'Estado',
      'Observaciones',
      'Placa_Bus',
      'Orden_Ruta',
    ],
    dateColumns: ['Fecha_Tour', 'Fecha_Registro'],
    stateColumns: ['Estado'],
    operationalNotes: [
      'Estados observados y/o normalizados en la app: Pendiente, Pendiente de datos, Pendiente de pago, Confirmada, Completada, Cancelada.',
      'Tambien pueden aparecer valores legacy: Activo, Confirmado, Completado, Cancelado.',
      'Fecha_Tour es la fecha operativa principal para preguntas como hoy/manana.',
    ],
  },
  tours: {
    sqlName: 'tours',
    logicalName: 'Tours',
    permission: IA_MODULE_PERMISSIONS.tours,
    description:
      'Catalogo de tours. El cupo operativo parte de Cupo_Base y puede ser sobreescrito por aforos en una Fecha_Aforo.',
    allowedColumns: [
      'Id_Tour',
      'Nombre_Tour',
      'Abreviacion',
      'Cupo_Base',
      'Latitud',
      'Longitud',
      'Activo',
    ],
    stateColumns: ['Activo'],
    operationalNotes: [
      'Para cupos diarios usar aforos.Cupo si existe para la fecha; si no, usar tours.Cupo_Base.',
      'Solo consultar tours activos cuando la pregunta sea por disponibilidad o catalogo vigente.',
    ],
  },
  transfers: {
    sqlName: 'transfers',
    logicalName: 'Transfers',
    permission: IA_MODULE_PERMISSIONS.transfers,
    description:
      'Cabecera de servicios de transfer. Une con pagos_transfers por Id_Transfer.',
    allowedColumns: [
      'Id_Transfer',
      'Nombre_Titular',
      'DNI',
      'Telefono_Titular',
      'Cantidad_Personas',
      'Id_Rango',
      'Id_Servicio',
      'Punto_Salida',
      'Punto_Destino',
      'Fecha_Transfer',
      'Hora_Recogida',
      'Nombre_Reportante',
      'Telefono_Reportante',
      'Valor',
      'Id_Moneda',
      'Vuelo',
      'TipoVuelo',
      'Fecha_Registro',
      'Estado',
      'Observaciones',
    ],
    dateColumns: ['Fecha_Transfer', 'Fecha_Registro'],
    stateColumns: ['Estado'],
    operationalNotes: [
      'Estados observados y/o normalizados en la app: Pendiente, Pendiente de datos, Pendiente de pago, Confirmado, Completado, Cancelado.',
      'Tambien pueden aparecer valores legacy: Activo, Confirmada, Completada, Cancelada.',
      'Fecha_Transfer es la fecha operativa principal.',
    ],
  },
  puntos: {
    sqlName: 'puntos',
    logicalName: 'Puntos',
    permission: IA_MODULE_PERMISSIONS.puntos,
    description:
      'Catalogo de puntos de encuentro o recogida. Une con horarios por Id_Punto y con pasajeros por Id_Punto.',
    allowedColumns: [
      'Id_Punto',
      'Nombre_Punto',
      'Sector',
      'Direccion',
      'ruta',
      'posicion',
      'Latitud',
      'Longitud',
    ],
    operationalNotes: [
      'ruta y posicion ordenan el punto dentro de la ruta operativa.',
      'Latitud y Longitud pueden venir nulas o en 0.0000000 para puntos pendientes o sin coordenadas utiles.',
    ],
  },
  canales_reservas: {
    sqlName: 'canales_reservas',
    logicalName: 'Canales',
    permission: IA_MODULE_PERMISSIONS.canales_reservas,
    description: 'Canales comerciales asociados a reservas por Id_Canal.',
    allowedColumns: [
      'Id_Canal',
      'Nombre_Canal',
    ],
  },
  horarios: {
    sqlName: 'horarios',
    logicalName: 'Horarios',
    permission: IA_MODULE_PERMISSIONS.horarios,
    description:
      'Relacion entre tour y punto. Une reservas con tours/puntos. Hora_Salida puede ser una franja horaria o textos como Pendiente/N_A.',
    allowedColumns: [
      'Id_Horario',
      'Id_Punto',
      'Id_Tour',
      'Hora_Salida',
    ],
    operationalNotes: [
      'Join usual: reservas.Id_Horario = horarios.Id_Horario.',
      'Join tour: horarios.Id_Tour = tours.Id_Tour.',
      'Join punto base del horario: horarios.Id_Punto = puntos.Id_Punto.',
    ],
  },
  aforos: {
    sqlName: 'aforos',
    logicalName: 'Aforos',
    permission: IA_MODULE_PERMISSIONS.aforos,
    description:
      'Cupo configurado por tour y fecha. Si existe para la fecha, prevalece sobre tours.Cupo_Base.',
    allowedColumns: [
      'Id_Aforo',
      'Id_Tour',
      'Cupo',
      'Fecha_Aforo',
    ],
    dateColumns: ['Fecha_Aforo'],
    operationalNotes: [
      'Para una fecha concreta tomar el ultimo aforo por Id_Aforo DESC.',
      'Fecha_Aforo es la fecha operativa del cupo.',
    ],
  },
  pasajeros: {
    sqlName: 'pasajeros',
    logicalName: 'Pasajeros',
    permission: IA_MODULE_PERMISSIONS.pasajeros,
    description:
      'Detalle de pasajeros por reserva. Es necesaria para conteos reales, precios por pasajero y punto asignado por pasajero.',
    allowedColumns: [
      'Id_Pasajero',
      'Id_Reserva',
      'Nombre_Pasajero',
      'DNI',
      'Telefono_Pasajero',
      'Tipo_Pasajero',
      'Precio_Tour',
      'Precio_Pasajero',
      'Comision',
      'Id_Punto',
      'Confirmacion',
    ],
    operationalNotes: [
      'Para reservas grupales, el conteo operativo suele usar Tipo_Pasajero IN (ADULTO, NINO).',
      'Id_Punto puede ser NULL: eso permite detectar reservas o pasajeros sin punto asignado.',
    ],
  },
  pagos_reservas: {
    sqlName: 'pagos_reservas',
    logicalName: 'Pagos Reservas',
    permission: IA_MODULE_PERMISSIONS.pagos_reservas,
    description:
      'Pagos y soportes de una reserva. Une con reservas por Id_Reserva.',
    allowedColumns: [
      'Id_Pago',
      'Id_Reserva',
      'Monto',
      'Tipo',
      'Fecha_Pago',
      'Observaciones',
      'Ruta_Comprobante',
    ],
    dateColumns: ['Fecha_Pago'],
    paymentColumns: ['Monto', 'Tipo', 'Ruta_Comprobante'],
    operationalNotes: [
      'Ruta_Comprobante puede ser N/A, vacia o NULL cuando no hay soporte util.',
      'Para pendiente de pago en reservas suele compararse SUM(pasajeros.Precio_Pasajero) contra SUM(pagos_reservas.Monto).',
      'Tipos observados: Pago Directo, Pago Completo y Abono.',
    ],
  },
  pagos_transfers: {
    sqlName: 'pagos_transfers',
    logicalName: 'Pagos Transfers',
    permission: IA_MODULE_PERMISSIONS.pagos_transfers,
    description:
      'Pagos y soportes de un transfer. Une con transfers por Id_Transfer.',
    allowedColumns: [
      'Id_Pago',
      'Id_Transfer',
      'Monto',
      'Metodo',
      'Fecha_Pago',
      'Estado',
      'Observaciones',
      'Pago_Comprobante',
    ],
    dateColumns: ['Fecha_Pago'],
    stateColumns: ['Estado'],
    paymentColumns: ['Monto', 'Metodo', 'Pago_Comprobante'],
    operationalNotes: [
      'Pago_Comprobante puede faltar o ser no util cuando no se cargo soporte.',
      'Para transfers sin comprobante revisar pagos_transfers con Pago_Comprobante NULL, vacio o N/A.',
    ],
  },
};

function normalizeIdentifier(value) {
  return String(value || '')
    .trim()
    .replace(/`/g, '')
    .toLowerCase();
}

function getAllowedTable(identifier) {
  return IA_ALLOWED_TABLES[normalizeIdentifier(identifier)] || null;
}

function getAllowedTableMap() {
  return IA_ALLOWED_TABLES;
}

function buildTablePrompt(table) {
  const lines = [
    `Tabla: ${table.sqlName}`,
    `Modulo: ${table.logicalName}`,
    `Permiso requerido: ${table.permission}`,
    `Descripcion: ${table.description}`,
    `Columnas permitidas: ${table.allowedColumns.join(', ')}`,
  ];

  if (Array.isArray(table.dateColumns) && table.dateColumns.length) {
    lines.push(`Columnas de fecha: ${table.dateColumns.join(', ')}`);
  }

  if (Array.isArray(table.stateColumns) && table.stateColumns.length) {
    lines.push(`Columnas de estado: ${table.stateColumns.join(', ')}`);
  }

  if (Array.isArray(table.paymentColumns) && table.paymentColumns.length) {
    lines.push(`Columnas de pago/comprobante: ${table.paymentColumns.join(', ')}`);
  }

  if (Array.isArray(table.operationalNotes) && table.operationalNotes.length) {
    lines.push(`Notas operativas: ${table.operationalNotes.join(' | ')}`);
  }

  return lines.join('\n');
}

function buildSchemaContextPrompt() {
  const tableLines = Object.values(IA_ALLOWED_TABLES).map(buildTablePrompt);

  return [
    'Eres el generador SQL read-only de SIR-IA para la base sir2.',
    'Trabajas junto a un agente operativo con tools controladas por backend.',
    'Si la consulta podria resolverse por una tool read-only, igual debes seguir devolviendo unicamente SQL valido cuando te llamen desde el modo sql_query.',
    'Debes responder solo con JSON valido y sin markdown.',
    'Formato estricto de salida:',
    '{"intent":"resumen corto de la intencion","entityType":"tabla principal o unknown","sql":"SELECT ... LIMIT n","expectedAction":null}',
    'Reglas obligatorias:',
    '- Genera exactamente una sola consulta SELECT de MySQL.',
    '- No uses INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, REPLACE, GRANT, REVOKE, CALL ni EXECUTE.',
    '- No uses SELECT * para listados ni joins.',
    '- Para conteos puedes usar COUNT(*) AS total.',
    '- TODA consulta debe incluir LIMIT explicito entre 1 y 100.',
    '- Incluso COUNT, SUM, AVG, GROUP BY o cualquier agregacion deben incluir LIMIT.',
    '- Para COUNT simple usa LIMIT 1.',
    '- Para listados usa LIMIT 50 salvo que haya una razon clara para un limite menor.',
    '- Nunca devuelvas SQL sin LIMIT.',
    '- Solo puedes consultar las tablas y columnas permitidas en este contexto.',
    '- Usa aliases claros y consistentes, por ejemplo r, h, t, p, pt, pr, tr, a.',
    '- No inventes columnas ni relaciones fuera de las declaradas aqui.',
    '- Evita SQL fragil; usa joins reales y filtros sobre columnas existentes.',
    '- entityType debe ser uno de: reservas, transfers, tours, puntos, aforos, unknown.',
    '- expectedAction debe ser uno de: buscar_reservas, ver_transfers, ver_aforos, ver_tours, ver_puntos, null.',
    '- Si el usuario pide contraseñas, tokens, hashes, secretos, credenciales, usuarios tecnicos, datos de autenticacion o informacion sensible del sistema, debes devolver exactamente este JSON: {"intent":"blocked_sensitive_request","entityType":"unknown","sql":null,"expectedAction":null}.',
    '- Si la pregunta es claramente fuera del dominio de SIR, por ejemplo recetas, matematicas, futbol o conocimiento general, debes devolver exactamente este JSON: {"intent":"out_of_domain","entityType":"unknown","sql":null,"expectedAction":null}.',
    '- No respondas conocimiento general.',
    '- Si la consulta es ambigua pero podria referirse a operacion de SIR, intenta interpretarla en clave operativa usando contexto antes de marcarla fuera de dominio.',
    '- Si no hay contexto suficiente para desambiguar una consulta operativa corta como "y las pendientes", devuelve {"intent":"needs_clarification","entityType":"unknown","sql":null,"expectedAction":null}.',
    '',
    'Dominio permitido de SIR:',
    '- reservas',
    '- pasajeros',
    '- tours',
    '- transfers',
    '- puntos de encuentro',
    '- rutas',
    '- horarios',
    '- aforos y cupos',
    '- pagos, abonos y comprobantes',
    '- operacion diaria',
    '- historial o auditoria solo si el backend lo permite',
    '',
    'Tools operativas ya registradas en el backend:',
    '- buscar_entidad',
    '- consultar_reservas',
    '- consultar_cupos',
    '- consultar_transfers',
    '- consultar_pagos',
    '- consultar_puntos',
    '- consultar_tours',
    '',
    'Fechas relativas:',
    '- hoy = CURDATE()',
    '- manana = DATE_ADD(CURDATE(), INTERVAL 1 DAY)',
    '',
    'Relaciones reales mas importantes:',
    '- reservas.Id_Horario = horarios.Id_Horario',
    '- horarios.Id_Tour = tours.Id_Tour',
    '- horarios.Id_Punto = puntos.Id_Punto',
    '- reservas.Id_Canal = canales_reservas.Id_Canal',
    '- pasajeros.Id_Reserva = reservas.Id_Reserva',
    '- pasajeros.Id_Punto = puntos.Id_Punto',
    '- pagos_reservas.Id_Reserva = reservas.Id_Reserva',
    '- aforos.Id_Tour = tours.Id_Tour',
    '- pagos_transfers.Id_Transfer = transfers.Id_Transfer',
    '',
    'Patrones operativos recomendados:',
    '- Para reservas de un tour por fecha: reservas r JOIN horarios h JOIN tours t.',
    '- Para cupos/disponibilidad: tours t LEFT JOIN aforos a por fecha y, si hace falta ocupacion real, sumar pasajeros de reservas grupales no canceladas usando pasajeros.',
    '- Para reservas sin punto: revisar pasajeros.Id_Punto IS NULL; no asumas que el punto esta solo en horarios.',
    '- Para reservas pendientes de pago: compara SUM(pasajeros.Precio_Pasajero) con SUM(pagos_reservas.Monto).',
    '- Para informacion incompleta en reservas: usar solo columnas permitidas y detectar faltantes con pasajeros.Id_Punto IS NULL, pasajeros.DNI IS NULL o vacio, pasajeros.Telefono_Pasajero IS NULL o vacio, pasajeros.Precio_Pasajero IS NULL o 0, reservas.Id_Canal IS NULL.',
    '- Cuando el usuario pregunte por "falta informacion", "incompletas", "sin datos" o similares en reservas, interpreta el filtro como informacion_incompleta.',
    '- Para informacion_incompleta en reservas, si haces listado devuelve columnas explicitas utiles como r.Id_Reserva, r.Fecha_Tour, r.Estado, r.Nombre_Reportante, t.Nombre_Tour, pas.Nombre_Pasajero, pas.DNI, pas.Telefono_Pasajero, pas.Id_Punto, pas.Precio_Pasajero y, si cabe, un CASE sencillo AS motivo_pendiente. Usa LIMIT 50.',
    '- Para transfers sin comprobante: usa pagos_transfers y considera comprobante faltante cuando Pago_Comprobante sea NULL, vacio o N/A.',
    '- Para puntos sin coordenadas: usa Latitud/Longitud nulas o en 0 si la consulta lo sugiere.',
    '',
    'Ejemplos obligatorios de uso del contexto:',
    '- Ejemplo A: Usuario: "reservas de guatape el 22 de enero?" => filtrar por tour Guatape y por esa fecha.',
    '- Ejemplo B: Contexto anterior: reservas de Guatape el 22 de enero. Usuario: "reservas el 22 de enero?" => consultar todas las reservas del 22 de enero. No conserves el filtro de Guatape si el usuario ya no menciona tour.',
    '- Ejemplo C: Contexto anterior: reservas del 22 de enero. Usuario: "y cuales les hace falta informacion?" => consultar reservas o pasajeros con informacion_incompleta para esa fecha usando el contexto actual.',
    '- Si el usuario menciona una nueva fecha junto con reservas pero no menciona tour, limpia cualquier tour previo del contexto.',
    '',
    'Esquema permitido:',
    tableLines.join('\n\n'),
  ].join('\n');
}

module.exports = {
  IA_ALLOWED_TABLES,
  IA_MODULE_PERMISSIONS,
  SENSITIVE_COLUMN_PATTERNS,
  normalizeIdentifier,
  getAllowedTable,
  getAllowedTableMap,
  buildSchemaContextPrompt,
};
