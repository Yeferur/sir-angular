import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { PendientesComponent } from './pendientes';
import { PendientesService } from '../../services/Pendientes/pendientes.service';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { WebSocketService } from '../../services/WebSocket/web-socket';

describe('Pendientes: sincronización de Programación', () => {
  it('actualiza la lista sin borrar el formulario abierto y respeta los permisos existentes', async () => {
    const events = new Subject<any>();
    let allowed = true;
    const list = jasmine.createSpy('listPending').and.returnValue(of({ pendientes: [], total: 0 }));
    await TestBed.configureTestingModule({
      imports: [PendientesComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]),
        { provide: PendientesService, useValue: { listPending: list, listReminders: () => of({ recordatorios: [], total: 0 }) } },
        { provide: PermisosService, useValue: { tienePermiso: (p: string) => p === 'PENDIENTES.LEER' ? allowed : true } },
        { provide: WebSocketService, useValue: { events$: events.asObservable() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PendientesComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    c.reminderForm = { titulo: 'Texto sin guardar', fecha: '2099-10-15T12:00' };
    c.showReminderForm.set(true);
    const item = { idPendiente: '10', titulo: 'Guatapé', prioridad: 'ALTA' };
    list.and.returnValue(of({ pendientes: [item], total: 1 }));
    events.next({ type: 'programacionNovedadesActualizadas' });
    expect(c.pending()[0].idPendiente).toBe('10');
    list.and.returnValue(of({ pendientes: [], total: 0 }));
    events.next({ type: 'programacionNovedadesActualizadas' });
    expect(c.pending()).toEqual([]);
    expect(c.showReminderForm()).toBeTrue();
    expect(c.reminderForm.titulo).toBe('Texto sin guardar');
    list.calls.reset(); allowed = false;
    events.next({ type: 'programacionNovedadesActualizadas' });
    expect(list).not.toHaveBeenCalled();
    fixture.destroy();
    allowed = true; events.next({ type: 'programacionNovedadesActualizadas' });
    expect(list).not.toHaveBeenCalled();
  });
});
