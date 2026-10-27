const MODULOS_HISTORIAL = Object.freeze([
  { value: 'reservas', label: 'Reservas', tablas: ['reservas', 'pasajeros'] },
  { value: 'transfers', label: 'Transfers', tablas: ['transfers'] },
  { value: 'tours', label: 'Tours', tablas: ['tours', 'tour_precios'] },
  { value: 'puntos', label: 'Puntos de encuentro', tablas: ['puntos', 'horarios'] },
  { value: 'usuarios', label: 'Usuarios', tablas: ['usuarios', 'sesiones'] },
  { value: 'entidades_reportantes', label: 'Entidades reportantes', tablas: ['entidades_reportantes', 'entidad_reportante_puntos'] },
  { value: 'programacion', label: 'Programación', tablas: ['programacion', 'programacion_buses'] },
  { value: 'comisiones', label: 'Comisiones', tablas: ['liquidaciones'] },
  { value: 'aforos', label: 'Aforos', tablas: ['aforos'] },
  { value: 'turnos', label: 'Turnos', tablas: ['turnos_dias', 'turnos_semanas', 'turnos_intercambios'] },
  { value: 'otros', label: 'Otros registros', tablas: [] },
]);

// Fuente única para el filtro: las acciones siguen guardándose con su código técnico.
// Cualquier código nuevo que aún no figure aquí pertenece a «Otros».
const TIPOS_ACTIVIDAD = Object.freeze([
  { value: 'creaciones', label: 'Creaciones', acciones: [
    'CREAR', 'CREAR_USUARIO', 'CREAR_RESERVA', 'DUPLICAR_RESERVA', 'CREAR_TRANSFER', 'AGREGAR_PASAJERO',
    'CREAR_TOUR', 'CREAR_PUNTO', 'CREAR_HORARIO_PUNTO',
  ] },
  { value: 'modificaciones', label: 'Modificaciones', acciones: [
    'ACTUALIZAR', 'ACTUALIZAR_USUARIO', 'ACTUALIZAR_PERFIL', 'ACTUALIZAR_AVATAR',
    'ACTUALIZAR_RESERVA', 'ACTUALIZAR_PASAJERO', 'ACTUALIZAR_ESTADO_AUTOMATICO', 'CAMBIO_ESTADO_RESERVA',
    'ACTUALIZAR_TRANSFER', 'AGREGAR_COMPROBANTE_TRANSFER', 'ACTUALIZAR_TOUR', 'UPSERT_PRECIOS',
    'ACTUALIZAR_PUNTO', 'ACTUALIZAR_HORARIO_PUNTO', 'ACTUALIZAR_DATOS_PAGO_COMISION',
  ] },
  { value: 'cancelaciones', label: 'Cancelaciones y eliminaciones', acciones: [
    'ELIMINAR', 'ELIMINAR_USUARIO', 'ELIMINAR_AVATAR', 'ELIMINAR_PASAJERO', 'CANCELAR_RESERVA', 'ELIMINAR_RESERVA',
    'ELIMINAR_COMPROBANTE_RESERVA', 'CANCELAR_TRANSFER', 'ELIMINAR_TRANSFER',
    'ELIMINAR_TOUR', 'DESACTIVAR_TOUR', 'ELIMINAR_PUNTO', 'DESACTIVAR_PUNTO',
    'ELIMINAR_HORARIO_PUNTO', 'RETIRAR_AFORO_TOUR', 'DESASOCIAR',
  ] },
  { value: 'accesos', label: 'Accesos y sesiones', acciones: [
    'LOGIN', 'LOGOUT', 'LOGOUT_ALL_SESSIONS', 'FORCE_LOGOUT_USER',
    'PASSWORD_RESET_REQUEST', 'PASSWORD_CHANGED_BY_RESET',
  ] },
  { value: 'operacion', label: 'Asignaciones y operación', acciones: [
    'REORDENAR_RUTA', 'CAMBIAR_AFORO_TOUR', 'GUARDAR_LISTADO', 'GUARDAR_PROGRAMACION_PRIVADA',
    'ACTUALIZAR_ASIGNACION_SEGUROS', 'PAGAR_COMISIONES', 'REABRIR_COMISIONES', 'ASOCIAR',
    'ACTUALIZAR_ASISTENCIA', 'ACTUALIZAR_TURNOS_SEMANA', 'COPIAR_TURNOS_SEMANA_ANTERIOR',
    'PUBLICAR_TURNOS_SEMANA',
  ] },
  { value: 'validaciones', label: 'Validaciones y aprobaciones', acciones: [
    'VALIDAR', 'ACEPTAR_INTERCAMBIO_TURNO', 'RECHAZAR_INTERCAMBIO_TURNO',
  ] },
  { value: 'otros', label: 'Otros', acciones: [
    'EXPORTAR_EXCEL_LISTADO', 'EXPORTAR_EXCEL_LISTADO_GENERAL', 'EXPORTAR_EXCEL_PRIVADO', 'CREAR_O_ACTUALIZAR',
  ] },
].map((tipo) => Object.freeze({ ...tipo, acciones: Object.freeze(tipo.acciones) })));

const ACCIONES_CONOCIDAS = Object.freeze([...new Set(TIPOS_ACTIVIDAD.flatMap((tipo) => tipo.acciones))]);
const ACTIVIDAD_POR_ACCION = new Map(TIPOS_ACTIVIDAD.flatMap((tipo) => tipo.acciones.map((accion) => [accion, tipo.value])));
function tipoActividadDeAccion(accion) { return ACTIVIDAD_POR_ACCION.get(String(accion || '').trim().toUpperCase()) || 'otros'; }

const ETIQUETAS_ACCION = Object.freeze({
  AGREGAR_PASAJERO: 'Pasajero agregado', ACTUALIZAR_PASAJERO: 'Pasajero actualizado',
  ELIMINAR_PASAJERO: 'Pasajero eliminado',
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

module.exports = { MODULOS_HISTORIAL, ACCIONES_CONOCIDAS, TIPOS_ACTIVIDAD, tipoActividadDeAccion, etiquetaAccion, moduloDeTabla };
