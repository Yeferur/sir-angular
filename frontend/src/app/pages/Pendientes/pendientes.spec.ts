import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SirSelectComponent } from '../../shared/select/select';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { PendientesComponent } from './pendientes';
import { PendientesService } from '../../services/Pendientes/pendientes.service';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { WebSocketService } from '../../services/WebSocket/web-socket';
import { NotificacionesService } from '../../services/Notificaciones/notificaciones.service';

describe('Pendientes: sincronización de Programación', () => {
  it('actualiza la lista sin borrar el formulario abierto y respeta los permisos existentes', async () => {
    const events = new Subject<any>();
    let allowed = true;
    const list = jasmine.createSpy('listPending').and.returnValue(of({ pendientes: [], total: 0 }));
    await TestBed.configureTestingModule({
      imports: [PendientesComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]),
        { provide: PendientesService, useValue: { listPending: list, listReminders: () => of({ recordatorios: [], total: 0 }) } },
        { provide: PermisosService, useValue: {
          tienePermiso: (p: string) => p === 'PENDIENTES.LEER' ? allowed : true,
          esCliente: () => false,
        } },
        { provide: NotificacionesService, useValue: {
          load: () => {}, markRead: () => {}, markAllRead: () => {},
          items: signal([]), noLeidas: signal(0),
        } },
        { provide: WebSocketService, useValue: { events$: events.asObservable() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PendientesComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    c.reminderForm = { titulo: 'Texto sin guardar', fecha: '2099-10-15T12:00' };
    c.showReminderForm.set(true);
    const item = { idPendiente: '10', titulo: 'Guatapé', prioridad: 'ALTA', entidadTipo: 'RESERVA', entidadId: 'R-10', datos: {} };
    list.and.returnValue(of({ pendientes: [item], total: 1 }));
    events.next({ type: 'programacionNovedadesActualizadas' });
    expect(c.pending()[0].idPendiente).toBe('10');
    c.activeTab.set('pendientes'); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const priority = fixture.debugElement.query(By.directive(SirSelectComponent)).componentInstance as SirSelectComponent;
    priority.choose(2); fixture.detectChanges();
    expect(c.priorityFilter()).toBe('ALTA');
    expect(c.visiblePending().length).toBe(1);
    list.and.returnValue(of({ pendientes: [], total: 0 }));
    events.next({ type: 'programacionNovedadesActualizadas' });
    expect(c.pending()).toEqual([]);
    expect(c.priorityFilter()).toBe('ALTA');
    expect(c.showReminderForm()).toBeTrue();
    expect(c.reminderForm.titulo).toBe('Texto sin guardar');
    c.postponeUntil = '2099-10-15T12:00';
    c.updatePostponeTime('15:17');
    expect(c.postponeUntil).toBe('2099-10-15T15:17');
    list.calls.reset(); allowed = false;
    events.next({ type: 'programacionNovedadesActualizadas' });
    expect(list).not.toHaveBeenCalled();
    fixture.destroy();
  });
});
