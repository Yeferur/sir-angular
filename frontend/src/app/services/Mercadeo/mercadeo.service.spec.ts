import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MercadeoFilters, MercadeoOrigenPage, MercadeoService } from './mercadeo.service';

describe('MercadeoService', () => {
  let api: MercadeoService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(MercadeoService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('envía filtros unificados de tipo, entidad, canal y creador con paginación', () => {
    const filters: MercadeoFilters = {
      fechaRegistroDesde: '2026-09-01', fechaRegistroHasta: '2026-09-30', fechaTour: '2026-10-02',
      codigoReserva: '', categoria: '3', tipo: 'TRANSFER', idEntidadReportante: '7', creadorIds: ['12', '14'],
    };
    let result: MercadeoOrigenPage | undefined;
    api.buscarOrigen(filters, 2, 10).subscribe(page => result = page);

    const request = http.expectOne(req => req.url.endsWith('/mercadeo/origen'));
    expect(request.request.params.get('tipo')).toBe('TRANSFER');
    expect(request.request.params.get('fechaRegistroDesde')).toBe('2026-09-01');
    expect(request.request.params.get('fechaRegistroHasta')).toBe('2026-09-30');
    expect(request.request.params.get('fechaTour')).toBe('2026-10-02');
    expect(request.request.params.get('categoria')).toBe('3');
    expect(request.request.params.get('idEntidadReportante')).toBe('7');
    expect(request.request.params.get('creadorIds')).toBe('12,14');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('pageSize')).toBe('10');
    request.flush({
      items: [{ tipo: 'TRANSFER', id_operacion: '42', id_reserva: null, id_transfer: 42,
        fecha_registro: '2026-09-20 10:00:00', fecha_servicio: '2026-10-02', id_canal: 3, canal: 'Web',
        id_entidad_reportante: 7, entidad: 'Hotel Dann', tipo_entidad: 'HOTEL', nombre_reportante: 'Juan Pérez',
        telefono_reportante: '3001234567', creador_id: 12, creador: 'Usuario Uno', pasajeros: 2, estado: 'Pendiente' }],
      page: 2, pageSize: 10, totalPages: 2, totalOperaciones: 16, totalPasajeros: 2,
      totalPasajerosEnPagina: 2, tipo: 'TRANSFER',
    });
    expect(result?.items[0].id_transfer).toBe(42);
    expect(result?.totalPasajerosEnPagina).toBe(2);
  });

});
