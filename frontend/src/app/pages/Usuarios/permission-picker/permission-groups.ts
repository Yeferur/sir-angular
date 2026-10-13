import { PermisoCompleto } from '../../../services/Permisos/permisos.service';
import type { PermissionGroup } from './permission-picker';

const MODULE_ORDER = [
  'INICIO', 'RESERVAS', 'MERCADEO', 'TRANSFERS', 'TOURS', 'PUNTOS DE ENCUENTRO',
  'PROGRAMACION', 'CONTROL DE VIAJE', 'PAGOS', 'COMISIONES', 'HISTORIAL',
  'INFORMES', 'MENSAJERIA', 'SEGUROS', 'USUARIOS', 'ROLES Y PERMISOS',
  'CONFIGURACION', 'GENERAL',
];
const ACTION_ORDER: Record<string, number> = {
  LEER: 10, CREAR: 20, ACTUALIZAR: 30, ACTUALIZAR_AFORO: 35,
  ACTUALIZAR_ASISTENCIA: 36, ENVIAR: 40, CONFIGURAR: 45,
  EXPORTAR: 50, ORDENAR: 55, ELIMINAR: 90,
};

function token(value: unknown): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ').trim().toUpperCase();
}

export function formatModuleName(value: string): string {
  return String(value || 'General').replace(/[_-]+/g, ' ')
    .toLocaleLowerCase('es-CO')
    .replace(/(^|\s)\p{L}/gu, letter => letter.toLocaleUpperCase('es-CO'));
}

export function groupPermissions(permissions: PermisoCompleto[]): PermissionGroup[] {
  const groups = new Map<string, PermisoCompleto[]>();
  for (const permission of permissions) {
    const key = permission.Codigo_Modulo
      || String(permission.Codigo_Permiso || '').split('.')[0] || 'GENERAL';
    groups.set(key, [...(groups.get(key) || []), permission]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      const leftToken = token(left);
      const rightToken = token(right);
      const leftRank = MODULE_ORDER.indexOf(leftToken);
      const rightRank = MODULE_ORDER.indexOf(rightToken);
      return (leftRank < 0 ? MODULE_ORDER.length : leftRank)
        - (rightRank < 0 ? MODULE_ORDER.length : rightRank)
        || leftToken.localeCompare(rightToken, 'es-CO');
    })
    .map(([key, items]) => ({
      key,
      label: formatModuleName(key),
      permisos: [...items].sort((left, right) => {
        const leftAction = token(left.Accion || String(left.Codigo_Permiso || '').split('.').pop()).replace(/ /g, '_');
        const rightAction = token(right.Accion || String(right.Codigo_Permiso || '').split('.').pop()).replace(/ /g, '_');
        return (ACTION_ORDER[leftAction] ?? 70) - (ACTION_ORDER[rightAction] ?? 70)
          || String(left.Descripcion || left.Codigo_Permiso || '').localeCompare(
            String(right.Descripcion || right.Codigo_Permiso || ''), 'es-CO');
      }),
    }));
}
