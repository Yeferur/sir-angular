import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { App } from './app';
import { AuthService } from './services/Login/login-service';
import { WebSocketService } from './services/WebSocket/web-socket';
import { PermisosService } from './services/Permisos/permisos.service';
import { SirAlertService } from './services/Alertas/alert.service';
import { AppVersionService } from './services/AppUpdates/app-version.service';
import { TopbarTransitionService } from './components/login/topbar-transition.service';
import { Router } from '@angular/router';

describe('sincronización de permisos de sesión', () => {
  let events: Subject<any>;
  let allowed: boolean;
  let backendAllows: boolean;
  let backendFails: boolean;
  let router: any;
  let alerts: any;
  let permissions: any;

  beforeEach(async () => {
    events = new Subject<any>();
    allowed = false;
    backendAllows = false;
    backendFails = false;
    const root = { data: {}, firstChild: null as any };
    router = {
      url: '/', events: new Subject<any>(), routerState: { snapshot: { root } },
      navigateByUrl: jasmine.createSpy('navigateByUrl').and.resolveTo(true),
    };
    alerts = { infoToast: jasmine.createSpy('infoToast'), warningToast: jasmine.createSpy('warningToast'), closeModal: jasmine.createSpy('closeModal') };
    permissions = {
      cargarPermisosDesdeLocalStorage: jasmine.createSpy(),
      limpiarPermisos: jasmine.createSpy(),
      obtenerMisPermisos: jasmine.createSpy().and.callFake(() => {
        if (backendFails) return throwError(() => new Error('sin respuesta'));
        allowed = backendAllows;
        return of({ permisos: backendAllows ? [{ codigo: 'MERCADEO.RESERVAS.LEER' }] : [], role: 'Administrador' });
      }),
      tieneAlgunPermiso: (codes: string[]) => codes.some(code => code === 'MERCADEO.RESERVAS.LEER' && allowed),
      tieneTodosPermisos: (codes: string[]) => codes.every(code => code === 'MERCADEO.RESERVAS.LEER' && allowed),
    };
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: router },
        { provide: AuthService, useValue: { getToken: () => 'token', getUser: () => ({ id: 3 }), isLoggedIn: () => of(true) } },
        { provide: WebSocketService, useValue: {
          permissionEvents$: events.asObservable(), systemEvents$: new Subject<any>().asObservable(),
          connect: jasmine.createSpy('connect'), disconnect: jasmine.createSpy('disconnect'),
        } },
        { provide: PermisosService, useValue: permissions },
        { provide: SirAlertService, useValue: alerts },
        { provide: AppVersionService, useValue: { start: jasmine.createSpy('start'), stop: jasmine.createSpy('stop') } },
        { provide: TopbarTransitionService, useValue: { phase: signal('app'), markAppReady: jasmine.createSpy('markAppReady') } },
      ],
    }).overrideComponent(App, { set: { template: '' } }).compileComponents();
    TestBed.createComponent(App).detectChanges();
  });

  it('concesión y revocación refrescan permisos canónicos sin reload', () => {
    backendAllows = true;
    events.next({ type: 'permissions:updated' });
    expect(permissions.obtenerMisPermisos).toHaveBeenCalledTimes(1);
    expect(allowed).toBeTrue();
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    backendAllows = false;
    events.next({ type: 'permissions:updated' });
    expect(allowed).toBeFalse();
    expect(permissions.obtenerMisPermisos).toHaveBeenCalledTimes(2);
  });

  it('expulsa de Mercadeo al revocar el permiso de la ruta activa', () => {
    allowed = true;
    backendAllows = false;
    router.routerState.snapshot.root.firstChild = {
      data: { permiso: 'MERCADEO.RESERVAS.LEER' }, firstChild: null,
    };
    router.url = '/Mercadeo/Reservas';
    events.next({ type: 'permissions:updated' });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    expect(alerts.infoToast).toHaveBeenCalledWith('Permisos actualizados', 'Tu acceso a esta sección cambió.');
  });

  it('actualiza permisos al reautenticar WebSocket tras reconexión', () => {
    backendAllows = true;
    events.next({ type: 'success' });
    expect(permissions.obtenerMisPermisos).toHaveBeenCalled();
    expect(allowed).toBeTrue();
  });

  it('retira capacidades locales y sale de la ruta si falla la verificación tras un cambio', () => {
    spyOn(console, 'error');
    backendFails = true;
    events.next({ type: 'permissions:updated' });
    expect(permissions.limpiarPermisos).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    expect(alerts.warningToast).toHaveBeenCalled();
  });
});
