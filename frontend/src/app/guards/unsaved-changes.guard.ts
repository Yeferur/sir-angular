import { CanDeactivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { SirAlertService } from '../services/Alertas/alert.service';

export interface HasUnsavedChanges {
  hasUnsavedChanges: () => boolean;
}

export function confirmLeavingUnsavedChanges(
  component: Partial<HasUnsavedChanges> | null | undefined,
  alertService: SirAlertService,
): boolean | Promise<boolean> {
  if (!component || typeof component.hasUnsavedChanges !== 'function') {
    return true;
  }

  if (!component.hasUnsavedChanges()) {
    return true;
  }

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
}

export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  return confirmLeavingUnsavedChanges(component, inject(SirAlertService));
};
