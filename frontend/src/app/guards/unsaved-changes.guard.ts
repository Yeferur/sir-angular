import { CanDeactivateFn, Router } from '@angular/router';
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

  // 🔥 USAR SISTEMA CENTRALIZADO DE ALERTAS EN LUGAR DE window.confirm()
  const alertService = inject(SirAlertService);
  
  return new Promise<boolean>((resolve) => {
    // Map confirm service signature: (title, message, onConfirm, onCancel, opts)
    alertService.confirm(
      'Cambios sin guardar',
      'Tienes cambios sin guardar. Si sales ahora perderás esos cambios.',
      // onConfirm -> primary button: "Continuar editando" -> do NOT navigate (false)
      () => {
        alertService.closeModal();
        resolve(false);
      },
      // onCancel -> secondary button: "Abandonar" -> allow navigation (true)
      () => {
        alertService.closeModal();
        resolve(true);
      },
      { type: 'warning', confirmText: 'Continuar editando', cancelText: 'Abandonar' }
    );
  });
};
