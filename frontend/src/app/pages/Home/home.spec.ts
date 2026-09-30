import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { HomeComponent } from './home';
import { HomeService, HomeSummary } from '../../services/Home/home.service';
import { WebSocketService } from '../../services/WebSocket/web-socket';
import { TurnosService } from '../../services/Turnos/turnos.service';
import { MiActividadFacade } from '../../services/MiActividad/mi-actividad.facade';
import { DesktopNotificationsService } from '../../services/Notificaciones/desktop-notifications.service';

describe('Home por perfil y datos disponibles', () => {
  let fixture: ComponentFixture<HomeComponent>;
  let summary: HomeSummary;
  let activity: any;
  let desktop: any;

  function baseSummary(): HomeSummary {
    const emptyDay = (date: string) => ({ date, reservations: 0, passengers: 0,
      privateReservations: 0, privatePassengers: 0, transfers: 0, transferPassengers: 0 });
    return {
      generatedAt: '2026-09-29T12:00:00Z',
      dates: { today: '2026-09-29', tomorrow: '2026-09-30' },
      profile: { id: 7, name: 'Ana Operadora', avatar: null, role: 'Operadora', mode: 'management' },
      capabilities: {
        management: true, operations: true, clientMode: false,
        canCreateReservations: true, canReadReservations: true, canUpdateReservations: true,
        canCreateTransfers: true, canReadTransfers: true, canUpdateTransfers: true,
        canReadAforos: true, canReadReports: true, canReadProgramming: true,
      },
      overview: { today: emptyDay('2026-09-29'), tomorrow: emptyDay('2026-09-30') },
      personalWork: { upcomingReservations: [], upcomingTransfers: [], pendingReservations: 0, recentActivity: [] },
      operations: { processes: [], capacityAlerts: [], recentActivity: [] },
    };
  }

  async function render(): Promise<HTMLElement> {
    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    summary = baseSummary();
    activity = {
      start: jasmine.createSpy('start'),
      pendientesAtendibles: signal<any[]>([]), recordatoriosVencidos: signal<any[]>([]),
      feedNotifications: signal<any[]>([]), attentionCount: signal(0),
      nextReminder: signal<any>(null), loading: signal(false), loaded: signal(true), error: signal(''),
      open: jasmine.createSpy('open'), refresh: jasmine.createSpy('refresh'),
    };
    desktop = {
      onboardingEligible: signal(false),
      dismissOnboarding: jasmine.createSpy('dismissOnboarding').and.callFake(() => desktop.onboardingEligible.set(false)),
      toggle: jasmine.createSpy('toggle').and.callFake(async () => {
        desktop.onboardingEligible.set(false);
        return 'enabled';
      }),
    };
    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        { provide: HomeService, useValue: { getSummary: () => of(summary) } },
        { provide: WebSocketService, useValue: { events$: new Subject(), connectionState$: of('connected') } },
        { provide: TurnosService, useValue: { obtenerMiJornada: () => of({ jornada: null }) } },
        { provide: MiActividadFacade, useValue: activity },
        { provide: DesktopNotificationsService, useValue: desktop },
        { provide: Router, useValue: { navigateByUrl: jasmine.createSpy('navigateByUrl') } },
      ],
    }).compileComponents();
  });

  it('management sin datos no reserva superficies para Avisos, procesos, aforos o actividad', async () => {
    const page = await render();
    expect(page.querySelector('.welcome-card')).toBeTruthy();
    expect(page.querySelectorAll('.day-card').length).toBe(2);
    expect(page.querySelector('.notice-summary-card')).toBeNull();
    expect(page.querySelector('.process-grid')).toBeNull();
    expect(page.querySelector('.detail-grid')).toBeNull();
    expect(page.textContent).not.toContain('Aforos bajo control');
    expect(page.textContent).not.toContain('Abrir informes');
  });

  it('explica un único pendiente de Comisiones aunque exista su proceso operativo', async () => {
    summary.operations.processes = [
      { id: 'commissions', label: 'Comisiones', count: 77, description: '', route: '/Comisiones', permission: 'COMISIONES.LEER' },
    ];
    activity.pendientesAtendibles.set([
      { regla: 'COMISIONES_PENDIENTES', idPendiente: 'comisiones', titulo: '77 reservas con comisiones pendientes', prioridad: 'ALTA' },
    ]);
    activity.attentionCount.set(1);
    const page = await render();
    expect(page.querySelector('.notice-count')?.textContent).toContain('1');
    expect(page.querySelectorAll('.notice-preview-item').length).toBe(1);
    expect(page.querySelector('.notice-preview-item')?.textContent).toContain('77 reservas con comisiones pendientes');
    page.querySelector<HTMLButtonElement>('.notice-preview-item')!.click();
    expect(activity.open).toHaveBeenCalledWith('pendientes', 'comisiones');
  });

  it('muestra dos situaciones de Programación y Reserva y limita tres o más a dos', async () => {
    activity.pendientesAtendibles.set([
      { regla: 'PROGRAMACION_NO_ACTIVA', idPendiente: 'programacion', titulo: 'Revisar programación', prioridad: 'ALTA' },
      { regla: 'RESERVA_CAMBIO', idPendiente: 'reserva', titulo: 'Revisar reserva', prioridad: 'MEDIA' },
      { regla: 'COMISIONES_PENDIENTES', idPendiente: 'comisiones', titulo: 'Revisar comisiones', prioridad: 'BAJA' },
    ]);
    activity.attentionCount.set(3);
    const page = await render();
    const rows = Array.from(page.querySelectorAll('.notice-preview-item'));
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Revisar programación');
    expect(rows[1].textContent).toContain('Revisar reserva');
    expect(page.querySelector('.notice-count')?.textContent).toContain('3');
    activity.pendientesAtendibles.set(activity.pendientesAtendibles().slice(0, 2));
    activity.attentionCount.set(2);
    fixture.detectChanges();
    expect(page.querySelectorAll('.notice-preview-item').length).toBe(2);
  });

  it('explica un recordatorio vencido y no cuenta una novedad informativa', async () => {
    activity.recordatoriosVencidos.set([{ idRecordatorio: 'recordatorio', titulo: 'Llamar al cliente' }]);
    activity.attentionCount.set(1);
    let page = await render();
    expect(page.querySelector('.notice-preview-item')?.textContent).toContain('Llamar al cliente');
    page.querySelector<HTMLButtonElement>('.notice-preview-item')!.click();
    expect(activity.open).toHaveBeenCalledWith('recordatorios', 'recordatorio');

    fixture.destroy();
    activity.recordatoriosVencidos.set([]);
    activity.feedNotifications.set([{ tipo: 'APP_UPDATE', titulo: 'Novedad de SIR' }]);
    activity.attentionCount.set(0);
    page = await render();
    expect(page.querySelector('.notice-summary-card')).toBeNull();
  });

  it('muestra los avisos aunque también tengan acceso en Procesos y adapta aforos y actividad real', async () => {
    summary.operations.processes = [
      { id: 'programming', label: 'Programación', count: 2, description: '', route: '/Programacion/Listado', permission: 'PROGRAMACION.LEER' },
      { id: 'insurance', label: 'Seguros', count: 0, description: '', route: '/Seguros', permission: 'SEGUROS.LEER' },
    ];
    summary.operations.capacityAlerts = [{ tourId: 1, tourName: 'Tour', date: '2026-09-30',
      capacity: 10, occupied: 9, percentage: 90, status: 'critical' }];
    summary.operations.recentActivity = Array.from({ length: 7 }, (_, i) => ({
      Accion: 'ACTUALIZAR_ASISTENCIA', Tabla: 'reservas', Id_Registro: i + 1,
      Fecha_Hora_Registro: '2026-09-29T12:00:00Z', Usuario: 'Ana',
    }));
    activity.pendientesAtendibles.set([
      { regla: 'PROGRAMACION_NO_ACTIVA', idPendiente: '1', titulo: 'Ya indicado en proceso', prioridad: 'ALTA' },
      { regla: 'OTRA', idPendiente: '2', titulo: 'Revisar dato', prioridad: 'ALTA' },
    ]);
    activity.attentionCount.set(2);
    const page = await render();
    expect(page.querySelectorAll('.notice-preview-item').length).toBe(2);
    expect(page.querySelectorAll('.process-card').length).toBe(2);
    expect(page.querySelectorAll('.process-count').length).toBe(1);
    expect(page.querySelectorAll('.capacity-item').length).toBe(1);
    expect(page.querySelectorAll('.activity-item').length).toBe(5);
    expect(page.querySelector('#detail-title')?.textContent).toContain('actividad reciente');
    expect(page.querySelectorAll('.detail-grid .list-card')[1].firstElementChild?.className).toBe('activity-list');
    expect(page.querySelectorAll('.detail-grid .list-card')[1].querySelector('.card-header')).toBeNull();
    expect(page.querySelector('.home-section--last > .section-heading .text-action')?.textContent).toContain('Ver historial');
    expect(page.textContent).not.toContain('Abrir módulo');
  });

  it('advisor y client muestran únicamente sus secciones y accesos permitidos', async () => {
    summary.profile.mode = 'advisor';
    summary.capabilities.management = false;
    summary.capabilities.canReadReports = false;
    summary.capabilities.canReadAforos = false;
    summary.operations.processes = [{ id: 'programming', label: 'Programación', count: 0,
      description: '', route: '/Programacion/Listado', permission: 'PROGRAMACION.LEER' }];
    summary.personalWork.upcomingReservations = [{ Id_Reserva: 4, Fecha: '2026-09-30',
      Estado: 'Confirmada', Tipo_Reserva: 'Grupal', Nombre_Tour: 'Tour', Pasajeros: 2 }];
    summary.personalWork.recentActivity = [{ Accion: 'CREAR_RESERVA', Tabla: 'reservas',
      Id_Registro: 4, Fecha_Hora_Registro: '2026-09-29T12:00:00Z' }];
    let page = await render();
    expect(page.querySelector('.advisor-shift-section')).toBeTruthy();
    expect(page.querySelectorAll('.work-item').length).toBe(1);
    expect(page.querySelectorAll('.process-card').length).toBe(1);
    expect(page.querySelector('.capacity-item')).toBeNull();
    expect(page.textContent).not.toContain('Abrir informes');

    fixture.destroy();
    summary.profile.mode = 'client';
    summary.capabilities.clientMode = true;
    summary.capabilities.operations = false;
    summary.operations.processes = [];
    desktop.onboardingEligible.set(true);
    page = await render();
    expect(page.querySelector('.advisor-shift-section')).toBeNull();
    expect(page.querySelector('.desktop-invite')).toBeNull();
    expect(page.querySelector('.detail-grid')).toBeNull();
    expect(page.querySelector('.work-item')).toBeTruthy();
  });

  it('la sección de detalle ocupa todo el ancho cuando solo hay actividad o alertas', async () => {
    summary.operations.recentActivity = [{ Accion: 'ACTUALIZAR_ASISTENCIA', Tabla: 'reservas',
      Id_Registro: 1, Fecha_Hora_Registro: '2026-09-29T12:00:00Z' }];
    let page = await render();
    let grid = page.querySelector<HTMLElement>('.detail-grid')!;
    expect(grid.children.length).toBe(1);
    expect(grid.firstElementChild!.getBoundingClientRect().width)
      .toBeCloseTo(grid.getBoundingClientRect().width, 0);

    fixture.destroy();
    summary.operations.recentActivity = [];
    summary.operations.capacityAlerts = [{ tourId: 1, tourName: 'Tour', date: '2026-09-30',
      capacity: 10, occupied: 9, percentage: 90, status: 'critical' }];
    page = await render();
    grid = page.querySelector<HTMLElement>('.detail-grid')!;
    expect(grid.children.length).toBe(1);
    expect(grid.firstElementChild!.getBoundingClientRect().width)
      .toBeCloseTo(grid.getBoundingClientRect().width, 0);
  });

  it('invita sin pedir permiso al cargar y conecta Ahora no y Activar con el servicio existente', async () => {
    desktop.onboardingEligible.set(true);
    const page = await render();
    page.style.width = '1024px';
    await new Promise(resolve => requestAnimationFrame(resolve));
    const invite = page.querySelector<HTMLElement>('.desktop-invite')!;
    expect(invite.textContent).toContain('Activar avisos de escritorio');
    expect(invite.textContent).toContain('selecciona «Permitir» en el navegador.');
    expect(invite.getBoundingClientRect().height).toBeLessThan(90);
    expect(getComputedStyle(invite).display).toBe('flex');
    expect(desktop.toggle).not.toHaveBeenCalled();
    const buttons = Array.from(page.querySelectorAll<HTMLButtonElement>('.desktop-invite button'));
    expect(buttons.map(button => button.textContent?.trim())).toEqual(['Ahora no', 'Activar']);
    buttons.find(button => button.textContent?.includes('Ahora no'))!.click();
    fixture.detectChanges();
    expect(desktop.dismissOnboarding).toHaveBeenCalledTimes(1);
    expect(page.querySelector('.desktop-invite')).toBeNull();

    desktop.onboardingEligible.set(true);
    fixture.detectChanges();
    page.querySelector<HTMLButtonElement>('.desktop-invite-enable')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(desktop.toggle).toHaveBeenCalledTimes(1);
    expect(page.querySelector('.desktop-invite')).toBeNull();
  });

  it('mantiene el contenido dentro del ancho disponible en claro y oscuro', async () => {
    summary.operations.processes = ['confirmation', 'programming', 'insurance', 'commissions'].map(id => ({
      id, label: `Proceso ${id}`, count: 2, description: '', route: '/Programacion/Listado', permission: 'PROGRAMACION.LEER',
    }));
    summary.operations.capacityAlerts = [{ tourId: 1, tourName: 'Tour con nombre extenso',
      date: '2026-09-30', capacity: 20, occupied: 18, percentage: 90, status: 'critical' }];
    summary.operations.recentActivity = [{ Accion: 'ACTUALIZAR_ASISTENCIA', Tabla: 'reservas',
      Id_Registro: 1, Fecha_Hora_Registro: '2026-09-29T12:00:00Z' }];
    activity.pendientesAtendibles.set([
      { regla: 'COMISIONES_PENDIENTES', idPendiente: 'comisiones', titulo: 'Revisar comisiones', prioridad: 'ALTA' },
    ]);
    activity.attentionCount.set(1);
    desktop.onboardingEligible.set(true);
    const host = await render();
    const page = host.querySelector<HTMLElement>('.home-page')!;
    const originalTheme = document.documentElement.getAttribute('data-theme');
    try {
      for (const theme of ['light', 'dark']) {
        document.documentElement.setAttribute('data-theme', theme);
        for (const width of [1440, 1024, 768, 430, 390, 360]) {
          host.style.width = `${width}px`;
          fixture.detectChanges();
          await new Promise(resolve => requestAnimationFrame(resolve));
          expect(page.scrollWidth).withContext(`${theme}, ${width}px`).toBeLessThanOrEqual(page.clientWidth + 1);
        }
      }
    } finally {
      host.style.width = '';
      if (originalTheme == null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', originalTheme);
    }
  });
});
