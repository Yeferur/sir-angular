import { TestBed } from '@angular/core/testing';

import { SirAlertService } from '../../services/Alertas/alert.service';
import { TimepickerComponent } from '../../shared/timepicker/timepicker';
import { SirAlertsHostComponent } from './alerts-host';

describe('SirAlertsHostComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SirAlertsHostComponent] }).compileComponents();
  });

  it('presenta hasta tres avisos operativos en el stack superior', () => {
    const fixture = TestBed.createComponent(SirAlertsHostComponent);
    const alerts = TestBed.inject(SirAlertService);
    fixture.detectChanges();

    const first = alerts.notify({ type: 'warning', title: 'Primero', operational: true, priority: 2, durationMs: 10_000 });
    alerts.notify({ type: 'warning', title: 'Segundo', operational: true, priority: 1, durationMs: 10_000 });
    alerts.notify({ type: 'warning', title: 'Tercero', operational: true, priority: 0, durationMs: 10_000 });
    alerts.notify({ type: 'warning', title: 'En espera', operational: true, priority: 0, durationMs: 10_000 });
    fixture.detectChanges();
    fixture.detectChanges();

    expect(fixture.componentInstance.operationalToasts.length).toBe(3);
    expect(fixture.nativeElement.querySelectorAll('.sir-toast--operational').length).toBe(3);
    expect(alerts.toasts().length).toBe(4);
    expect(fixture.componentInstance.operationalToasts[0].id).toBe(first);
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
