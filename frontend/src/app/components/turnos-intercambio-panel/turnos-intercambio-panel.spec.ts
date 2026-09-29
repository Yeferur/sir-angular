import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { TurnosIntercambioPanelComponent } from './turnos-intercambio-panel';
import { SirSelectComponent } from '../../shared/select/select';
import { SirDrawerService } from '../../services/Drawer/drawer.service';
import { TurnosService } from '../../services/Turnos/turnos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';

describe('Intercambiar turno: select compartido y solicitud existente', () => {
  let fixture: any;
  let c: TurnosIntercambioPanelComponent;
  let select: SirSelectComponent;
  let response: Subject<any>;
  let request: jasmine.Spy;
  let close: jasmine.Spy;
  let alerts: any;
  const day = { fecha: '2099-10-15', nombreDia: 'Jueves', horaInicio: '08:00', horaFin: '17:00' };
  const candidates = [
    { idUsuario: '007', nombre: 'Ana', horaInicio: '09:00', horaFin: '18:00' },
    { idUsuario: '20', nombre: 'Luis', horaInicio: '10:30', horaFin: '19:30' },
  ];
  const render = () => { fixture.changeDetectorRef.markForCheck(); fixture.detectChanges(); };
  const sendButton = () => fixture.nativeElement.querySelector('footer .primary') as HTMLButtonElement;

  beforeEach(async () => {
    response = new Subject(); request = jasmine.createSpy('solicitarIntercambio').and.returnValue(response);
    close = jasmine.createSpy('close');
    alerts = { successToast: jasmine.createSpy('successToast'), errorToast: jasmine.createSpy('errorToast') };
    await TestBed.configureTestingModule({
      imports: [TurnosIntercambioPanelComponent],
      providers: [provideZonelessChangeDetection(),
        { provide: SirDrawerService, useValue: { drawer: signal({ props: { day, candidates } }), close } },
        { provide: TurnosService, useValue: { solicitarIntercambio: request } },
        { provide: SirAlertService, useValue: alerts },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TurnosIntercambioPanelComponent);
    c = fixture.componentInstance; render(); await fixture.whenStable(); render();
    select = fixture.debugElement.query(By.directive(SirSelectComponent)).componentInstance;
  });

  it('mantiene etiqueta, opción vacía seleccionable, nombres y horarios', () => {
    const trigger = fixture.nativeElement.querySelector('#turnos-intercambio-companero') as HTMLButtonElement;
    expect(trigger.labels?.[0].textContent).toContain('Compañero del mismo canal');
    expect(select.selectedOption?.label).toBe('Selecciona un asesor');
    expect(select.options.map(o => o.label)).toEqual([
      'Selecciona un asesor', 'Ana · 9:00 a. m.–6:00 p. m.', 'Luis · 10:30 a. m.–7:30 p. m.',
    ]);
    expect(select.effectivelyDisabled).toBeFalse(); expect(sendButton().disabled).toBeTrue();
    select.choose(1); render(); expect(c.selected).toBe('007'); expect(sendButton().disabled).toBeFalse();
    select.choose(0); render(); expect(c.selected).toBe(''); expect(sendButton().disabled).toBeTrue();
    c.submit(); expect(request).not.toHaveBeenCalled();
  });

  it('envía la fecha, ID string con ceros iniciales y motivo sin alterar el flujo', () => {
    select.choose(1); render(); c.reason = 'Necesito cambiar mi jornada';
    expect(request).not.toHaveBeenCalled(); sendButton().click(); render();
    expect(request).toHaveBeenCalledOnceWith('2099-10-15', '007', 'Necesito cambiar mi jornada');
    expect(c.sending()).toBeTrue(); expect(sendButton().disabled).toBeTrue();
    // El select original permanece habilitado durante el envío.
    expect(select.effectivelyDisabled).toBeFalse();
    response.next({ idIntercambio: 'I-1', estado: 'pendiente' }); render();
    expect(c.sending()).toBeFalse(); expect(close).toHaveBeenCalledTimes(1);
    expect(alerts.successToast).toHaveBeenCalled();
  });

  it('conserva selección/motivo y permite reintentar tras el error existente', () => {
    select.choose(2); render(); c.reason = 'Motivo'; c.submit();
    response.error({ error: { message: 'No disponible' } }); render();
    expect(c.selected).toBe('20'); expect(c.reason).toBe('Motivo'); expect(c.sending()).toBeFalse();
    expect(sendButton().disabled).toBeFalse(); expect(close).not.toHaveBeenCalled();
    expect(alerts.errorToast).toHaveBeenCalledWith('No se pudo enviar', 'No disponible');
  });

  it('actualiza candidatos sin convertir ni reiniciar el valor precargado', async () => {
    c.selected = '007'; render(); await fixture.whenStable(); render();
    expect(select.selectedOption?.label).toContain('Ana');
    const options = select.options; c.reason = 'Texto'; render(); expect(select.options).toBe(options);
    c.candidates.set([{ ...candidates[0], nombre: 'Ana actualizada' }]); render();
    expect(c.selected).toBe('007'); expect(select.selectedOption?.label).toContain('Ana actualizada');
    c.candidates.set([]); render(); expect(select.options.length).toBe(1); expect(c.selected).toBe('007');
    expect(fixture.nativeElement.textContent).toContain('No hay jornadas diferentes disponibles');
    c.selected = ''; render(); await fixture.whenStable(); render();
    expect(select.selectedOption?.label).toBe('Selecciona un asesor');
  });

  it('mantiene selección por teclado y Escape cierra solo el dropdown del drawer', () => {
    const trigger = fixture.nativeElement.querySelector('#turnos-intercambio-companero') as HTMLButtonElement;
    const key = (key: string) => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); render(); };
    key('Enter'); key('End'); expect(select.activeIndex).toBe(2);
    key('Home'); expect(select.activeIndex).toBe(0);
    key('ArrowDown'); key(' '); expect(c.selected).toBe('007');
    key('Enter'); key('ArrowDown'); key('Escape');
    expect(c.selected).toBe('007'); expect(select.isOpen).toBeFalse(); expect(close).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
