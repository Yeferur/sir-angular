import { CanDeactivateFn } from '@angular/router';
import { Injectable, inject } from '@angular/core';
import { SirAlertService } from '../services/Alertas/alert.service';

export interface HasUnsavedChanges {
  hasUnsavedChanges: () => boolean;
}

export function confirmLeavingUnsavedChanges(
  component: Partial<HasUnsavedChanges> | null | undefined,
  alertService: SirAlertService,
  reason: 'navigation' | 'logout' = 'navigation',
): boolean | Promise<boolean> {
  if (!component || typeof component.hasUnsavedChanges !== 'function') {
    return true;
  }

  if (!component.hasUnsavedChanges()) {
    return true;
  }

  if (reason === 'logout') {
    return alertService.confirmDecision(
      '¿Cerrar sesión?',
      'Tienes cambios sin guardar. Si cierras sesión, estos cambios se perderán.',
      {
        type: 'warning',
        confirmText: 'Cerrar sesión',
        cancelText: 'Seguir editando',
        destructive: true,
      },
    );
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

@Injectable({ providedIn: 'root' })
export class UnsavedChangesService {
  private activeComponent: Partial<HasUnsavedChanges> | null = null;
  private logoutApproved = false;

  constructor(private alerts: SirAlertService) {}

  activate(component: unknown): void {
    this.activeComponent = component as Partial<HasUnsavedChanges>;
  }

  deactivate(component: unknown): void {
    if (this.activeComponent === component) this.activeComponent = null;
  }

  async confirmLogout(): Promise<boolean> {
    return confirmLeavingUnsavedChanges(this.activeComponent, this.alerts, 'logout');
  }

  approveLogoutNavigation(): void {
    this.logoutApproved = true;
  }

  isApprovedLogoutNavigation(url: string | undefined): boolean {
    return this.logoutApproved && url === '/';
  }

  clearLogoutApproval(): void {
    this.logoutApproved = false;
  }
}

export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component, _route, _state, nextState) => {
  if (inject(UnsavedChangesService).isApprovedLogoutNavigation(nextState?.url)) return true;
  return confirmLeavingUnsavedChanges(component, inject(SirAlertService));
};
