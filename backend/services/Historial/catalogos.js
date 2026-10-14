const MODULOS_HISTORIAL = Object.freeze([
  { value: 'reservas', label: 'Reservas', tablas: ['reservas', 'pasajeros'] },
  { value: 'transfers', label: 'Transfers', tablas: ['transfers'] },
  { value: 'tours', label: 'Tours', tablas: ['tours', 'tour_precios'] },
  { value: 'puntos', label: 'Puntos de encuentro', tablas: ['puntos', 'horarios'] },
  { value: 'usuarios', label: 'Usuarios', tablas: ['usuarios', 'sesiones'] },
  { value: 'entidades_reportantes', label: 'Entidades reportantes', tablas: ['entidades_reportantes', 'entidad_reportante_puntos'] },
  { value: 'programacion', label: 'Programación', tablas: ['programacion', 'programacion_buses'] },
  { value: 'comisiones', label: 'Comisiones', tablas: ['liquidaciones', 'beneficiarios_comision'] },
  { value: 'aforos', label: 'Aforos', tablas: ['aforos'] },
  { value: 'turnos', label: 'Turnos', tablas: ['turnos_dias', 'turnos_semanas', 'turnos_intercambios'] },
  { value: 'otros', label: 'Otros registros', tablas: [] },
]);

const ACCIONES_CONOCIDAS = Object.freeze([
  'LOGIN', 'LOGOUT', 'LOGOUT_ALL_SESSIONS', 'FORCE_LOGOUT_USER',
  'PASSWORD_RESET_REQUEST', 'PASSWORD_CHANGED_BY_RESET',
  'CREAR_USUARIO', 'ACTUALIZAR_USUARIO', 'ACTUALIZAR_PERFIL', 'ELIMINAR_USUARIO',
  'ACTUALIZAR_AVATAR', 'ELIMINAR_AVATAR',
  'CREAR_RESERVA', 'DUPLICAR_RESERVA', 'ACTUALIZAR_RESERVA', 'CANCELAR_RESERVA',
  'ELIMINAR_RESERVA', 'ELIMINAR_COMPROBANTE_RESERVA', 'ACTUALIZAR_ESTADO_AUTOMATICO', 'CAMBIO_ESTADO_RESERVA',
  'CREAR_TRANSFER', 'ACTUALIZAR_TRANSFER', 'CANCELAR_TRANSFER', 'ELIMINAR_TRANSFER',
  'AGREGAR_COMPROBANTE_TRANSFER',
  'CREAR_TOUR', 'ACTUALIZAR_TOUR', 'ELIMINAR_TOUR', 'DESACTIVAR_TOUR', 'UPSERT_PRECIOS',
  'CREAR_PUNTO', 'ACTUALIZAR_PUNTO', 'ELIMINAR_PUNTO', 'DESACTIVAR_PUNTO', 'REORDENAR_RUTA',
  'CREAR_HORARIO_PUNTO', 'ACTUALIZAR_HORARIO_PUNTO', 'ELIMINAR_HORARIO_PUNTO',
  'CAMBIAR_AFORO_TOUR', 'RETIRAR_AFORO_TOUR',
  'GUARDAR_LISTADO', 'EXPORTAR_EXCEL_LISTADO', 'EXPORTAR_EXCEL_PRIVADO', 'GUARDAR_PROGRAMACION_PRIVADA',
  'ACTUALIZAR_ASIGNACION_SEGUROS',
  'PAGAR_COMISIONES', 'REABRIR_COMISIONES', 'ACTUALIZAR_DATOS_PAGO_COMISION',
  'CREAR_BENEFICIARIO_COMISION', 'ACTUALIZAR_BENEFICIARIO_COMISION',
  'VALIDAR', 'ASOCIAR', 'DESASOCIAR', 'ACTUALIZAR_ASISTENCIA',
  'ACTUALIZAR_TURNOS_SEMANA', 'COPIAR_TURNOS_SEMANA_ANTERIOR', 'PUBLICAR_TURNOS_SEMANA',
  'ACEPTAR_INTERCAMBIO_TURNO', 'RECHAZAR_INTERCAMBIO_TURNO', 'CAMBIO_ESTADO_RESERVA',
  'CREAR', 'ACTUALIZAR', 'ELIMINAR',
]);

const ETIQUETAS_ACCION = Object.freeze({
  LOGIN: 'Inicio de sesión', LOGOUT: 'Cierre de sesión',
  LOGOUT_ALL_SESSIONS: 'Cierre de todas las sesiones', FORCE_LOGOUT_USER: 'Cierre forzado de sesión',
  PASSWORD_RESET_REQUEST: 'Solicitud de restablecimiento de contraseña',
  PASSWORD_CHANGED_BY_RESET: 'Cambio de contraseña',
  UPDATE: 'Actualización', DELETE: 'Eliminación', EXPORT: 'Exportación', IMPORT: 'Importación',
});

function etiquetaAccion(value) {
  const action = String(value || '').trim().toUpperCase();
  if (ETIQUETAS_ACCION[action]) return ETIQUETAS_ACCION[action];
  const labels = {
    CREAR: 'Creación', ACTUALIZAR: 'Actualización', ELIMINAR: 'Eliminación',
    DESACTIVAR: 'Desactivación', CANCELAR: 'Cancelación', EXPORTAR: 'Exportación',
    IMPORTAR: 'Importación', VALIDAR: 'Validación', ASOCIAR: 'Asociación', DESASOCIAR: 'Desasociación',
    PAGAR: 'Pago', REABRIR: 'Reapertura', GUARDAR: 'Guardado', PUBLICAR: 'Publicación',
    COPIAR: 'Copia', CAMBIAR: 'Cambio', RETIRAR: 'Retiro', REORDENAR: 'Reordenamiento',
    AGREGAR: 'Adición', DUPLICAR: 'Duplicación', UPSERT: 'Actualización',
  };
  const [prefix, ...rest] = action.split('_');
  const subject = rest.join(' ').toLocaleLowerCase('es-CO');
  return [labels[prefix] || (prefix ? prefix[0] + prefix.slice(1).toLocaleLowerCase('es-CO') : ''), subject]
    .filter(Boolean).join(' ');
}

const tablaAModulo = new Map(MODULOS_HISTORIAL.flatMap((module) => module.tablas.map((table) => [table, module])));
function moduloDeTabla(table) { return tablaAModulo.get(String(table || '')) || MODULOS_HISTORIAL.at(-1); }

module.exports = { MODULOS_HISTORIAL, ACCIONES_CONOCIDAS, etiquetaAccion, moduloDeTabla };
