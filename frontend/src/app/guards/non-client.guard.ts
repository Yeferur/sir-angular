import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PermisosService } from '../services/Permisos/permisos.service';

export const nonClientGuard: CanActivateFn = async () => {
  const permissions = inject(PermisosService);
  const router = inject(Router);
  await permissions.asegurarPermisosCargados();
  return permissions.esCliente() ? router.parseUrl('/') : true;
};
