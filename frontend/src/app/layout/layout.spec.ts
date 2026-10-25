import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { EMPTY, of, Subject, BehaviorSubject } from 'rxjs';
import { LayoutComponent } from './layout';
import { AuthService } from '../services/Login/login-service';
import { PermisosService } from '../services/Permisos/permisos.service';
import { UsuariosService } from '../services/Usuarios/usuarios';
import { NotificacionesService } from '../services/Notificaciones/notificaciones.service';
import { PendientesService } from '../services/Pendientes/pendientes.service';
import { WebSocketService } from '../services/WebSocket/web-socket';
import { SirDrawerService } from '../services/Drawer/drawer.service';
import { MiActividadFacade } from '../services/MiActividad/mi-actividad.facade';
import { DesktopNotificationsService } from '../services/Notificaciones/desktop-notifications.service';
import { SirAlertService } from '../services/Alertas/alert.service';
import { UnsavedChangesService } from '../guards/unsaved-changes.guard';
import { TopbarTransitionService } from '../components/login/topbar-transition.service';

// El shell real se prueba con una sesión ficticia y sin peticiones al backend.
describe('Navegación superior', () => {
  let fixture: ComponentFixture<LayoutComponent>;
  let layout: LayoutComponent;
  let allowed: Set<string>;
  let role: string;
  let notificationLoad: jasmine.Spy;
  let notificationClear: jasmine.Spy;
  let events: Subject<any>;
  let permissionChanges: BehaviorSubject<string[]>;
  let desktopToggle: jasmine.Spy;
  let desktopState: ReturnType<typeof signal<'enabled' | 'disabled' | 'blocked'>>;
  let authLogout: jasmine.Spy;
  const allPermissions = [
    'RESERVAS.LEER', 'RESERVAS.CREAR', 'CONTROL_VIAJE.LEER',
    'TRANSFERS.LEER', 'TRANSFERS.CREAR', 'TOURS.LEER', 'TOURS.CREAR',
    'PUNTOS.LEER', 'PUNTOS.CREAR', 'USUARIOS.LEER', 'USUARIOS.CREAR',
    'TURNOS.LEER', 'PROGRAMACION.LEER', 'SEGUROS.LEER', 'COMISIONES.LEER',
    'AFOROS.LEER', 'INFORMES.LEER', 'HISTORIAL.LEER', 'PENDIENTES.LEER',
    'NOTIFICACIONES.LEER', 'MERCADEO.RESERVAS.LEER', 'ENTIDADES_REPORTANTES.LEER',
  ];
  const element = <T extends HTMLElement = HTMLElement>(selector: string): T =>
    fixture.nativeElement.querySelector(selector) as T;
  const render = async () => {
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    allowed = new Set(allPermissions);
    role = 'Administrador';
    notificationLoad = jasmine.createSpy('notificationLoad');
    notificationClear = jasmine.createSpy('notificationClear');
    events = new Subject<any>();
    permissionChanges = new BehaviorSubject<string[]>(allPermissions);
    desktopToggle = jasmine.createSpy('desktopToggle').and.resolveTo('enabled');
    authLogout = jasmine.createSpy('authLogout');
    desktopState = signal<'enabled' | 'disabled' | 'blocked'>('disabled');
    await TestBed.configureTestingModule({
      imports: [LayoutComponent],
      providers: [
        provideZonelessChangeDetection(), provideRouter([{ path: 'Mercadeo/Reservas', children: [] }]),
        provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: {
          getToken: () => 'test-session',
          getUser: () => ({ name: 'Usuario', apellidos: 'Prueba', email: 'prueba@example.test' }),
          isLoggedIn: () => of(false),
          logout: authLogout,
        } },
        { provide: PermisosService, useValue: {
          permisos$: permissionChanges.asObservable(),
          loadSessionData: () => Promise.resolve(true),
          tienePermiso: (code: string) => allowed.has(code),
          tieneAlgunPermiso: (codes: string[]) => codes.some(code => allowed.has(code)),
          esCliente: () => role === 'Cliente',
          getRoleSnapshot: () => role,
        } },
        { provide: UsuariosService, useValue: { getMiPerfil: () => of(null) } },
        { provide: NotificacionesService, useValue: {
          noLeidas: signal(3), load: notificationLoad, clear: notificationClear,
        } },
        { provide: PendientesService, useValue: { activeCount: signal(4), loadCount: jasmine.createSpy('pendingLoadCount'), clear: () => {} } },
        { provide: MiActividadFacade, useValue: {
          isAvailable: true, attentionCount: signal(2), unifiedCount: signal(5), start: jasmine.createSpy('activityStart'),
          clear: jasmine.createSpy('activityClear'), open: jasmine.createSpy('activityOpen'),
        } },
        { provide: DesktopNotificationsService, useValue: {
          supported: signal(true), permission: signal('granted'), enabled: signal(false),
          state: desktopState,
          configureUser: jasmine.createSpy('desktopConfigureUser'), clearSession: jasmine.createSpy('desktopClearSession'),
          toggle: desktopToggle,
        } },
        { provide: WebSocketService, useValue: { events$: events.asObservable() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LayoutComponent);
    layout = fixture.componentInstance;
    await render();
  });

  it('distribuye el menú en cuatro columnas y conserva las rutas de creación', () => {
    const headings = Array.from(fixture.nativeElement.querySelectorAll('.launcher-column > h3'))
      .map(node => (node as HTMLElement).textContent?.trim());
    expect(headings).toEqual(['Principal', 'Operación', 'Programación', 'Mercadeo']);
    expect(layout.getCreateActions().map(item => item.route)).toEqual([
      '/Reservas/NuevaReserva', '/Transfers/NuevoTransfer', '/Tours/NuevoTour',
      '/Puntos/NuevoPunto', '/Usuarios/NuevoUsuario',
    ]);
    expect(element('.launcher-operation-grid').children.length).toBe(4);
    expect(element('a[href="/Aforos"]')?.classList.contains('launcher-card--feature')).toBeTrue();
    expect(element('a[href="/Reservas/Confirmacion"]')?.closest('.launcher-subsection')?.querySelector('h3')?.textContent?.trim()).toBe('Después del viaje');
    const systemSection = (Array.from(fixture.nativeElement.querySelectorAll('.launcher-subsection')) as HTMLElement[])
      .find(section => section.querySelector('h3')?.textContent?.trim() === 'Sistema');
    expect(Array.from(systemSection?.querySelectorAll('.launcher-card strong') || [])
      .map(node => node.textContent?.trim())).toEqual([
        'Administrar Usuarios', 'Crear Usuarios', 'Turnos de asesores', 'Historial',
      ]);
    expect(element('a[href="/Programacion/General"]')?.closest('.launcher-column')?.querySelector('h3')?.textContent?.trim()).toBe('Programación');
    expect(element('a[href="/Mercadeo/Reservas"]')?.closest('.launcher-column')?.querySelector('h3')?.textContent?.trim()).toBe('Mercadeo');
    expect(element('a[href="/Programacion/General"] .launcher-card-copy small')?.textContent?.trim())
      .toBe('Reservas para operación y exportación');
    expect(element('a[href="/Usuarios"] .launcher-card-copy small')).toBeNull();
    expect(element('a[href="/Reservas/Confirmacion"] .launcher-card-copy small')?.textContent?.trim()).toBe('Quién viajó');
    expect(element('a[href="/Seguros"] .launcher-card-copy small')).toBeNull();
    expect(element('a[href="/"]').getAttribute('href')).toBe('/');
    expect(element('[data-create-trigger]').querySelector('.bx-plus')).toBeNull();
  });

  it('muestra Mercadeo y Entidades como tarjetas independientes con su permiso', () => {
    const origin = element('a[href="/Mercadeo/Reservas"]');
    const entities = element('a[href="/Mercadeo/Entidades"]');
    expect(origin.textContent).toContain('Origen de reservas');
    expect(entities.textContent).toContain('Entidades reportantes');
    expect(origin.closest('.launcher-subgroup')).toBeNull();
    expect(entities.closest('.launcher-subgroup')).toBeNull();
  });

  it('oculta columnas y subsecciones sin elementos visibles y deja fluir las restantes', async () => {
    allowed = new Set(['INFORMES.LEER', 'SEGUROS.LEER']);
    await render();

    const columns = Array.from(fixture.nativeElement.querySelectorAll('.launcher-column')) as HTMLElement[];
    expect(columns.length).toBe(2);
    expect(columns.map(column => column.querySelector(':scope > h3')?.textContent?.trim()))
      .toEqual(['Principal', undefined]);
    expect(element('.launcher-subsection > h3').textContent?.trim()).toBe('Después del viaje');
    expect(element('.launcher-operation-grid')).toBeNull();
    expect(element('a[href="/Mercadeo/Reservas"]')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.launcher-subsection').length).toBe(1);
  });

  it('conserva el título anterior mientras inicia una navegación lazy', () => {
    layout.pageTitle.set('Reservas');

    (layout as any).startNavigationMotion(true);

    expect(layout.pageTitle()).toBe('Reservas');
    expect(layout.titleLeaving()).toBeFalse();
  });

  it('mantiene la isla dentro del viewport con Inicio, Avisos y Aforos', async () => {
    for (const title of ['Inicio', 'Avisos', 'Aforos']) {
      layout.pageTitle.set(title);
      await render();
      const bar = element('.topbar-bar').getBoundingClientRect();
      const viewport = document.documentElement.clientWidth;
      expect(bar.left).withContext(`${title}: borde izquierdo a ${viewport}px`).toBeGreaterThanOrEqual(0);
      expect(bar.right).withContext(`${title}: borde derecho a ${viewport}px`).toBeLessThanOrEqual(viewport);
      expect(element('.topbar-page-title').textContent?.trim()).toBe(title);
      expect(document.documentElement.scrollWidth).withContext(`${title}: scroll horizontal a ${viewport}px`).toBeLessThanOrEqual(viewport);
    }
  });

  it('mantiene un título largo en una línea y ajusta sólo su letra', async () => {
    layout.pageTitle.set('Entidades reportantes');
    await render();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const title = element('.topbar-page-title');
    const zone = element('.topbar-title-zone');
    expect(getComputedStyle(title).whiteSpace).toBe('nowrap');
    expect(title.getBoundingClientRect().height).toBeLessThan(zone.getBoundingClientRect().height);
    expect(title.scrollWidth).toBeLessThanOrEqual(zone.clientWidth);
  });

  it('conserva una geometría móvil válida antes de medir la transición', () => {
    if (document.documentElement.clientWidth > 766) return;
    const bar = element('.topbar-bar');
    bar.style.transition = 'none';
    bar.classList.add('is-transitioning');
    const rect = bar.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(document.documentElement.clientWidth);
    expect(rect.width).toBeGreaterThan(200);
  });

  it('delega Mi actividad y refresca el conteo con las novedades de Programación', () => {
    (layout as any).syncNotificationSession(true);
    notificationLoad.calls.reset();
    const count = TestBed.inject(PendientesService).loadCount as jasmine.Spy;
    count.calls.reset();
    events.next({ type: 'programacionNovedadesActualizadas', payload: {} });
    expect(notificationLoad).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalledTimes(1);
    allowed.delete('PENDIENTES.LEER');
    events.next({ type: 'programacionNovedadesActualizadas', payload: {} });
    expect(notificationLoad).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('mantiene un único acceso y contador para todos los avisos', () => {
    const activityTrigger = element('.activity-trigger');
    expect(fixture.nativeElement.querySelectorAll('.notification-trigger').length).toBe(1);
    expect(activityTrigger.querySelector('.activity-count')?.textContent?.trim()).toBe('5');
    expect(element('.topbar-avatar-btn').querySelector('.activity-count')).toBeNull();
  });

  it('activa Avisos solo mientras el drawer de actividad está abierto', async () => {
    const drawer = TestBed.inject(SirDrawerService);
    expect(element('.activity-trigger').classList.contains('active')).toBeFalse();

    drawer.openActivity();
    await render();
    expect(element('.activity-trigger').classList.contains('active')).toBeTrue();
    expect(element('.activity-trigger').getAttribute('aria-pressed')).toBe('true');

    drawer.close(true);
    await render();
    expect(element('.activity-trigger').classList.contains('active')).toBeFalse();
  });

  it('filtra Crear por permisos y conserva la restricción especial de Cliente', async () => {
    allowed = new Set(['RESERVAS.LEER', 'RESERVAS.CREAR', 'TOURS.CREAR']);
    role = 'Cliente';
    await render();
    expect(layout.getCreateActions().map(item => item.key)).toEqual(['reservas-nueva']);
    expect(element('#topbar-create-menu').querySelectorAll('a').length).toBe(1);
    expect(element('.launcher-operation-grid').children.length).toBe(1);
    expect(element('.launcher-column--wide')).toBeNull();
  });

  it('muestra y carga el centro personal sin NOTIFICACIONES.LEER', async () => {
    allowed.delete('NOTIFICACIONES.LEER');
    notificationLoad.calls.reset();
    notificationClear.calls.reset();
    const activityStart = TestBed.inject(MiActividadFacade).start as jasmine.Spy;
    activityStart.calls.reset();
    await render();

    (layout as any).syncNotificationSession(true);
    await render();

    expect(element('.notification-trigger')).toBeTruthy();
    expect(activityStart).toHaveBeenCalled();
    expect(notificationClear).not.toHaveBeenCalled();
  });

  it('oculta Crear cuando solo hay permisos de lectura y mantiene Mi horario para Asesor', async () => {
    allowed = new Set(['RESERVAS.LEER']);
    role = 'Asesor';
    await render();
    expect(element('[data-create-trigger]')).toBeNull();
    expect(element('a[href="/MiHorario"]')).not.toBeNull();
    expect(element('a[href="/Reservas/VerReservas"]')).not.toBeNull();
  });

  it('muestra cada destino de Mercadeo solo con su permiso de lectura', async () => {
    allowed = new Set(['RESERVAS.LEER']);
    await render();
    expect(element('a[href="/Mercadeo/Reservas"]')).toBeNull();
    expect(element('a[href="/Mercadeo/Entidades"]')).toBeNull();

    allowed.add('MERCADEO.RESERVAS.LEER');
    await render();
    const originLink = element<HTMLAnchorElement>('a[href="/Mercadeo/Reservas"]');
    expect(originLink).not.toBeNull();
    expect(originLink.textContent).toContain('Origen de reservas');
    expect(element('a[href="/Mercadeo/Entidades"]')).toBeNull();

    layout.toggleNavigationLauncher();
    await render();
    originLink.click();
    await render();
    expect(TestBed.inject(Router).url).toBe('/Mercadeo/Reservas');
    expect(originLink.classList.contains('active')).toBeTrue();
    expect(originLink.getAttribute('aria-current')).toBe('page');

    allowed.delete('MERCADEO.RESERVAS.LEER');
    allowed.add('ENTIDADES_REPORTANTES.LEER');
    await render();
    expect(element('a[href="/Mercadeo/Reservas"]')).toBeNull();
    expect(element('a[href="/Mercadeo/Entidades"]')).not.toBeNull();
  });

  it('actualiza el menú y las acciones al emitir nuevos permisos sin recargar', async () => {
    allowed = new Set(['RESERVAS.LEER']);
    permissionChanges.next([...allowed]);
    await fixture.whenStable();
    expect(element('a[href="/Mercadeo/Reservas"]')).toBeNull();
    expect(element('[data-create-trigger]')).toBeNull();

    allowed.add('MERCADEO.RESERVAS.LEER');
    allowed.add('ENTIDADES_REPORTANTES.LEER');
    allowed.add('RESERVAS.CREAR');
    permissionChanges.next([...allowed]);
    await fixture.whenStable();
    expect(element('a[href="/Mercadeo/Reservas"]')).not.toBeNull();
    expect(element('[data-create-trigger]')).not.toBeNull();

    allowed.delete('MERCADEO.RESERVAS.LEER');
    allowed.delete('ENTIDADES_REPORTANTES.LEER');
    allowed.delete('RESERVAS.CREAR');
    permissionChanges.next([...allowed]);
    await fixture.whenStable();
    expect(element('a[href="/Mercadeo/Reservas"]')).toBeNull();
    expect(element('[data-create-trigger]')).toBeNull();
  });

  it('excluye los paneles incompatibles y hace inertes los dropdowns cerrados', async () => {
    layout.toggleNavigationLauncher();
    await render();
    expect(layout.navigationLauncherOpen()).toBeTrue();
    layout.toggleCreateMenu();
    await render();
    expect(layout.navigationLauncherOpen()).toBeFalse();
    expect(element('#topbar-create-menu').inert).toBeFalse();
    layout.toggleProfileMenu();
    await render();
    expect(layout.createMenuOpen()).toBeFalse();
    expect(element('#topbar-create-menu').inert).toBeTrue();
    expect(element('#topbar-profile-menu').inert).toBeFalse();
  });

  for (const menu of ['create', 'profile'] as const) {
    it(`gestiona foco, flechas, Escape y Tab en ${menu}`, async () => {
      const trigger = element(`[data-${menu}-trigger]`);
      trigger.click();
      await render();
      const panel = element(`#topbar-${menu}-menu`);
      const items = Array.from(panel.querySelectorAll<HTMLElement>('a, button'))
        .filter(item => item.offsetParent !== null);
      expect(document.activeElement).toBe(items[0]);
      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(items[items.length - 1]);
      items[items.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(items[0]);
      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await render();
      expect(document.activeElement).toBe(trigger);
      expect(panel.inert).toBeTrue();
      trigger.click();
      await render();
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      document.activeElement?.dispatchEvent(tab);
      await render();
      expect(tab.defaultPrevented).toBeFalse();
      expect(panel.inert).toBeTrue();
      expect(document.activeElement).toBe(trigger);
    });
  }

  it('cierra por clic exterior y al abrir notificaciones o novedades', async () => {
    layout.toggleCreateMenu();
    await render();
    document.body.click();
    await render();
    expect(layout.createMenuOpen()).toBeFalse();
    layout.toggleProfileMenu();
    await render();
    const activityOpen = TestBed.inject(MiActividadFacade).open as jasmine.Spy;
    activityOpen.calls.reset();
    layout.openNotifications();
    expect(layout.profileMenuOpen()).toBeFalse();
    expect(activityOpen).toHaveBeenCalledTimes(1);
    layout.toggleNavigationLauncher();
    await render();
    layout.openAppUpdates();
    expect(layout.navigationLauncherOpen()).toBeFalse();
    expect(TestBed.inject(SirDrawerService).drawer()?.type).toBe('app-updates');
  });

  it('mantiene las acciones de perfil, ayuda y salida conectadas', async () => {
    const profile = spyOn(layout, 'navigateToProfile');
    const help = spyOn(layout, 'navigateToHelp');
    const logout = spyOn(layout, 'handleLogout');
    layout.toggleProfileMenu();
    await render();
    const buttons = Array.from(element('#topbar-profile-menu').querySelectorAll<HTMLButtonElement>('button'));
    buttons.find(button => button.textContent?.includes('Editar perfil'))!.click();
    buttons.find(button => button.textContent?.includes('Ayuda y soporte'))!.click();
    buttons.find(button => button.textContent?.includes('Salir'))!.click();
    expect(profile).toHaveBeenCalledTimes(1);
    expect(help).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('sin cambios inicia logout sin diálogo', async () => {
    TestBed.inject(TopbarTransitionService).markAppReady();
    await render();
    const coordinator = TestBed.inject(UnsavedChangesService);
    const alerts = TestBed.inject(SirAlertService);
    const confirm = spyOn(alerts, 'confirmDecision').and.resolveTo(false);
    const expand = spyOn(TestBed.inject(TopbarTransitionService), 'requestExpandToFullscreen');
    const navigation = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    spyOn<any>(layout, 'runLogoutTransition').and.resolveTo();
    const draft = { hasUnsavedChanges: () => false };
    coordinator.activate(draft);
    await layout.handleLogout();
    expect(confirm).not.toHaveBeenCalled();
    expect(expand).toHaveBeenCalledTimes(1);
    (layout as any).finishLogout();
    expect(authLogout).toHaveBeenCalledTimes(1);
    expect(navigation).toHaveBeenCalledWith('/');
  });

  it('con cambios pregunta antes de cerrar y cancelar conserva sesión y formulario', async () => {
    TestBed.inject(TopbarTransitionService).markAppReady();
    await render();
    const coordinator = TestBed.inject(UnsavedChangesService);
    const draft = { hasUnsavedChanges: () => true };
    coordinator.activate(draft);
    const confirm = spyOn(TestBed.inject(SirAlertService), 'confirmDecision').and.resolveTo(false);
    const expand = spyOn(TestBed.inject(TopbarTransitionService), 'requestExpandToFullscreen');
    layout.profileMenuOpen.set(true);
    await layout.handleLogout();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(expand).not.toHaveBeenCalled();
    expect(layout.profileMenuOpen()).toBeTrue();
    expect(draft.hasUnsavedChanges()).toBeTrue();
    expect(authLogout).not.toHaveBeenCalled();
    expect(coordinator.isApprovedLogoutNavigation('/')).toBeFalse();
  });

  it('al confirmar cambios pendientes cierra sesión con una sola decisión', async () => {
    TestBed.inject(TopbarTransitionService).markAppReady();
    await render();
    const coordinator = TestBed.inject(UnsavedChangesService);
    coordinator.activate({ hasUnsavedChanges: () => true });
    const confirm = spyOn(TestBed.inject(SirAlertService), 'confirmDecision').and.resolveTo(true);
    const expand = spyOn(TestBed.inject(TopbarTransitionService), 'requestExpandToFullscreen');
    const navigation = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    spyOn<any>(layout, 'runLogoutTransition').and.resolveTo();
    await layout.handleLogout();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(expand).toHaveBeenCalledTimes(1);
    expect(coordinator.isApprovedLogoutNavigation('/')).toBeTrue();
    expect(authLogout).not.toHaveBeenCalled();
    (layout as any).finishLogout();
    expect(authLogout).toHaveBeenCalledTimes(1);
    expect(navigation).toHaveBeenCalledWith('/');
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('activa los avisos de escritorio únicamente desde la acción del perfil', async () => {
    layout.toggleProfileMenu();
    await render();
    const button = Array.from(element('#topbar-profile-menu').querySelectorAll<HTMLButtonElement>('button'))
      .find(item => item.textContent?.includes('Avisos de escritorio: Desactivados'))!;
    button.click();
    await fixture.whenStable();
    expect(desktopToggle).toHaveBeenCalledTimes(1);
  });

  it('refleja en Perfil el permiso concedido o bloqueado', async () => {
    layout.toggleProfileMenu();
    desktopState.set('enabled');
    await render();
    expect(element('#topbar-profile-menu').textContent).toContain('Avisos de escritorio: Activados');

    desktopState.set('blocked');
    await render();
    expect(element('#topbar-profile-menu').textContent).toContain('Avisos de escritorio: Bloqueados');
  });
});
