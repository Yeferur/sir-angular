import { CanDeactivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { DynamicIslandGlobalService } from '../services/DynamicNavbar/global';

export interface HasUnsavedChanges {
  hasUnsavedChanges: () => boolean;
}

export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component || typeof component.hasUnsavedChanges !== 'function') {
    return true;
  }

  if (!component.hasUnsavedChanges()) {
    return true;
  }

  // 🔥 USAR SISTEMA CENTRALIZADO DE ALERTAS EN LUGAR DE window.confirm()
  const navbar = inject(DynamicIslandGlobalService);
  
  return new Promise<boolean>((resolve) => {
    navbar.alert.set({
      type: 'warning',
      title: 'Cambios sin guardar',
      message: 'Tienes cambios sin guardar. Si sales ahora perderás esos cambios.',
      autoClose: false,
      buttons: [
        {
          text: 'Abandonar',
          style: 'secondary',
          onClick: () => {
            navbar.alert.set(null);
            resolve(true); // Permitir salir
          }
        },
        {
          text: 'Continuar editando',
          style: 'primary',
          onClick: () => {
            navbar.alert.set(null);
            resolve(false); // Bloquear salida
          }
        }
      ]
    });
  });
};
