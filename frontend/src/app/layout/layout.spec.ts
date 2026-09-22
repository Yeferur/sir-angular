import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { EMPTY, of, Subject } from 'rxjs';
import { LayoutComponent } from './layout';
import { AuthService } from '../services/Login/login-service';
import { PermisosService } from '../services/Permisos/permisos.service';
import { UsuariosService } from '../services/Usuarios/usuarios';
import { NotificacionesService } from '../services/Notificaciones/notificaciones.service';
import { PendientesService } from '../services/Pendientes/pendientes.service';
import { WebSocketService } from '../services/WebSocket/web-socket';
import { SirDrawerService } from '../services/Drawer/drawer.service';

// El shell real se prueba con una sesión ficticia y sin peticiones al backend.
describe('Navegación superior', () => {
  let fixture: ComponentFixture<LayoutComponent>;
  let layout: LayoutComponent;
  let allowed: Set<string>;
  let role: string;
  let notificationLoad: jasmine.Spy;
  let notificationClear: jasmine.Spy;
  let events: Subject<any>;
  const allPermissions = [
    'RESERVAS.LEER', 'RESERVAS.CREAR', 'CONTROL_VIAJE.LEER',
    'TRANSFERS.LEER', 'TRANSFERS.CREAR', 'TOURS.LEER', 'TOURS.CREAR',
    'PUNTOS.LEER', 'PUNTOS.CREAR', 'USUARIOS.LEER', 'USUARIOS.CREAR',
    'TURNOS.LEER', 'PROGRAMACION.LEER', 'SEGUROS.LEER', 'COMISIONES.LEER',
    'AFOROS.LEER', 'INFORMES.LEER', 'HISTORIAL.LEER', 'PENDIENTES.LEER',
    'NOTIFICACIONES.LEER',
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
    await TestBed.configureTestingModule({
      imports: [LayoutComponent],
      providers: [
        provideZonelessChangeDetection(), provideRouter([]),
        provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: {
          getToken: () => 'test-session',
          getUser: () => ({ name: 'Usuario', apellidos: 'Prueba', email: 'prueba@example.test' }),
          isLoggedIn: () => of(false),
        } },
        { provide: PermisosService, useValue: {
          permisos$: of(allPermissions),
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
        { provide: WebSocketService, useValue: { events$: events.asObservable() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LayoutComponent);
    layout = fixture.componentInstance;
    await render();
  });

  it('conserva las cuatro categorías y las cinco rutas de creación autorizadas', () => {
    const headings = Array.from(fixture.nativeElement.querySelectorAll('.launcher-column > h3'))
      .map(node => (node as HTMLElement).textContent?.trim());
    expect(headings).toEqual(['Principal', 'Operación', 'Gestión', 'Sistema']);
    expect(layout.getCreateActions().map(item => item.route)).toEqual([
      '/Reservas/NuevaReserva', '/Transfers/NuevoTransfer', '/Tours/NuevoTour',
      '/Puntos/NuevoPunto', '/Usuarios/NuevoUsuario',
    ]);
    expect(element('.launcher-operation-grid').children.length).toBe(4);
    expect(element('a[href="/Reservas/Confirmacion"]')?.closest('.launcher-column')?.querySelector('h3')?.textContent?.trim()).toBe('Gestión');
    const systemColumns = Array.from(fixture.nativeElement.querySelectorAll('.launcher-column')) as HTMLElement[];
    const systemColumn = systemColumns
      .find(column => column.querySelector('h3')?.textContent?.trim() === 'Sistema');
    expect(systemColumn?.querySelector('h4')).toBeNull();
    expect(Array.from(systemColumn?.querySelectorAll('.launcher-card strong') || [])
      .map(node => node.textContent?.trim())).toEqual([
        'Administrar Usuarios', 'Crear Usuarios', 'Turnos de asesores',
      ]);
    expect(element('a[href="/"]').getAttribute('href')).toBe('/');
  });

  it('refresca Notificaciones y el conteo de Pendientes con las novedades de Programación', () => {
    (layout as any).syncNotificationSession(true);
    notificationLoad.calls.reset();
    const count = TestBed.inject(PendientesService).loadCount as jasmine.Spy;
    count.calls.reset();
    events.next({ type: 'programacionNovedadesActualizadas', payload: {} });
    expect(notificationLoad).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledTimes(1);
    allowed.delete('PENDIENTES.LEER');
    events.next({ type: 'programacionNovedadesActualizadas', payload: {} });
    expect(notificationLoad).toHaveBeenCalledTimes(2);
    expect(count).toHaveBeenCalledTimes(1);
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
    await render();

    (layout as any).syncNotificationSession(true);
    await render();

    expect(element('.notification-trigger')).toBeTruthy();
    expect(notificationLoad).toHaveBeenCalled();
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
    layout.openNotifications();
    expect(layout.profileMenuOpen()).toBeFalse();
    expect(TestBed.inject(SirDrawerService).drawer()?.type).toBe('notificaciones');
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
});
