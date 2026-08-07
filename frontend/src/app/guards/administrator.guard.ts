import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PermisosService } from '../services/Permisos/permisos.service';

export const administratorGuard: CanActivateFn = async () => {
  const permissions = inject(PermisosService);
  const router = inject(Router);
  await permissions.asegurarPermisosCargados();
  const role = String(permissions.getRoleSnapshot() || '').trim().toLocaleLowerCase('es-CO');
  return role === 'administrador' ? true : router.parseUrl('/');
};
