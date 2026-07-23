import { CanDeactivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { SirAlertService } from '../services/Alertas/alert.service';

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

  const alertService = inject(SirAlertService);

  return alertService.confirmDecision(
    'Cambios sin guardar',
    'Tienes cambios sin guardar. Si sales ahora perderás esos cambios.',
    {
      type: 'warning',
      confirmText: 'Abandonar cambios',
      cancelText: 'Continuar editando',
      destructive: true,
    }
  );
};
