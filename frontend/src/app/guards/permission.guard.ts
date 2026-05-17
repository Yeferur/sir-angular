import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { PermisosService } from '../services/Permisos/permisos.service';

export const permisoGuard: CanActivateFn = async (route: ActivatedRouteSnapshot, _state: RouterStateSnapshot) => {
  const permisosService = inject(PermisosService);
  const router = inject(Router);

  const requiredPermission = String(route.data?.['permiso'] || '').trim();
  if (!requiredPermission) {
    return true;
  }

  const permisosDisponibles = await permisosService.asegurarPermisosCargados();

  if (permisosDisponibles && permisosService.tienePermiso(requiredPermission)) {
    return true;
  }

  const redirectTo = String(route.data?.['redirectTo'] || '/').trim() || '/';
  return router.parseUrl(redirectTo);
};
