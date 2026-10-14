import { provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEsCO from '@angular/common/locales/es-CO';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MercadeoEntidadesComponent } from './mercadeo-entidades';
import { EntidadesReportantesService, PaginaEntidades } from '../../../services/Mercadeo/entidades-reportantes.service';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { Reservas } from '../../../services/Reservas/reservas';
import { routes } from '../../../app.routes';

registerLocaleData(localeEsCO);

const page: PaginaEntidades = {
  page: 1, pageSize: 25, totalPages: 1, total: 1,
  summary: { Total_Entidades: 1, Con_Reservas: 1, Sin_Reservas: 0,
    Pendientes: 1, Total_Reservas: 2, Total_Pasajeros: 3 },
  items: [{ Id_Entidad_Reportante: 7, Tipo: 'HOTEL', Nombre: 'Hotel Niño', Activo: 1,
    Estado_Validacion: 'PENDIENTE_VALIDACION', Fecha_Creacion: '2026-10-13', Reservas: 2,
    Pasajeros: 3, Primera_Actividad: '2026-10-01', Ultima_Actividad: '2026-10-13',
    Contacto_Reciente: 'Andrea' }],
};

describe('MercadeoEntidadesComponent', () => {
  let fixture: ComponentFixture<MercadeoEntidadesComponent>;
  let component: MercadeoEntidadesComponent;
  let api: jasmine.SpyObj<EntidadesReportantesService>;
  let buscarPuntos: jasmine.Spy;

  beforeEach(async () => {
    api = jasmine.createSpyObj('EntidadesReportantesService', ['activity', 'detail', 'create',
      'update', 'validate', 'point', 'export']);
    api.activity.and.returnValue(of(page));
    api.detail.and.returnValue(of({
      entity: { ...page.items[0], Creado_Por: 1, Creador: 'Mercadeo' },
      historic: { Reservas: 2, Pasajeros: 3, Primera_Actividad: '2026-10-01',
        Ultima_Actividad: '2026-10-13' },
      period: { Reservas: 2, Pasajeros: 3 }, contacts: [{ Nombre: 'Andrea', Telefono: '300',
        Reservas: 2, Ultimo_Reporte: '2026-10-13' }],
      observed: [{ Id_Punto: 4, Nombre_Punto: '47 Street', Reservas: 2 }],
      associated: [{ Id_Punto: 5, Nombre_Punto: 'Hotel Niño', Estado_Validacion: 'VALIDADA' }],
    }));
    buscarPuntos = jasmine.createSpy('buscarPuntos').and.returnValue(of([]));
    await TestBed.configureTestingModule({
      imports: [MercadeoEntidadesComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]),
        { provide: EntidadesReportantesService, useValue: api },
        { provide: Reservas, useValue: { buscarPuntos } },
        { provide: PermisosService, useValue: { tienePermiso: () => true } }],
    }).compileComponents();
    fixture = TestBed.createComponent(MercadeoEntidadesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('muestra resumen compacto y tarjeta móvil desde la misma página del servidor', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(api.activity).toHaveBeenCalled();
    expect(html.textContent).toContain('Hotel Niño');
    expect(html.textContent).toContain('1 con actividad');
    expect(html.querySelector('.entity-cards article')).not.toBeNull();
    expect(html.querySelector('h1')).toBeNull();
    expect(html.querySelector('.marketing-tabs')).toBeNull();
    expect(html.querySelector('.entity-summary')).toBeNull();
  });

  it('rechaza un rango mayor a 31 días y envía filtros completos', () => {
    component.setRange({ start: '2026-09-01', end: '2026-10-02' });
    expect(component.dateError()).toContain('31 días');
    const calls = api.activity.calls.count();
    component.search();
    expect(api.activity.calls.count()).toBe(calls);
    component.setRange({ start: '2026-10-13', end: '2026-10-13' });
    component.setFilter('tipo', 'HOTEL');
    component.search();
    expect(api.activity.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
      desde: '2026-10-13', hasta: '2026-10-13', tipo: 'HOTEL',
    }));
  });

  it('separa puntos observados de puntos asociados en el detalle', async () => {
    await component.open(page.items[0]);
    fixture.detectChanges();
    const html = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(html).toContain('Puntos observados en reservas');
    expect(html).toContain('47 Street');
    expect(html).toContain('Puntos asociados oficialmente');
  });

  it('protege la ruta de entidades con el permiso granular', () => {
    const route = routes.find(item => item.path === 'Mercadeo/Entidades');
    expect(route?.data?.['permiso']).toBe('ENTIDADES_REPORTANTES.LEER');
    expect(route?.canActivate).toBeTruthy();
  });

  it('advierte un nombre normalizado existente y no lo crea de nuevo', async () => {
    component.startCreate();
    component.onCreateNameChange('HOTEL NINO');
    await new Promise(resolve => setTimeout(resolve, 300));
    fixture.detectChanges();
    expect(component.exactDuplicate?.Nombre).toBe('Hotel Niño');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Ya existe Hotel Niño');
    await component.save();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('propone un punto para hotel y sólo lo asocia con elección expresa', async () => {
    const point = { Id_Punto: 42, NombrePunto: 'PROVENZA GARDEN' };
    api.activity.and.returnValue(of({ ...page, items: [], total: 0 }));
    buscarPuntos.and.returnValue(of([point]));
    api.create.and.returnValue(of({
      entity: { ...page.items[0], Creado_Por: 1, Creador: 'Mercadeo' },
      historic: { Reservas: 0, Pasajeros: 0, Primera_Actividad: null, Ultima_Actividad: null },
      period: { Reservas: 0, Pasajeros: 0 }, contacts: [], observed: [], associated: [],
    }));
    api.point.and.returnValue(of({}));
    component.startCreate();
    component.onCreateNameChange('Provenza');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(component.createPointSuggestions()[0].Id_Punto).toBe(42);
    component.usePoint(point);
    expect(component.name).toBe('Provenza Garden');
    await component.save();
    expect(api.point).not.toHaveBeenCalled();

    component.startCreate();
    component.usePoint(point);
    component.associateCreatePoint.set(true);
    await component.save();
    expect(api.point).toHaveBeenCalledWith(7, 42, true);
  });
});
