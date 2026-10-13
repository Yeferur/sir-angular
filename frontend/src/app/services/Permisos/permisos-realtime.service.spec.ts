import { computed, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PermisosService } from './permisos.service';

describe('PermisosService en tiempo real', () => {
  let service: PermisosService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem('user_permissions');
    localStorage.removeItem('user_role');
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PermisosService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem('user_permissions');
    localStorage.removeItem('user_role');
  });

  it('actualiza capacidades reactivas, rol y caché con la respuesta canónica', () => {
    const canReadMarketing = computed(() => service.tienePermiso('MERCADEO.RESERVAS.LEER'));
    expect(canReadMarketing()).toBeFalse();

    service.obtenerMisPermisos().subscribe();
    http.expectOne(req => req.url.endsWith('/me/permisos')).flush({
      role: 'Administrador', permisos: [{ codigo: 'MERCADEO.RESERVAS.LEER' }],
    });
    expect(canReadMarketing()).toBeTrue();
    expect(service.getRoleSnapshot()).toBe('Administrador');

    service.obtenerMisPermisos().subscribe();
    http.expectOne(req => req.url.endsWith('/me/permisos')).flush({ role: 'Asesor', permisos: [] });
    expect(canReadMarketing()).toBeFalse();
    expect(service.getRoleSnapshot()).toBe('Asesor');
    expect(localStorage.getItem('user_permissions')).toBe('[]');
  });
});
