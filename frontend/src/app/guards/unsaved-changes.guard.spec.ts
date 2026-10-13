import { SirAlertService } from '../services/Alertas/alert.service';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { confirmLeavingUnsavedChanges, UnsavedChangesService, unsavedChangesGuard } from './unsaved-changes.guard';

describe('confirmLeavingUnsavedChanges', () => {
  it('permite salir sin diálogo cuando no hay cambios pendientes', () => {
    const alerts = jasmine.createSpyObj<SirAlertService>('alerts', ['confirmDecision']);
    expect(confirmLeavingUnsavedChanges({ hasUnsavedChanges: () => false }, alerts)).toBeTrue();
    expect(alerts.confirmDecision).not.toHaveBeenCalled();
  });

  it('respeta la decisión existente antes de recargar con cambios pendientes', async () => {
    const alerts = jasmine.createSpyObj<SirAlertService>('alerts', ['confirmDecision']);
    alerts.confirmDecision.and.resolveTo(false);
    expect(await confirmLeavingUnsavedChanges({ hasUnsavedChanges: () => true }, alerts)).toBeFalse();
    expect(alerts.confirmDecision).toHaveBeenCalledWith(
      'Cambios sin guardar',
      'Tienes cambios sin guardar. Si sales ahora perderás esos cambios.',
      jasmine.objectContaining({ confirmText: 'Abandonar cambios' }),
    );
  });

  it('no pregunta por logout cuando el formulario está limpio', async () => {
    const alerts = jasmine.createSpyObj<SirAlertService>('alerts', ['confirmDecision']);
    const coordinator = new UnsavedChangesService(alerts);
    coordinator.activate({ hasUnsavedChanges: () => false });
    expect(await coordinator.confirmLogout()).toBeTrue();
    expect(alerts.confirmDecision).not.toHaveBeenCalled();
  });

  it('pregunta por logout antes de aceptar o descartar cambios', async () => {
    const alerts = jasmine.createSpyObj<SirAlertService>('alerts', ['confirmDecision']);
    const coordinator = new UnsavedChangesService(alerts);
    const draft = { hasUnsavedChanges: () => true };
    coordinator.activate(draft);
    alerts.confirmDecision.and.resolveTo(false);
    expect(await coordinator.confirmLogout()).toBeFalse();
    expect(alerts.confirmDecision).toHaveBeenCalledWith(
      '¿Cerrar sesión?',
      'Tienes cambios sin guardar. Si cierras sesión, estos cambios se perderán.',
      jasmine.objectContaining({ confirmText: 'Cerrar sesión', cancelText: 'Seguir editando' }),
    );
    expect(coordinator.isApprovedLogoutNavigation('/')).toBeFalse();
    coordinator.deactivate(draft);
    expect(await coordinator.confirmLogout()).toBeTrue();
  });

  it('omite una segunda confirmación solo para la navegación aprobada al login', async () => {
    const alerts = jasmine.createSpyObj<SirAlertService>('alerts', ['confirmDecision']);
    alerts.confirmDecision.and.resolveTo(true);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SirAlertService, useValue: alerts }],
    });
    const coordinator = TestBed.inject(UnsavedChangesService);
    coordinator.approveLogoutNavigation();
    const component = { hasUnsavedChanges: () => true };
    const evaluate = (url: string) => TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(component, {} as any, {} as any, { url } as any));
    expect(evaluate('/')).toBeTrue();
    expect(alerts.confirmDecision).not.toHaveBeenCalled();
    expect(await evaluate('/Usuarios')).toBeTrue();
    expect(alerts.confirmDecision).toHaveBeenCalledTimes(1);
    coordinator.clearLogoutApproval();
    expect(await evaluate('/')).toBeTrue();
    expect(alerts.confirmDecision).toHaveBeenCalledTimes(2);
  });
});
