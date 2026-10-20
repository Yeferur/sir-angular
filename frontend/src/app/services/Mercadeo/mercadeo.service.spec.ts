import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MercadeoEntidadReportante, MercadeoFilters, MercadeoPage, MercadeoService } from './mercadeo.service';

describe('MercadeoService', () => {
  let api: MercadeoService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(MercadeoService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('envía los filtros de persona/entidad y conserva el DTO de Entidad reportante', () => {
    const filters: MercadeoFilters = {
      fechaRegistroDesde: '', fechaRegistroHasta: '', fechaTourDesde: '2026-09-01', fechaTourHasta: '2026-09-30',
      fechaTour: '', codigoReserva: '', categoria: '',
      nombreReportante: 'Juan Pérez', nombreEntidad: 'Hotel Dann', idEntidadReportante: '7',
      nombrePasajero: '', documento: '',
    };
    let result: MercadeoPage | undefined;
    api.buscar(filters, 2).subscribe(page => result = page);

    const request = http.expectOne(req => req.url.endsWith('/mercadeo/reservas'));
    expect(request.request.params.get('nombreReportante')).toBe('Juan Pérez');
    expect(request.request.params.get('nombreEntidad')).toBe('Hotel Dann');
    expect(request.request.params.get('idEntidadReportante')).toBe('7');
    expect(request.request.params.get('fechaTourDesde')).toBe('2026-09-01');
    expect(request.request.params.get('fechaTourHasta')).toBe('2026-09-30');
    expect(request.request.params.get('page')).toBe('2');
    request.flush({
      items: [{ Id_Reserva: 'MK-1', Fecha_Registro: null, Fecha_Tour: null, Id_Canal: 1,
        Id_Entidad_Reportante: 7, Nombre_Entidad_Reportante: 'Hotel Dann', Tipo_Entidad_Reportante: 'HOTEL',
        NombreReporta: 'Juan Pérez', Telefono: '3001234567', Categoria: 'HOTEL', CreadorId: null,
        UsuarioCreador: null, pasajeros: [] }],
      page: 2, pageSize: 25, totalPages: 2, totalReservas: 26, totalPasajeros: 26,
    });
    expect(result?.items[0]).toEqual(jasmine.objectContaining({
      Id_Entidad_Reportante: 7, Nombre_Entidad_Reportante: 'Hotel Dann',
      Tipo_Entidad_Reportante: 'HOTEL', NombreReporta: 'Juan Pérez',
    }));
  });

  it('consulta las entidades activas disponibles por los tres tipos admitidos', () => {
    let entities: MercadeoEntidadReportante[] | undefined;
    api.buscarEntidadesReportantes('Dann').subscribe((rows) => entities = rows);
    const requests = http.match((request) => request.url.endsWith('/entidades-reportantes'));
    expect(requests.length).toBe(3);
    expect(requests.map((request) => request.request.params.get('tipo')).sort()).toEqual([
      'AGENCIA_INTERNACIONAL', 'AGENCIA_NACIONAL', 'HOTEL',
    ]);
    for (const request of requests) {
      expect(request.request.params.get('buscar')).toBe('Dann');
      expect(request.request.params.get('limite')).toBe('20');
      request.flush([]);
    }
    expect(entities).toEqual([]);
  });
});
