import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { Historial, HistorialResponse, HistorialService } from '../../services/Historial/historial.service';
import { VerHistorialComponent } from './ver-historial';

describe('VerHistorialComponent', () => {
  let fixture: ComponentFixture<VerHistorialComponent>;
  let component: VerHistorialComponent;
  let queryParams: BehaviorSubject<ParamMap>;
  let service: jasmine.SpyObj<HistorialService>;
  let router: jasmine.SpyObj<Router>;

  const result: HistorialResponse = { data: [], total: 25, page: 1, limit: 10, totalPages: 3 };
  const options = {
    usuarios: [{ id: 3, label: 'Julieta' }, { id: 4, label: 'Yeferson' }],
    acciones: [{ value: 'LOGIN', label: 'Inicio de sesión', actividad: 'accesos' },
      { value: 'CREAR_USUARIO', label: 'Creación de usuario', actividad: 'creaciones' }],
    actividades: [{ value: 'creaciones', label: 'Creaciones' }, { value: 'modificaciones', label: 'Modificaciones' },
      { value: 'cancelaciones', label: 'Cancelaciones y eliminaciones' }, { value: 'accesos', label: 'Accesos y sesiones' },
      { value: 'operacion', label: 'Asignaciones y operación' }, { value: 'validaciones', label: 'Validaciones y aprobaciones' },
      { value: 'otros', label: 'Otros' }],
    modulos: [{ value: 'reservas', label: 'Reservas' }],
  };

  beforeEach(async () => {
    queryParams = new BehaviorSubject(convertToParamMap({}));
    service = jasmine.createSpyObj<HistorialService>('HistorialService', ['getFilterOptions', 'getHistorial', 'exportarHistorial', 'descargarExcel']);
    service.getFilterOptions.and.returnValue(of(options));
    service.getHistorial.and.returnValue(of(result));
    service.exportarHistorial.and.returnValue(of(new Blob()));
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));

    await TestBed.configureTestingModule({
      imports: [VerHistorialComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParams.asObservable() } },
        { provide: Router, useValue: router },
        { provide: HistorialService, useValue: service },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(VerHistorialComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('consulta el día actual al entrar sin otros criterios', () => {
    const fecha = component.appliedFilters().fecha;
    expect(fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(component.draftFilters()).toEqual({ fecha, referencia: '', usuarios: [], actividad: [], modulos: [] });
    expect(component.hasQueried()).toBeTrue();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
      fechaInicio: fecha, fechaFin: fecha, page: 1, limit: 10,
    }));
    expect(fixture.nativeElement.textContent).not.toContain('Listo para consultar');
  });

  it('muestra la fecha única y la búsqueda por código en la barra principal', () => {
    const primary = fixture.nativeElement.querySelector('.reservation-search-panel') as HTMLElement;
    expect(primary.querySelector('input.search-input')?.getAttribute('placeholder')).toBe('Buscar por código de reserva o transfer');
    expect(primary.querySelector('app-datepicker')).not.toBeNull();
    expect(primary.querySelector('app-date-range-picker')).toBeNull();
    expect(primary.querySelector('.btn-filter svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(fixture.nativeElement.querySelector('.sir-select-search')).toBeNull();
    expect(fixture.nativeElement.querySelector('.results-heading .export-button i.bx-download')).not.toBeNull();
    component.toggleAdvancedFilters(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#historial-advanced-filters app-date-range-picker')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('#historial-advanced-filters .multi-filter-trigger').length).toBe(3);
    expect(window.getComputedStyle(fixture.nativeElement.querySelector('.hist-filter-action')).order).toBe('3');
    expect(window.getComputedStyle(fixture.nativeElement.querySelector('.hist-filter-module')).order).toBe('4');
    expect(fixture.nativeElement.querySelector('.hist-filter-action .form-label')?.textContent).toContain('Actividad');
    component.toggleDropdown('actividad'); fixture.detectChanges();
    const labels = Array.from(fixture.nativeElement.querySelectorAll('.hist-filter-action .multi-filter-option') as NodeListOf<HTMLElement>)
      .map((option) => option.textContent?.trim());
    expect(labels).toEqual(options.actividades.map((activity) => activity.label));
    expect(labels).not.toContain('Inicio de sesión');
  });

  it('no permite expandir un LOGIN sin detalles y no muestra controles de expansión', () => {
    const record: Historial = {
      Id_Historial: 10, Id_Usuario: 3, Usuario_Nombre: 'Julieta', Actor_Nombre: 'Julieta', Actor_Rol: 'Admin',
      Tipo_Accion: 'LOGIN', Descripcion: 'Inicio de sesión en Usuarios', Tabla_Afectada: 'sesiones',
      Modulo: 'Usuarios', Id_Registro: null, Fecha_Accion: '2026-10-13 10:53:00', Detalles: [],
    };
    component.hasQueried.set(true);
    component.historialList.set([record]);
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('tr.data-row') as HTMLTableRowElement;
    expect(row.hasAttribute('tabindex')).toBeFalse();
    expect(row.hasAttribute('aria-expanded')).toBeFalse();
    expect(row.querySelector('.expand-button')).toBeNull();

    row.click();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    fixture.detectChanges();

    expect(component.expandedId()).toBeNull();
    expect(fixture.nativeElement.querySelector('.detail-row')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('No hay detalle de campos disponible');
  });

  it('expande actualizaciones con detalles desde la fila, Enter, espacio y el botón', () => {
    const record: Historial = {
      Id_Historial: 11, Id_Usuario: 3, Usuario_Nombre: 'Julieta', Actor_Nombre: 'Julieta', Actor_Rol: 'Admin',
      Tipo_Accion: 'ACTUALIZAR', Descripcion: 'Actualización de usuario', Tabla_Afectada: 'usuarios',
      Modulo: 'Usuarios', Id_Registro: 3, Fecha_Accion: '2026-10-13 10:53:00',
      Detalles: [{ columna: 'Nombre', anterior: 'Julieta', nuevo: 'Julieta Pérez' }],
    };
    component.hasQueried.set(true);
    component.historialList.set([record]);
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('tr.data-row') as HTMLTableRowElement;
    const button = row.querySelector('.expand-button') as HTMLButtonElement;

    expect(row.getAttribute('tabindex')).toBe('0');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(button).not.toBeNull();

    row.click(); fixture.detectChanges();
    expect(component.expandedId()).toBe(11);
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); fixture.detectChanges();
    expect(component.expandedId()).toBeNull();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); fixture.detectChanges();
    expect(component.expandedId()).toBe(11);
    expect(fixture.nativeElement.querySelector('.detail-row')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.detail-meta').textContent).toContain('Actor:');
    expect(fixture.nativeElement.querySelector('.detail-meta').textContent).toContain('Rol al registrar:');
    expect(fixture.nativeElement.querySelector('.detail-meta').textContent).toContain('Referencia:');
    const detailHeaders = fixture.nativeElement.querySelectorAll('.detail-table thead th') as NodeListOf<HTMLElement>;
    expect(Array.from(detailHeaders).map((cell) => cell.textContent?.trim() ?? ''))
      .toEqual(['Campo', 'Anterior', 'Nuevo']);
    expect(fixture.nativeElement.querySelector('.detail-table tbody').textContent).toContain('Julieta Pérez');

    button.click(); fixture.detectChanges();
    expect(component.expandedId()).toBeNull();
    button.click(); fixture.detectChanges();
    expect(component.expandedId()).toBe(11);
  });

  it('finaliza los estados de carga cuando falla la consulta y muestra el error real', () => {
    service.getHistorial.and.returnValue(throwError(() => new Error('falló')));
    (component as any).loadHistorial();
    fixture.detectChanges();
    expect(component.isInitialLoading()).toBeFalse();
    expect(component.isTableRefreshing()).toBeFalse();
    expect(component.errorMessage()).toContain('No se pudo cargar');
  });

  it('mantiene separado el borrador hasta Aplicar y sincroniza la consulta aplicada', async () => {
    component.toggleAdvancedFilters();
    component.toggleUser(3, true);
    component.toggleActivity('accesos', true);
    component.onDateChange('2026-10-13');
    expect(component.appliedFilters().usuarios).toEqual([]);
    expect(component.appliedGroupCount()).toBe(0);
    component.buscar();
    await Promise.resolve();
    expect(component.advancedFiltersVisible()).toBeFalse();
    expect(component.appliedFilters().usuarios).toEqual([3]);
    expect(component.appliedFilters().actividad).toEqual(['accesos']);
    expect(component.appliedGroupCount()).toBe(2);
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual({
      usuarios: [3], actividad: ['accesos'], modulos: [],
      referencia: undefined, fechaInicio: '2026-10-13', fechaFin: '2026-10-13', page: 1, limit: 10,
    });
    expect(router.navigate).toHaveBeenCalled();
  });

  it('restaura la fecha, multiselects y página desde query params', () => {
    queryParams.next(convertToParamMap({
      fecha: '2026-10-01', usuarios: ['3', '4'],
      actividad: ['accesos', 'creaciones'], modulos: ['reservas'], page: '3',
    }));
    fixture.detectChanges();
    expect(component.appliedFilters()).toEqual({
      fecha: '2026-10-01', referencia: '', usuarios: [3, 4],
      actividad: ['accesos', 'creaciones'], modulos: ['reservas'],
    });
    expect(component.currentPage()).toBe(3);
    expect(service.getHistorial.calls.mostRecent().args[0].page).toBe(3);
  });

  it('selecciona varios tipos, muestra pills legibles y serializa solo IDs estables', async () => {
    queryParams.next(convertToParamMap({ desde: '2026-10-13', hasta: '2026-10-13', page: '3' }));
    component.toggleActivity('modificaciones', true);
    component.toggleActivity('creaciones', true);
    expect(component.appliedFilters().actividad).toEqual([]);
    component.buscar();
    await Promise.resolve();
    fixture.detectChanges();
    expect(component.currentPage()).toBe(1);
    expect(component.appliedGroupCount()).toBe(1);
    expect(component.pillLabel('actividad')).toBe('Actividad: Modificaciones, Creaciones');
    expect(service.getHistorial.calls.mostRecent().args[0].actividad).toEqual(['modificaciones', 'creaciones']);
    const params = router.navigate.calls.mostRecent().args[1]?.queryParams as Record<string, unknown>;
    expect(params['actividad']).toEqual(['modificaciones', 'creaciones']);
    expect(params['acciones']).toBeNull();
  });

  it('restaura URLs antiguas de acciones técnicas mediante el catálogo del servidor', () => {
    queryParams.next(convertToParamMap({ desde: '2026-10-13', hasta: '2026-10-13', acciones: ['LOGIN', 'CREAR_USUARIO', 'ACCION_HEREDADA'] }));
    expect(component.appliedFilters().actividad).toEqual(['accesos', 'creaciones', 'otros']);
    expect(service.getHistorial.calls.mostRecent().args[0].actividad).toEqual(['accesos', 'creaciones', 'otros']);
  });

  it('formatea DATETIME de MySQL como hora de pared sin desplazar el día por timezone', () => {
    expect(component.formatTimestamp('2026-10-13 00:15:00')).toMatch(/13.*oct.*2026/);
  });

  it('quitar una pill actualiza también el borrador, reinicia página y conserva la fecha', async () => {
    queryParams.next(convertToParamMap({ desde: '2026-10-01', hasta: '2026-10-13', usuarios: ['3'], page: '4' }));
    component.removeAppliedFilter('usuarios');
    await Promise.resolve();
    expect(component.appliedFilters().usuarios).toEqual([]);
    expect(component.draftFilters().usuarios).toEqual([]);
    expect(component.currentPage()).toBe(1);
    expect(service.getHistorial.calls.mostRecent().args[0].fechaInicio).toBe('2026-10-13');
    expect(service.getHistorial.calls.mostRecent().args[0].page).toBe(1);
  });

  it('limpiar filtros conserva la fecha y consulta el día completo', async () => {
    queryParams.next(convertToParamMap({
      desde: '2026-09-29', hasta: '2026-10-13', usuarios: ['3'], actividad: ['accesos'], modulos: ['reservas'],
    }));
    const callsBefore = service.getHistorial.calls.count();
    component.limpiarFiltros();
    await Promise.resolve();
    expect(component.appliedFilters().fecha).toBe('2026-10-13');
    expect(component.appliedFilters().usuarios).toEqual([]);
    expect(component.appliedFilters().actividad).toEqual([]);
    expect(component.appliedFilters().modulos).toEqual([]);
    expect(service.getHistorial.calls.count()).toBeGreaterThan(callsBefore);
  });

  it('cambiar de página preserva los filtros y exporta todos los filtros aplicados', async () => {
    queryParams.next(convertToParamMap({ desde: '2026-10-13', hasta: '2026-10-13', usuarios: ['4'], actividad: ['accesos'], modulos: ['reservas'] }));
    component.totalPages.set(3);
    component.goToPage(2);
    await Promise.resolve();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual({
      usuarios: [4], actividad: ['accesos'], modulos: ['reservas'],
      referencia: undefined, fechaInicio: '2026-10-13', fechaFin: '2026-10-13', page: 2, limit: 10,
    });
    component.totalRecords.set(21);
    component.exportarHistorial();
    expect(service.exportarHistorial.calls.mostRecent().args[0]).toEqual({
      usuarios: [4], actividad: ['accesos'], modulos: ['reservas'],
      referencia: undefined, fechaInicio: '2026-10-13', fechaFin: '2026-10-13', page: 1, limit: 10,
    });
  });

  it('Aplicar sin filtros adicionales vuelve a consultar la fecha seleccionada', async () => {
    const callsBefore = service.getHistorial.calls.count();
    component.buscar();
    await Promise.resolve();
    expect(service.getHistorial.calls.count()).toBeGreaterThan(callsBefore);
    expect(component.errorMessage()).toBe('');
  });

  it('permite consultar una fecha distinta sin código', async () => {
    component.onDateChange('2026-10-01');
    component.buscar();
    await Promise.resolve();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual({
      usuarios: [], actividad: [], modulos: [], referencia: undefined,
      fechaInicio: '2026-10-01', fechaFin: '2026-10-01', page: 1, limit: 10,
    });
  });

  for (const scenario of ([
    { name: 'usuario', apply: (target: VerHistorialComponent) => target.toggleUser(3, true), expected: { usuarios: [3], actividad: [], modulos: [] } },
    { name: 'actividad', apply: (target: VerHistorialComponent) => target.toggleActivity('modificaciones', true), expected: { usuarios: [], actividad: ['modificaciones'], modulos: [] } },
    { name: 'módulo', apply: (target: VerHistorialComponent) => target.toggleModule('reservas', true), expected: { usuarios: [], actividad: [], modulos: ['reservas'] } },
  ] as Array<{ name: string; apply: (target: VerHistorialComponent) => void; expected: { usuarios: number[]; actividad: string[]; modulos: string[] } }>)) {
    it(`consulta por ${scenario.name} dentro de la fecha activa`, async () => {
      scenario.apply(component);
      component.buscar();
      await Promise.resolve();
      expect(service.getHistorial.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
        ...scenario.expected, referencia: undefined,
        fechaInicio: component.appliedFilters().fecha, fechaFin: component.appliedFilters().fecha, page: 1,
      }));
    });
  }

  it('combina usuario con módulo y actividad con fecha mediante AND en la consulta', async () => {
    component.toggleUser(3, true);
    component.toggleModule('reservas', true);
    component.buscar();
    await Promise.resolve();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
      usuarios: [3], modulos: ['reservas'], fechaInicio: component.appliedFilters().fecha,
    }));
    component.setDraftUsers([]);
    component.setDraftModules([]);
    component.toggleActivity('modificaciones', true);
    component.onDateChange('2026-10-01');
    component.buscar();
    await Promise.resolve();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
      usuarios: [], modulos: [], actividad: ['modificaciones'], fechaInicio: '2026-10-01', fechaFin: '2026-10-01',
    }));
  });

  for (const scenario of ([
    { params: { usuarios: '3' }, expected: { usuarios: [3], actividad: [], modulos: [] } },
    { params: { actividad: 'modificaciones' }, expected: { usuarios: [], actividad: ['modificaciones'], modulos: [] } },
    { params: { modulos: 'reservas' }, expected: { usuarios: [], actividad: [], modulos: ['reservas'] } },
  ] as Array<{ params: Record<string, string>; expected: { usuarios: number[]; actividad: string[]; modulos: string[] } }>)) {
    it(`restaura y consulta URL con fecha implícita: ${Object.keys(scenario.params)[0]}`, () => {
      queryParams.next(convertToParamMap(scenario.params));
      expect(service.getHistorial.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
        ...scenario.expected, fechaInicio: component.appliedFilters().fecha, fechaFin: component.appliedFilters().fecha,
      }));
    });
  }

  it('muestra el loading local y bloquea consultas repetidas hasta completar la request', async () => {
    const pending = new Subject<HistorialResponse>();
    service.getHistorial.and.returnValue(pending.asObservable());
    component.toggleUser(3, true);
    component.buscar();
    await Promise.resolve();
    fixture.detectChanges();
    expect(component.isSearching()).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Buscando historial');
    expect(fixture.nativeElement.textContent).not.toContain('Listo para consultar');
    expect((fixture.nativeElement.querySelector('.reservation-search-button') as HTMLButtonElement).disabled).toBeTrue();
    component.buscar();
    expect(service.getHistorial.calls.count()).toBe(2);
    pending.next({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
    pending.complete();
    fixture.detectChanges();
    expect(component.isSearching()).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Sin resultados');
  });

  it('mantiene el loading local en una nueva consulta tras un resultado vacío y lo limpia al fallar', async () => {
    component.toggleUser(3, true);
    component.buscar();
    await Promise.resolve();
    const pending = new Subject<HistorialResponse>();
    service.getHistorial.and.returnValue(pending.asObservable());
    component.toggleActivity('modificaciones', true);
    component.buscar();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Buscando historial');
    expect(fixture.nativeElement.textContent).not.toContain('Sin resultados');
    pending.error(new Error('falló'));
    fixture.detectChanges();
    expect(component.isSearching()).toBeFalse();
    expect(fixture.nativeElement.querySelector('app-loading-state[mode="error"]')).not.toBeNull();
  });

  it('muestra el paginador compartido y conserva filtros al cambiar de página', async () => {
    const record: Historial = {
      Id_Historial: 1, Id_Usuario: 3, Usuario_Nombre: 'Julieta', Actor_Nombre: 'Julieta', Actor_Rol: null,
      Tipo_Accion: 'LOGIN', Descripcion: 'Inicio de sesión', Tabla_Afectada: 'sesiones', Modulo: 'Usuarios',
      Id_Registro: null, Fecha_Accion: '2026-10-13 10:00:00', Detalles: [],
    };
    service.getHistorial.and.returnValue(of({ data: [record], total: 24, page: 1, limit: 10, totalPages: 3 }));
    component.toggleUser(3, true);
    component.buscar();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.results-summary').textContent).toContain('24 registros');
    expect(fixture.nativeElement.querySelector('.results-summary').textContent).not.toContain('Página');
    expect(fixture.nativeElement.querySelector('.results-pagination .pagination-indicator').textContent).toContain('Página 1 de 3');
    expect((fixture.nativeElement.querySelector('.results-pagination .pagination-button') as HTMLButtonElement).disabled).toBeTrue();
    component.nextPage();
    await Promise.resolve();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ usuarios: [3], page: 2 }));
    component.buscar();
    await Promise.resolve();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ usuarios: [3], page: 1 }));
  });

  it('un código consulta dentro de la fecha seleccionada', async () => {
    component.onReferenceInput('tg82673');
    component.buscar();
    await Promise.resolve();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual({
      usuarios: [], actividad: [], modulos: [], referencia: 'TG82673',
      fechaInicio: component.appliedFilters().fecha, fechaFin: component.appliedFilters().fecha, page: 1, limit: 10,
    });
  });

  it('combina código con una fecha seleccionada', async () => {
    component.onReferenceInput('TG82673');
    component.onDateChange('2026-10-01');
    component.buscar();
    await Promise.resolve();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual({
      usuarios: [], actividad: [], modulos: [], referencia: 'TG82673',
      fechaInicio: '2026-10-01', fechaFin: '2026-10-01', page: 1, limit: 10,
    });
    expect(router.navigate.calls.mostRecent().args[1]?.queryParams).toEqual(jasmine.objectContaining({
      referencia: 'TG82673', fecha: '2026-10-01', desde: null, hasta: null,
    }));
  });

  it('restaura un código sin fecha usando el día actual', () => {
    queryParams.next(convertToParamMap({ referencia: 'TRC76739' }));
    fixture.detectChanges();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
      referencia: 'TRC76739', fechaInicio: component.appliedFilters().fecha, fechaFin: component.appliedFilters().fecha,
    }));
    expect(component.draftFilters().fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('normaliza una URL antigua con período a una fecha única', () => {
    queryParams.next(convertToParamMap({ desde: '2026-10-01', hasta: '2026-10-13' }));
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
      referencia: undefined, fechaInicio: '2026-10-13', fechaFin: '2026-10-13',
    }));
    expect(component.appliedFilters().fecha).toBe('2026-10-13');
  });

  it('combina código y fecha cuando ambos se restauran desde la URL', () => {
    queryParams.next(convertToParamMap({ referencia: 'TG82673', desde: '2026-10-01', hasta: '2026-10-13' }));
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
      referencia: 'TG82673', fechaInicio: '2026-10-13', fechaFin: '2026-10-13',
    }));
  });

  it('rechaza una búsqueda de texto que no tenga formato de código', () => {
    const callsBefore = service.getHistorial.calls.count();
    component.onReferenceInput('Julieta');
    component.buscar();
    expect(component.referenceInputError()).toContain('código válido');
    expect(service.getHistorial.calls.count()).toBe(callsBefore);
  });
});
