import { TestBed } from '@angular/core/testing';

import { SirAlertService } from '../../services/Alertas/alert.service';
import { TimepickerComponent } from '../../shared/timepicker/timepicker';
import { SirAlertsHostComponent } from './alerts-host';

describe('SirAlertsHostComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SirAlertsHostComponent] }).compileComponents();
  });

  it('presenta un solo aviso operativo y deja el siguiente esperando en la cola', () => {
    const fixture = TestBed.createComponent(SirAlertsHostComponent);
    const alerts = TestBed.inject(SirAlertService);
    fixture.detectChanges();

    const first = alerts.notify({ type: 'warning', title: 'Primero', operational: true, priority: 2, durationMs: 10_000 });
    alerts.notify({ type: 'warning', title: 'Segundo', operational: true, priority: 1, durationMs: 10_000 });
    fixture.detectChanges();
    fixture.detectChanges();

    expect(fixture.componentInstance.operationalToasts.length).toBe(1);
    expect(fixture.componentInstance.operationalToasts[0].id).toBe(first);

    (fixture.componentInstance as any).removeToast(first);
    fixture.detectChanges();
    expect(fixture.componentInstance.operationalToasts.length).toBe(0);
    expect((fixture.componentInstance as any).operationalMountTimer).toBeDefined();
    fixture.destroy();
  });

  it('abre Recordar más tarde con el selector de minutos libres', () => {
    const fixture = TestBed.createComponent(SirAlertsHostComponent);
    const alerts = TestBed.inject(SirAlertService);
    fixture.detectChanges();

    alerts.notify({
      type: 'info', title: 'Recordatorio', operational: true, durationMs: 10_000,
      actions: [{ label: 'Recordar más tarde', postpone: { onConfirm: () => true } }],
    });
    fixture.detectChanges();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.sir-toast-action') as HTMLButtonElement).click();
    fixture.detectChanges();

    const timepicker = fixture.debugElement.query(element => element.componentInstance instanceof TimepickerComponent);
    expect(timepicker).toBeTruthy();
    expect(timepicker.componentInstance.mode).toBe('free');
    expect(fixture.nativeElement.querySelector('.sir-toast-popover')).toBeTruthy();
    fixture.destroy();
  });
});
