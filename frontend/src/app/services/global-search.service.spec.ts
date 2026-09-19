import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { GlobalSearchService } from './global-search.service';
import { PermisosService } from './Permisos/permisos.service';
import { SirAlertService } from './Alertas/alert.service';
import { SirDrawerService } from './Drawer/drawer.service';

describe('GlobalSearchService', () => {
  let service: GlobalSearchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        GlobalSearchService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: PermisosService,
          useValue: {
            isReady: () => true,
            getPermisosSnapshot: (): string[] => [],
            tienePermiso: () => true,
          },
        },
        { provide: SirAlertService, useValue: { warningToast: (): void => {}, infoToast: (): void => {} } },
        { provide: SirDrawerService, useValue: {} },
      ],
    });
    service = TestBed.inject(GlobalSearchService);
    http = TestBed.inject(HttpTestingController);
    jasmine.clock().install();
  });

  afterEach(() => {
    http.verify();
    jasmine.clock().uninstall();
  });

  it('espera aproximadamente 300 ms antes de consultar mientras se escribe', () => {
    service.updateQuery('mañana');

    jasmine.clock().tick(299);
    http.expectNone((request) => request.url.includes('/search/global'));
    expect(service.waiting()).toBeTrue();
    expect(service.loading()).toBeFalse();

    jasmine.clock().tick(1);
    const request = http.expectOne((entry) => entry.url.includes('/search/global'));
    expect(request.request.params.get('q')).toBe('mañana');
    expect(service.waiting()).toBeFalse();
    expect(service.loading()).toBeTrue();

    request.flush({ query: 'mañana', results: [{ id: 'date-1', type: 'date', title: 'Mañana', actions: [] }] });
    expect(service.loading()).toBeFalse();
    expect(service.error()).toBeNull();
    expect(service.results().length).toBe(1);
  });

  it('reemplaza el debounce anterior cuando cambia la consulta', () => {
    service.updateQuery('reservas');
    jasmine.clock().tick(300);
    const firstRequest = http.expectOne((entry) => entry.url.includes('/search/global'));
    service.updateQuery('mañana');
    expect(firstRequest.cancelled).toBeTrue();

    jasmine.clock().tick(299);
    http.expectNone((request) => request.url.includes('/search/global'));

    jasmine.clock().tick(1);
    const request = http.expectOne((entry) => entry.url.includes('/search/global'));
    expect(request.request.params.get('q')).toBe('mañana');
    request.flush({ query: 'mañana', results: [] });
  });

  it('mantiene Enter como ejecución inmediata y no consulta textos vacíos', () => {
    service.searchGlobal('RES-100');
    const request = http.expectOne((entry) => entry.url.includes('/search/global'));
    expect(request.request.params.get('q')).toBe('RES-100');
    request.flush({ query: 'RES-100', results: [] });

    service.searchGlobal('   ');
    http.expectNone((entry) => entry.url.includes('/search/global'));
    expect(service.loading()).toBeFalse();
  });

  it('expone un error separado y no presenta resultados cuando la consulta falla', () => {
    service.searchGlobal('mañana');
    const request = http.expectOne((entry) => entry.url.includes('/search/global'));
    request.flush('offline', { status: 503, statusText: 'Service Unavailable' });

    expect(service.loading()).toBeFalse();
    expect(service.results()).toEqual([]);
    expect(service.error()).toBe('Comprueba la conexión e inténtalo de nuevo.');
  });
});
