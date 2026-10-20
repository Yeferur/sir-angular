import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ComisionesService, PerfilComisionEntidad, PerfilComisionEntidadPayload } from './comisiones.service';

describe('ComisionesService: modelo por entidad', () => {
  let service: ComisionesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ComisionesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta el perfil usando el id de entidad de la ruta real', () => {
    const expected: PerfilComisionEntidad = {
      Id_Perfil_Comision: 41,
      Id_Entidad_Reportante: 12,
      Tipo_Entidad: 'HOTEL',
      Nombre_Entidad: 'Hotel Dann Carlton',
      Forma_Pago: 'NEQUI',
      Numero_Cuenta: '3001234567',
      Nombre_Receptor: 'Hotel receptor',
      DNI_Receptor: 'NIT-1234',
      Activo: 1,
    };

    service.obtenerPerfilEntidad(12).subscribe(profile => expect(profile).toEqual(expected));
    const request = http.expectOne('/api/comisiones/perfiles-entidad/12');
    expect(request.request.method).toBe('GET');
    request.flush({ success: true, data: expected });
  });

  it('crea y actualiza perfiles mediante POST y PUT al recurso de entidad', () => {
    const payload: PerfilComisionEntidadPayload = {
      Id_Entidad_Reportante: 12,
      Forma_Pago: 'TRANSFERENCIA_BANCOLOMBIA',
      Numero_Cuenta: '12345678901',
      Nombre_Receptor: 'Hotel receptor',
      DNI_Receptor: 'NIT-1234',
    };
    const result = {
      Id_Perfil_Comision: 41,
      Id_Entidad_Reportante: 12,
      Tipo_Entidad: 'HOTEL',
      Nombre_Entidad: 'Hotel Dann Carlton',
      Forma_Pago: payload.Forma_Pago,
      Numero_Cuenta: payload.Numero_Cuenta,
      Nombre_Receptor: payload.Nombre_Receptor,
      DNI_Receptor: payload.DNI_Receptor,
      Activo: 1,
    };

    service.crearPerfilEntidad(payload).subscribe(profile => expect(profile.Id_Perfil_Comision).toBe(41));
    const create = http.expectOne('/api/comisiones/perfiles-entidad');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(payload);
    create.flush({ data: result });

    service.actualizarPerfilEntidad({ ...payload, Id_Perfil_Comision: 41 }).subscribe(profile => {
      expect(profile.Id_Entidad_Reportante).toBe(12);
    });
    const update = http.expectOne('/api/comisiones/perfiles-entidad');
    expect(update.request.method).toBe('PUT');
    expect(update.request.body.Id_Perfil_Comision).toBe(41);
    update.flush({ data: result });
  });

  it('adapta el contrato de grupos, elimina identificadores legacy y conserva el monto pagado', () => {
    let groups: any[] = [];
    service.listarComisiones({ Fecha: '2026-10-16' }).subscribe(channels => { groups = channels; });
    const request = http.expectOne(req => req.url === '/api/comisiones'
      && req.params.get('Fecha') === '2026-10-16');
    request.flush({ data: [{
      Id_Canal: 1,
      Nombre_Canal: 'HOTEL',
      Total_Canal: 12000,
      Pendiente_Canal: 0,
      Pagado_Canal: 9500,
      reportantes: [{
        Key_Beneficiario: 'wire-only',
        Id_Beneficiario: 7,
        Tipo_Beneficiario: 'HOTEL',
        Id_Entidad_Reportante: 12,
        Id_Perfil_Comision: 41,
        Tipo_Entidad: 'HOTEL',
        Nombre_Entidad: 'Hotel Dann Carlton',
        Nombre_Reportante: null,
        Forma_Pago: 'NEQUI',
        Total_Reportante: 12000,
        Pendiente_Reportante: 0,
        Pagado_Reportante: 9500,
        reservas: [{
          Id_Reserva: 'TG12345',
          Fecha_Tour: '2026-10-15',
          Nombre_Tour: 'Centro',
          Total_Comision: 12000,
          Monto_Comision_Pagada: '9500',
          Estado_Liquidacion: 'PAGADO',
        }],
      }],
    }] });

    expect(groups.length).toBe(1);
    expect(groups[0].grupos.length).toBe(1);
    expect(groups[0].grupos[0].Nombre_Entidad).toBe('Hotel Dann Carlton');
    expect('Id_Beneficiario' in groups[0].grupos[0]).toBeFalse();
    expect(groups[0].grupos[0].reservas[0].Monto_Comision_Pagada).toBe(9500);
  });
});
