import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HistorialService } from './historial.service';

describe('HistorialService: tipo de actividad', () => {
  let service: HistorialService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HistorialService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('envía los IDs estables, sin acciones técnicas, en consulta y exportación', () => {
    const filters = { actividad: ['modificaciones', 'accesos'], fechaInicio: '2026-10-01', fechaFin: '2026-10-13' };
    service.getHistorial(filters).subscribe();
    const query = http.expectOne((request) => request.url.endsWith('/historial'));
    expect(query.request.params.getAll('actividad')).toEqual(['modificaciones', 'accesos']);
    expect(query.request.params.has('acciones')).toBeFalse();
    expect(query.request.params.get('desde')).toBe('2026-10-01');
    query.flush({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });

    service.exportarHistorial(filters).subscribe();
    const exportRequest = http.expectOne((request) => request.url.endsWith('/historial/export'));
    expect(exportRequest.request.params.getAll('actividad')).toEqual(['modificaciones', 'accesos']);
    expect(exportRequest.request.params.has('acciones')).toBeFalse();
    exportRequest.flush(new Blob());
  });
});
