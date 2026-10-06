import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SirAlertService } from '../Alertas/alert.service';
import { SirDrawerService } from '../Drawer/drawer.service';
import { AppVersionService, LOADED_SIR_VERSION, SIR_RELOAD, VERSION_CHECK_INTERVAL_MS } from './app-version.service';

describe('AppVersionService', () => {
  let service: AppVersionService;
  let http: HttpTestingController;
  let alerts: SirAlertService;
  let drawer: SirDrawerService;
  let reload: jasmine.Spy;

  const setup = (loadedVersion = 'v1.3.0-beta') => {
    reload = jasmine.createSpy('reload');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: LOADED_SIR_VERSION, useValue: loadedVersion },
        { provide: SIR_RELOAD, useValue: reload },
      ],
    });
    service = TestBed.inject(AppVersionService);
    http = TestBed.inject(HttpTestingController);
    alerts = TestBed.inject(SirAlertService);
    drawer = TestBed.inject(SirDrawerService);
  };

  const respond = async (version = 'v1.3.0-beta') => {
    const pending = service.check();
    const request = http.expectOne(req => req.url.endsWith('/app-updates/current'));
    expect(request.request.params.has('_')).toBeTrue();
    request.flush({ version });
    await pending;
  };

  beforeEach(() => {
    localStorage.clear();
    spyOn(document, 'hasFocus').and.returnValue(true);
    spyOnProperty(document, 'visibilityState', 'get').and.returnValue('visible');
  });
  afterEach(() => {
    service?.stop();
    http?.verify();
    localStorage.clear();
  });

  it('no avisa cuando la misma versión ya fue presentada', async () => {
    setup();
    localStorage.setItem('sir.app-update.presented:7:v1.3.0-beta', '1');
    service.start('7', async () => true);
    await respond();
    expect(alerts.toasts().length).toBe(0);
    expect(reload).not.toHaveBeenCalled();
  });

  it('presenta una sola vez la versión cargada y abre Novedades', async () => {
    setup();
    service.start('7', async () => true);
    await respond();
    expect(alerts.toasts().length).toBe(1);
    expect(alerts.toasts()[0].title).toBe('SIR se actualizó a v1.3.0-beta');
    expect(localStorage.getItem('sir.app-update.presented:7:v1.3.0-beta')).toBe('1');
    alerts.toasts()[0].action?.onClick?.();
    expect(drawer.drawer()?.type).toBe('app-updates');

    await respond();
    expect(alerts.toasts().length).toBe(1);
    service.stop();
    service.start('7', async () => true);
    await respond();
    expect(alerts.toasts().length).toBe(0);
  });

  it('mantiene el aviso de SPA antigua y solo recarga por acción con permiso del formulario', async () => {
    setup('v1.2.0');
    const mayReload = jasmine.createSpy('mayReload').and.resolveTo(false);
    service.start('7', mayReload);
    await respond();
    const toast = alerts.toasts()[0];
    expect(toast.title).toBe('Hay una nueva versión de SIR disponible');
    expect(toast.persistent).toBeTrue();
    expect(toast.dismissible).toBeFalse();
    expect(reload).not.toHaveBeenCalled();
    expect(mayReload).not.toHaveBeenCalled();

    toast.action?.onClick?.();
    await Promise.resolve();
    expect(mayReload).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    mayReload.and.resolveTo(true);
    toast.action?.onClick?.();
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('deduplica consultas simultáneas y revisiones posteriores en la misma pestaña', async () => {
    setup('v1.2.0');
    service.start('7', async () => true);
    const first = service.check();
    const second = service.check();
    expect(first).toBe(second);
    const request = http.expectOne(req => req.url.endsWith('/app-updates/current'));
    request.flush({ version: 'v1.3.0-beta' });
    await first;
    await respond();
    expect(alerts.toasts().length).toBe(1);
  });

  it('comprueba cada cinco minutos y al recuperar foco o visibilidad tras el intervalo', async () => {
    setup();
    const now = Date.now();
    const clock = spyOn(Date, 'now').and.returnValue(now);
    service.start('7', async () => true);
    await respond();
    window.dispatchEvent(new Event('focus'));
    http.expectNone(req => req.url.endsWith('/app-updates/current'));

    clock.and.returnValue(now + VERSION_CHECK_INTERVAL_MS);
    window.dispatchEvent(new Event('focus'));
    await respond();
    clock.and.returnValue(now + 2 * VERSION_CHECK_INTERVAL_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    await respond();
  });

  it('programa la comprobación periódica mientras permanece abierta', async () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date());
    try {
      setup();
      service.start('7', async () => true);
      await respond();
      jasmine.clock().tick(VERSION_CHECK_INTERVAL_MS);
      await respond();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('coordina el aviso de versión antigua entre dos pestañas simuladas', async () => {
    setup('v1.2.0');
    const second = TestBed.runInInjectionContext(() => new AppVersionService());
    try {
      service.start('7', async () => true);
      second.start('7', async () => true);
      const firstPending = service.check();
      const secondPending = second.check();
      const requests = http.match(req => req.url.endsWith('/app-updates/current'));
      expect(requests.length).toBe(2);
      requests[0].flush({ version: 'v1.3.0-beta' });
      await firstPending;
      requests[1].flush({ version: 'v1.3.0-beta' });
      await secondPending;
      expect(alerts.toasts().length).toBe(1);
    } finally {
      second.stop();
    }
  });

  it('presenta la versión recién cargada en una sola de dos pestañas', async () => {
    setup();
    const second = TestBed.runInInjectionContext(() => new AppVersionService());
    try {
      service.start('7', async () => true);
      second.start('7', async () => true);
      const firstPending = service.check();
      const secondPending = second.check();
      const requests = http.match(req => req.url.endsWith('/app-updates/current'));
      expect(requests.length).toBe(2);
      requests[0].flush({ version: 'v1.3.0-beta' });
      requests[1].flush({ version: 'v1.3.0-beta' });
      await Promise.all([firstPending, secondPending]);
      expect(alerts.toasts().filter(toast => toast.title === 'SIR se actualizó a v1.3.0-beta').length).toBe(1);
    } finally {
      second.stop();
    }
  });
});
