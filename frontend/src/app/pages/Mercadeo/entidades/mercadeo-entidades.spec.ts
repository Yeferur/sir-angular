import { provideZonelessChangeDetection, signal } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEsCO from '@angular/common/locales/es-CO';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MercadeoEntidadesComponent } from './mercadeo-entidades';
import { EntidadesReportantesService, PaginaEntidades } from '../../../services/Mercadeo/entidades-reportantes.service';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { Reservas } from '../../../services/Reservas/reservas';
import { MercadeoService, MercadeoOrigenPage } from '../../../services/Mercadeo/mercadeo.service';
import { SirDrawerService } from '../../../services/Drawer/drawer.service';

registerLocaleData(localeEsCO);

const page: PaginaEntidades = {
  page: 1, pageSize: 25, totalPages: 1, total: 1,
  summary: { Total_Entidades: 1, Con_Reservas: 1, Sin_Reservas: 0,
    Con_Actividad: 1, Sin_Actividad: 0, Pendientes: 1, Total_Reservas: 2,
    Total_Transfers: 0, Total_Operaciones: 2, Total_Pasajeros: 3 },
  items: [{ Id_Entidad_Reportante: 7, Tipo: 'HOTEL', Nombre: 'Hotel Niño', Activo: 1,
    Estado_Validacion: 'PENDIENTE_VALIDACION', Fecha_Creacion: '2026-10-13', Reservas: 2,
    Transfers: 0, Operaciones: 2, Pasajeros: 3, Primera_Reserva: null, Ultima_Reserva: null,
    Dias_Sin_Reportar: null, Primera_Actividad: null, Ultima_Actividad: null, Ultimo_Reporte: '2026-10-13',
    Contacto_Reciente: 'Andrea' }],
  umbralDiasSinReportar: 90, ordenarPor: 'nombre', orden: 'ASC',
};

describe('MercadeoEntidadesComponent', () => {
  let fixture: ComponentFixture<MercadeoEntidadesComponent>;
  let component: MercadeoEntidadesComponent;
  let api: jasmine.SpyObj<EntidadesReportantesService>;
  let buscarPuntos: jasmine.Spy;
  let origenApi: jasmine.SpyObj<MercadeoService>;
  let drawer: jasmine.SpyObj<SirDrawerService>;
  const operationsPage: MercadeoOrigenPage = {
    items: [{ tipo: 'RESERVA', id_operacion: 'R-1', id_reserva: 'R-1', id_transfer: null,
      fecha_registro: '2026-10-13', fecha_servicio: '2026-10-20', id_canal: 1, canal: 'Hotel',
      id_entidad_reportante: 7, entidad: 'Hotel Niño', tipo_entidad: 'HOTEL', nombre_reportante: 'Andrea',
      telefono_reportante: '300', creador_id: 1, creador: 'Mercadeo', pasajeros: 2, estado: 'Pendiente',
      pendiente_por_entidad_en: null }],
    page: 1, pageSize: 10, totalPages: 1, totalOperaciones: 1, totalPasajeros: 2,
    totalPasajerosEnPagina: 2, tipo: 'TODOS',
  };

  beforeEach(async () => {
    api = jasmine.createSpyObj('EntidadesReportantesService', ['activity', 'search', 'detail', 'create',
      'update', 'validate', 'point', 'export']);
    api.activity.and.returnValue(of(page));
    api.search.and.returnValue(of([page.items[0]]));
    api.detail.and.returnValue(of({
      entity: { ...page.items[0], Creado_Por: 1, Creador: 'Mercadeo' },
      historic: { Reservas: 2, Transfers: 0, Operaciones: 2, Pasajeros: 3,
        Primera_Reserva: null, Ultima_Reserva: null, Dias_Sin_Reportar: null,
        Primera_Actividad: null, Ultima_Actividad: null },
      period: { Reservas: 2, Transfers: 0, Operaciones: 2, Pasajeros: 3 }, contacts: [{ Nombre: 'Andrea', Telefono: '300',
        Reservas: 2, Ultimo_Reporte: '2026-10-13' }],
      observed: [{ Id_Punto: 4, Nombre_Punto: '47 Street', Reservas: 2 }],
      associated: [{ Id_Punto: 5, Nombre_Punto: 'Hotel Niño', Estado_Validacion: 'VALIDADA' }],
    }));
    buscarPuntos = jasmine.createSpy('buscarPuntos').and.returnValue(of([]));
    origenApi = jasmine.createSpyObj<MercadeoService>('MercadeoService', ['buscarOrigen']);
    origenApi.buscarOrigen.and.returnValue(of(operationsPage));
    drawer = jasmine.createSpyObj<SirDrawerService>('SirDrawerService',
      ['openReserva', 'openTransfer', 'openEntityCreate', 'close'], { drawer: signal(null) });
    await TestBed.configureTestingModule({
      imports: [MercadeoEntidadesComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]),
        { provide: EntidadesReportantesService, useValue: api },
        { provide: Reservas, useValue: { buscarPuntos } },
        { provide: MercadeoService, useValue: origenApi },
        { provide: SirDrawerService, useValue: drawer },
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
    expect(html.textContent).toContain('Último reporte');
    expect(html.textContent).toContain('13 oct 2026');
  });

  it('consulta todas las entidades al entrar, sin fecha ni estado implícitos', () => {
    expect(component.filters().estado).toBe('');
    expect(component.filters().desde).toBe('');
    expect(component.filters().hasta).toBe('');
    expect(component.filterCount()).toBe(0);
    expect(api.activity.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
      desde: '', hasta: '', tipo: '', estado: '', buscar: '',
    }));
  });

  it('muestra el vacío de entidades solo cuando la consulta sin filtros no devuelve filas', async () => {
    api.activity.and.returnValue(of({ ...page, items: [], total: 0 }));
    await component.search();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('Sin entidades registradas');
    expect(html.querySelector('.entity-results-toolbar')).toBeNull();
    const create = html.querySelector<HTMLButtonElement>('app-query-empty-state .entity-empty-create');
    expect(create?.textContent).toContain('Nueva entidad');
    create?.click();
    expect(drawer.openEntityCreate).toHaveBeenCalled();
  });

  it('integra Nueva entidad en el resumen y mantiene las pills dentro del buscador', async () => {
    await fixture.whenStable();
    component.filterOpen.set(true);
    component.setFilter('tipo', 'HOTEL');
    await component.search();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(component.filterOpen()).toBeFalse();
    expect(html.querySelector('.entity-top-actions')).toBeNull();
    expect(html.querySelector('.entity-results-toolbar .entity-results-actions button.sir-action--primary')?.textContent).toContain('Nueva entidad');
    expect(html.querySelector('.reservation-search-panel .filter-token')?.textContent).toContain('Hotel');
    expect(html.querySelector('.reservation-search-button')?.textContent).toContain('Aplicar');
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

  it('mantiene Entidades en una ruta separada protegida por lectura o validación', async () => {
    const routes = await import('../../../app.routes').then(module => module.routes);
    const origin = routes.find(item => item.path === 'Mercadeo/Reservas');
    const entities = routes.find(item => item.path === 'Mercadeo/Entidades');
    expect(origin?.data?.['permiso']).toBe('MERCADEO.RESERVAS.LEER');
    expect(entities?.data?.['permisos']).toEqual(['ENTIDADES_REPORTANTES.LEER', 'ENTIDADES_REPORTANTES.VALIDAR']);
    expect(routes.some(item => item.path === 'Mercadeo')).toBeFalse();
  });

  it('carga operaciones solo al abrir el drawer, filtradas por entidad y período, y abre el detalle existente', async () => {
    expect(origenApi.buscarOrigen).not.toHaveBeenCalled();
    await component.open(page.items[0]);
    expect(api.detail).toHaveBeenCalled();
    expect(origenApi.buscarOrigen).toHaveBeenCalledWith(jasmine.objectContaining({
      idEntidadReportante: '7',
      fechaRegistroDesde: component.appliedFilters().desde,
      fechaRegistroHasta: component.appliedFilters().hasta,
    }), 1, 10);
    component.openOperation(operationsPage.items[0]);
    expect(drawer.openReserva).toHaveBeenCalledWith('R-1');
  });

  it('advierte un nombre normalizado existente y no lo crea de nuevo', async () => {
    component.startCreate();
    component.onCreateNameChange('HOTEL NINO');
    await new Promise(resolve => setTimeout(resolve, 300));
    fixture.detectChanges();
    expect(component.exactDuplicate?.Nombre).toBe('Hotel Niño');
    expect(drawer.openEntityCreate).toHaveBeenCalled();
    await component.save();
    expect(api.create).not.toHaveBeenCalled();
  });

});
