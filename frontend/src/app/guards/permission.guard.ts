import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { PermisosService } from '../services/Permisos/permisos.service';
import { SirAlertService } from '../services/Alertas/alert.service';

export const permisoGuard: CanActivateFn = async (route: ActivatedRouteSnapshot, _state: RouterStateSnapshot) => {
  const permisosService = inject(PermisosService);
  const router = inject(Router);
  const alerts = inject(SirAlertService);

  const singlePermission = String(route.data?.['permiso'] || '').trim();
  const multiplePermissions = Array.isArray(route.data?.['permisos'])
    ? route.data['permisos'].map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const requiredPermissions = multiplePermissions.length
    ? multiplePermissions
    : (singlePermission ? [singlePermission] : []);
  if (!requiredPermissions.length) {
    return true;
  }

  const permisosDisponibles = await permisosService.asegurarPermisosCargados();

  const requireAll = Boolean(route.data?.['requireAll']);
  const authorized = requireAll
    ? permisosService.tieneTodosPermisos(requiredPermissions)
    : permisosService.tieneAlgunPermiso(requiredPermissions);

  if (permisosDisponibles && authorized) {
    return true;
  }

  alerts.errorToast(
    'Acceso denegado',
    'No tienes permiso para acceder a esta sección.',
  );
  const redirectTo = String(route.data?.['redirectTo'] || '/').trim() || '/';
  return router.parseUrl(redirectTo);
};
