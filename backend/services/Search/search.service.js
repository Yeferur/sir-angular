const db = require('../../database/db');

const LIMITS = {
  reservas: 5,
  transfers: 5,
  tours: 5,
  puntos: 5,
  usuarios: 5,
  modules: 8,
};

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function sanitizeQuery(query) {
  return String(query || '').trim().replace(/\s+/g, ' ');
}

function isSensitiveQuery(query) {
  const normalized = normalizeText(query);
  return /\b(password|contrasena|contrasenas|token|tokens|jwt|secret|secreto|hash|credencial|credenciales|clave|claves)\b/.test(normalized);
}

function isExactIdCandidate(query) {
  const value = sanitizeQuery(query);
  if (!value || value.includes(' ')) return false;
  if (/^\d+$/.test(value)) return true;
  return /^(?=.*\d)[A-Za-z0-9-]{2,}$/.test(value);
}

function canSearchQuery(query) {
  const value = sanitizeQuery(query);
  if (!value) return false;
  return value.length >= 2 || isExactIdCandidate(value);
}

function hasPermission(permisos, ...codes) {
  return codes.some((code) => permisos.includes(code));
}

function tomorrowYmd() {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  return now.toISOString().slice(0, 10);
}

function buildReservaActions(row, permisos) {
  const actions = [];
  const id = String(row.Id_Reserva || '');

  if (hasPermission(permisos, 'RESERVAS.LEER')) {
    actions.push({
      label: 'Ver detalle',
      kind: 'open-reserva',
      entityId: id,
      permission: 'RESERVAS.LEER',
    });
    actions.push({
      label: 'Ir a Ver Reservas',
      kind: 'navigate',
      route: '/Reservas/VerReservas',
      permission: 'RESERVAS.LEER',
    });
  }

  if (hasPermission(permisos, 'RESERVAS.ACTUALIZAR')) {
    actions.push({
      label: 'Editar reserva',
      kind: 'navigate',
      route: `/Reservas/EditarReserva/${encodeURIComponent(id)}`,
      entityId: id,
      permission: 'RESERVAS.ACTUALIZAR',
    });
  }

  return actions;
}

function buildTransferActions(row, permisos) {
  const actions = [];
  const id = String(row.Id_Transfer || '');

  if (hasPermission(permisos, 'TRANSFERS.LEER')) {
    actions.push({
      label: 'Ver detalle',
      kind: 'open-transfer',
      entityId: id,
      permission: 'TRANSFERS.LEER',
    });
    actions.push({
      label: 'Ir a Ver Transfers',
      kind: 'navigate',
      route: '/Transfers/VerTransfers',
      permission: 'TRANSFERS.LEER',
    });
  }

  if (hasPermission(permisos, 'TRANSFERS.ACTUALIZAR')) {
    actions.push({
      label: 'Editar transfer',
      kind: 'navigate',
      route: `/Transfers/EditarTransfer/${encodeURIComponent(id)}`,
      entityId: id,
      permission: 'TRANSFERS.ACTUALIZAR',
    });
  }

  return actions;
}

function buildTourActions(row, permisos) {
  const actions = [];
  const id = Number(row.Id_Tour);
  const nombre = String(row.Nombre_Tour || '').trim();

  if (hasPermission(permisos, 'TOURS.LEER')) {
    actions.push({
      label: 'Ver tours',
      kind: 'navigate',
      route: '/Tours/VerTours',
      permission: 'TOURS.LEER',
    });
  }

  if (hasPermission(permisos, 'TOURS.ACTUALIZAR')) {
    actions.push({
      label: 'Editar tour',
      kind: 'navigate',
      route: `/Tours/Editar/${id}`,
      entityId: id,
      permission: 'TOURS.ACTUALIZAR',
    });
  }

  if (hasPermission(permisos, 'RESERVAS.LEER')) {
    actions.push({
      label: 'Ver reservas del tour',
      kind: 'filter',
      route: '/Reservas/VerReservas',
      entityId: id,
      permission: 'RESERVAS.LEER',
      params: {
        queryParams: { Id_Tour: id, q: nombre },
        pendingReason: 'El módulo Ver Reservas todavía no hidrata filtros desde la URL; se navega al módulo sin aplicar el tour automáticamente.',
      },
    });
  }

  if (hasPermission(permisos, 'AFOROS.LEER', 'INICIO.LEER')) {
    actions.push({
      label: 'Ver aforo mañana',
      kind: 'aforo',
      route: '/Aforos',
      entityId: id,
      permission: hasPermission(permisos, 'AFOROS.LEER') ? 'AFOROS.LEER' : 'INICIO.LEER',
      params: {
        queryParams: { tour: id, fecha: tomorrowYmd() },
        pendingReason: 'Aforos todavía no hidrata tour y fecha desde query params; se navega al módulo para revisión manual.',
      },
    });
  }

  if (hasPermission(permisos, 'INFORMES.LEER', 'DASHBOARD.LEER')) {
    actions.push({
      label: 'Ver informes filtrados',
      kind: 'dashboard',
      route: '/Informes',
      entityId: id,
      permission: hasPermission(permisos, 'INFORMES.LEER') ? 'INFORMES.LEER' : 'DASHBOARD.LEER',
      params: {
        queryParams: { tour: id },
        pendingReason: 'Informes todavía no hidrata filtros por tour desde la URL; se navega al módulo sin filtro automático.',
      },
    });
  }

  return actions;
}

function buildPuntoActions(row, permisos) {
  const actions = [];
  const id = Number(row.Id_Punto);
  const nombre = String(row.Nombre_Punto || '').trim();

  if (hasPermission(permisos, 'PUNTOS.LEER')) {
    actions.push({
      label: 'Ver punto',
      kind: 'filter',
      route: '/Puntos/VerPuntos',
      entityId: id,
      permission: 'PUNTOS.LEER',
      params: {
        queryParams: { q: nombre },
        pendingReason: 'Ver Puntos todavía no hidrata filtros desde la URL; se navega al módulo sin seleccionar el punto automáticamente.',
      },
    });
  }

  if (hasPermission(permisos, 'PUNTOS.ACTUALIZAR')) {
    actions.push({
      label: 'Editar punto',
      kind: 'navigate',
      route: `/Puntos/Editar/${id}`,
      entityId: id,
      permission: 'PUNTOS.ACTUALIZAR',
    });
  }

  if (hasPermission(permisos, 'RESERVAS.LEER')) {
    actions.push({
      label: 'Ver reservas asociadas',
      kind: 'filter',
      route: '/Reservas/VerReservas',
      entityId: id,
      permission: 'RESERVAS.LEER',
      params: {
        queryParams: { Punto: nombre },
        pendingReason: 'Ver Reservas exige seleccionar el punto desde su autocompletado; se navega al módulo sin aplicar el punto automáticamente.',
      },
    });
  }

  return actions;
}

function buildUsuarioActions(row, permisos) {
  const actions = [];
  const id = Number(row.Id_Usuario);

  if (hasPermission(permisos, 'USUARIOS.LEER')) {
    actions.push({
      label: 'Ir a usuarios',
      kind: 'navigate',
      route: '/Usuarios',
      entityId: id,
      permission: 'USUARIOS.LEER',
    });
  }

  if (hasPermission(permisos, 'USUARIOS.ACTUALIZAR')) {
    actions.push({
      label: 'Editar usuario',
      kind: 'navigate',
      route: `/Usuarios/Editar/${id}`,
      entityId: id,
      permission: 'USUARIOS.ACTUALIZAR',
    });
  }

  return actions;
}

async function searchReservas(query, permisos) {
  if (!hasPermission(permisos, 'RESERVAS.LEER')) return [];

  const exact = sanitizeQuery(query);
  const like = `%${exact}%`;
  const sql = `
    SELECT
      r.Id_Reserva,
      r.Fecha_Tour,
      r.Estado,
      r.Nombre_Reportante,
      r.Telefono_Reportante,
      t.Nombre_Tour,
      GROUP_CONCAT(DISTINCT p.Nombre_Pasajero ORDER BY p.Nombre_Pasajero SEPARATOR ', ') AS Pasajeros
    FROM reservas r
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour
    LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
    WHERE (
      UPPER(r.Id_Reserva) = UPPER(?)
      OR r.Id_Reserva LIKE ?
      OR r.Nombre_Reportante LIKE ?
      OR r.Telefono_Reportante LIKE ?
      OR EXISTS (
        SELECT 1
        FROM pasajeros px
        WHERE px.Id_Reserva = r.Id_Reserva
          AND (
            px.DNI LIKE ?
            OR px.Nombre_Pasajero LIKE ?
            OR px.Telefono_Pasajero LIKE ?
          )
      )
    )
    GROUP BY
      r.Id_Reserva,
      r.Fecha_Tour,
      r.Estado,
      r.Nombre_Reportante,
      r.Telefono_Reportante,
      t.Nombre_Tour
    ORDER BY
      CASE WHEN UPPER(r.Id_Reserva) = UPPER(?) THEN 0 ELSE 1 END,
      r.Fecha_Tour DESC,
      r.Id_Reserva DESC
    LIMIT ?
  `;

  const [rows] = await db.query(sql, [exact, like, like, like, like, like, like, exact, LIMITS.reservas]);
  return rows.map((row) => ({
    id: `reserva:${row.Id_Reserva}`,
    type: 'reserva',
    title: `Reserva #${row.Id_Reserva}`,
    subtitle: [row.Nombre_Tour, row.Nombre_Reportante, row.Telefono_Reportante].filter(Boolean).join(' · '),
    badge: row.Estado || undefined,
    entityId: String(row.Id_Reserva),
    permission: 'RESERVAS.LEER',
    actions: buildReservaActions(row, permisos),
    meta: {
      fecha: row.Fecha_Tour || null,
      pasajeros: row.Pasajeros || '',
    },
  }));
}

async function searchTransfers(query, permisos) {
  if (!hasPermission(permisos, 'TRANSFERS.LEER')) return [];

  const exact = sanitizeQuery(query);
  const like = `%${exact}%`;
  const sql = `
    SELECT
      t.Id_Transfer,
      t.Fecha_Transfer,
      t.Estado,
      t.Nombre_Titular,
      t.Telefono_Titular,
      t.Nombre_Reportante,
      t.Telefono_Reportante,
      s.Nombre_Servicio
    FROM transfers t
    LEFT JOIN servicios_transfer s ON s.Id_Servicio = t.Id_Servicio
    WHERE (
      CAST(t.Id_Transfer AS CHAR) = ?
      OR CAST(t.Id_Transfer AS CHAR) LIKE ?
      OR t.Nombre_Titular LIKE ?
      OR t.Nombre_Reportante LIKE ?
      OR t.Telefono_Titular LIKE ?
      OR t.Telefono_Reportante LIKE ?
      OR t.DNI LIKE ?
    )
    ORDER BY
      CASE WHEN CAST(t.Id_Transfer AS CHAR) = ? THEN 0 ELSE 1 END,
      t.Fecha_Transfer DESC,
      t.Id_Transfer DESC
    LIMIT ?
  `;

  const [rows] = await db.query(sql, [exact, like, like, like, like, like, like, exact, LIMITS.transfers]);
  return rows.map((row) => ({
    id: `transfer:${row.Id_Transfer}`,
    type: 'transfer',
    title: `Transfer #${row.Id_Transfer}`,
    subtitle: [row.Nombre_Servicio, row.Nombre_Titular || row.Nombre_Reportante, row.Telefono_Titular || row.Telefono_Reportante].filter(Boolean).join(' · '),
    badge: row.Estado || undefined,
    entityId: String(row.Id_Transfer),
    permission: 'TRANSFERS.LEER',
    actions: buildTransferActions(row, permisos),
  }));
}

async function searchTours(query, permisos) {
  if (!hasPermission(permisos, 'TOURS.LEER')) return [];

  const exact = sanitizeQuery(query);
  const like = `%${exact}%`;
  const sql = `
    SELECT Id_Tour, Nombre_Tour, Abreviacion, Cupo_Base
    FROM tours
    WHERE Activo = 1
      AND (
        Nombre_Tour LIKE ?
        OR Abreviacion LIKE ?
      )
    ORDER BY
      CASE WHEN Nombre_Tour = ? THEN 0 ELSE 1 END,
      Nombre_Tour ASC
    LIMIT ?
  `;

  const [rows] = await db.query(sql, [like, like, exact, LIMITS.tours]);
  return rows.map((row) => ({
    id: `tour:${row.Id_Tour}`,
    type: 'tour',
    title: row.Nombre_Tour,
    subtitle: row.Abreviacion ? `Abreviación: ${row.Abreviacion}` : 'Tour',
    badge: row.Cupo_Base != null ? `Cupo ${row.Cupo_Base}` : undefined,
    entityId: Number(row.Id_Tour),
    permission: 'TOURS.LEER',
    actions: buildTourActions(row, permisos),
  }));
}

async function searchPuntos(query, permisos) {
  if (!hasPermission(permisos, 'PUNTOS.LEER')) return [];

  const exact = sanitizeQuery(query);
  const like = `%${exact}%`;
  const sql = `
    SELECT Id_Punto, Nombre_Punto, Direccion, ruta
    FROM puntos
    WHERE (
      Nombre_Punto LIKE ?
      OR Direccion LIKE ?
      OR ruta LIKE ?
    )
    ORDER BY
      CASE WHEN Nombre_Punto = ? THEN 0 ELSE 1 END,
      Nombre_Punto ASC
    LIMIT ?
  `;

  const [rows] = await db.query(sql, [like, like, like, exact, LIMITS.puntos]);
  return rows.map((row) => ({
    id: `punto:${row.Id_Punto}`,
    type: 'punto',
    title: row.Nombre_Punto,
    subtitle: [row.ruta, row.Direccion].filter(Boolean).join(' · '),
    badge: row.ruta || undefined,
    entityId: Number(row.Id_Punto),
    permission: 'PUNTOS.LEER',
    actions: buildPuntoActions(row, permisos),
  }));
}

async function searchUsuarios(query, permisos) {
  if (!hasPermission(permisos, 'USUARIOS.LEER')) return [];

  const exact = sanitizeQuery(query);
  const like = `%${exact}%`;
  const sql = `
    SELECT Id_Usuario, Nombres_Apellidos, Correo, Usuario
    FROM usuarios
    WHERE Activo = 1
      AND (
        Nombres_Apellidos LIKE ?
        OR Correo LIKE ?
        OR Usuario LIKE ?
      )
    ORDER BY
      CASE WHEN Nombres_Apellidos = ? THEN 0 ELSE 1 END,
      Nombres_Apellidos ASC
    LIMIT ?
  `;

  const [rows] = await db.query(sql, [like, like, like, exact, LIMITS.usuarios]);
  return rows.map((row) => ({
    id: `usuario:${row.Id_Usuario}`,
    type: 'usuario',
    title: row.Nombres_Apellidos || row.Usuario || `Usuario #${row.Id_Usuario}`,
    subtitle: row.Correo || row.Usuario || '',
    entityId: Number(row.Id_Usuario),
    permission: 'USUARIOS.LEER',
    actions: buildUsuarioActions(row, permisos),
  }));
}

function scoreModuleMatch(normalizedQuery, keywords) {
  let score = -1;
  for (const keyword of keywords) {
    if (normalizedQuery === keyword) score = Math.max(score, 100);
    else if (normalizedQuery.startsWith(keyword)) score = Math.max(score, 80);
    else if (normalizedQuery.includes(keyword)) score = Math.max(score, 60);
  }
  return score;
}

function buildModuleResults(query, permisos) {
  const normalizedQuery = normalizeText(query);
  const catalog = [
    {
      id: 'module:home',
      type: 'module',
      title: 'Inicio',
      subtitle: 'Resumen de trabajo personalizado',
      route: '/',
      permission: null,
      keywords: ['inicio', 'home', 'resumen', 'mi jornada'],
    },
    {
      id: 'module:reservas-list',
      type: 'module',
      title: 'Ver Reservas',
      subtitle: 'Listado general de reservas',
      route: '/Reservas/VerReservas',
      permission: 'RESERVAS.LEER',
      keywords: ['reservas', 'ver reservas', 'listado reservas'],
    },
    {
      id: 'action:crear-reserva',
      type: 'action',
      title: 'Crear reserva',
      subtitle: 'Acción rápida',
      route: '/Reservas/NuevaReserva',
      permission: 'RESERVAS.CREAR',
      keywords: ['crear reserva', 'nueva reserva', 'reserva nueva'],
    },
    {
      id: 'module:transfers-list',
      type: 'module',
      title: 'Ver Transfers',
      subtitle: 'Listado general de transfers',
      route: '/Transfers/VerTransfers',
      permission: 'TRANSFERS.LEER',
      keywords: ['transfers', 'ver transfers', 'listado transfers', 'transfer'],
    },
    {
      id: 'action:crear-transfer',
      type: 'action',
      title: 'Crear transfer',
      subtitle: 'Acción rápida',
      route: '/Transfers/NuevoTransfer',
      permission: 'TRANSFERS.CREAR',
      keywords: ['crear transfer', 'nuevo transfer', 'transfer nuevo'],
    },
    {
      id: 'module:informes',
      type: 'module',
      title: 'Informes',
      subtitle: 'Indicadores e informes',
      route: '/Informes',
      permission: hasPermission(permisos, 'INFORMES.LEER') ? 'INFORMES.LEER' : 'DASHBOARD.LEER',
      keywords: ['dashboard', 'informes', 'reporte', 'reportes'],
    },
    {
      id: 'module:historial',
      type: 'module',
      title: 'Historial',
      subtitle: 'Auditoría y cambios',
      route: '/Historial',
      permission: 'HISTORIAL.LEER',
      keywords: ['historial', 'auditoria', 'auditoría', 'cambios'],
    },
    {
      id: 'module:listados',
      type: 'module',
      title: 'Listados',
      subtitle: 'Programación y logística',
      route: '/Programacion/Listado',
      permission: 'PROGRAMACION.LEER',
      keywords: ['listados', 'listado', 'programacion', 'programación', 'logistica', 'logística'],
    },
    {
      id: 'module:puntos',
      type: 'module',
      title: 'Puntos',
      subtitle: 'Gestión de puntos de encuentro',
      route: '/Puntos/VerPuntos',
      permission: 'PUNTOS.LEER',
      keywords: ['puntos', 'punto', 'encuentro'],
    },
    {
      id: 'module:usuarios',
      type: 'module',
      title: 'Usuarios',
      subtitle: 'Gestión de usuarios',
      route: '/Usuarios',
      permission: 'USUARIOS.LEER',
      keywords: ['usuarios', 'usuario', 'correo', 'empleados'],
    },
    {
      id: 'module:control-viaje',
      type: 'module',
      title: 'Control de Viaje',
      subtitle: 'Confirmación de pasajeros',
      route: '/Reservas/Confirmacion',
      permission: 'CONTROL_VIAJE.LEER',
      keywords: ['control de viaje', 'confirmacion', 'confirmación', 'pasajeros'],
    },
    {
      id: 'module:tours',
      type: 'module',
      title: 'Ver Tours',
      subtitle: 'Gestión de tours',
      route: '/Tours/VerTours',
      permission: 'TOURS.LEER',
      keywords: ['tours', 'tour', 'ver tours'],
    },
  ];

  return catalog
    .filter((item) => !item.permission || hasPermission(permisos, item.permission))
    .map((item) => ({ item, score: scoreModuleMatch(normalizedQuery, item.keywords) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, LIMITS.modules)
    .map(({ item }) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      subtitle: item.subtitle,
      route: item.route,
      permission: item.permission,
      actions: [
        {
          label: 'Abrir',
          kind: 'navigate',
          route: item.route,
          permission: item.permission,
        },
      ],
    }));
}

async function searchGlobal(query, permisos = []) {
  const safeQuery = sanitizeQuery(query);
  if (!canSearchQuery(safeQuery)) {
    return {
      query: safeQuery,
      results: [],
    };
  }

  if (isSensitiveQuery(safeQuery)) {
    return {
      query: safeQuery,
      results: [],
    };
  }

  const [reservas, transfers, tours, puntos, usuarios] = await Promise.all([
    searchReservas(safeQuery, permisos),
    searchTransfers(safeQuery, permisos),
    searchTours(safeQuery, permisos),
    searchPuntos(safeQuery, permisos),
    searchUsuarios(safeQuery, permisos),
  ]);

  const modules = buildModuleResults(safeQuery, permisos);

  return {
    query: safeQuery,
    results: [
      ...reservas,
      ...transfers,
      ...tours,
      ...puntos,
      ...usuarios,
      ...modules,
    ],
  };
}

module.exports = {
  searchGlobal,
  sanitizeQuery,
  canSearchQuery,
  isSensitiveQuery,
};
