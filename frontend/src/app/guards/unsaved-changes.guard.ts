import { CanDeactivateFn } from '@angular/router';

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

  return window.confirm('Tienes cambios sin guardar. Si sales ahora perderas esos cambios.');
};
