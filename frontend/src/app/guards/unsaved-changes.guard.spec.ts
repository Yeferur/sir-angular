import { SirAlertService } from '../services/Alertas/alert.service';
import { confirmLeavingUnsavedChanges } from './unsaved-changes.guard';

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
});
