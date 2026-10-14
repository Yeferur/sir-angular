import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { Historial, HistorialResponse, HistorialService } from '../../services/Historial/historial.service';
import { VerHistorialComponent } from './ver-historial';
import { SirAlertService } from '../../services/Alertas/alert.service';

describe('VerHistorialComponent', () => {
  let fixture: ComponentFixture<VerHistorialComponent>;
  let component: VerHistorialComponent;
  let queryParams: BehaviorSubject<ParamMap>;
  let service: jasmine.SpyObj<HistorialService>;
  let router: jasmine.SpyObj<Router>;

  const result: HistorialResponse = { data: [], total: 25, page: 1, limit: 10, totalPages: 3 };
  const options = {
    usuarios: [{ id: 3, label: 'Julieta' }, { id: 4, label: 'Yeferson' }],
    acciones: [{ value: 'LOGIN', label: 'Inicio de sesión' }, { value: 'CREAR_USUARIO', label: 'Creación de usuario' }],
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

  it('inicia sin consultar y muestra el estado listo con período vacío', () => {
    expect(service.getHistorial).not.toHaveBeenCalled();
    expect(component.draftFilters()).toEqual({ period: null, periodExplicit: false, referencia: '', usuarios: [], acciones: [], modulos: [] });
    expect(component.appliedFilters()).toEqual({ period: null, periodExplicit: false, referencia: '', usuarios: [], acciones: [], modulos: [] });
    expect(component.hasQueried()).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Listo para consultar');
    expect(fixture.nativeElement.textContent).toContain('Busca una reserva o transfer por código, o utiliza los filtros para consultar actividad del sistema.');
  });

  it('mantiene la búsqueda por código en la barra principal y el período vacío en filtros avanzados', () => {
    const primary = fixture.nativeElement.querySelector('.reservation-search-panel') as HTMLElement;
    expect(primary.querySelector('input.search-input')?.getAttribute('placeholder')).toBe('Buscar por código de reserva o transfer');
    expect(primary.querySelector('app-date-range-picker')).toBeNull();
    expect(primary.querySelector('.btn-filter svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(fixture.nativeElement.querySelector('.sir-select-search')).toBeNull();
    expect(fixture.nativeElement.querySelector('.results-heading .export-button i.bx-download')).toBeNull();
    component.toggleAdvancedFilters(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#historial-advanced-filters app-date-range-picker')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('#historial-advanced-filters .multi-filter-trigger').length).toBe(3);
    const picker = fixture.nativeElement.querySelector('#historial-advanced-filters app-date-range-picker') as HTMLElement;
    expect(picker.querySelector('.sir-range-trigger')?.textContent).toContain('Seleccionar período');
    expect(window.getComputedStyle(fixture.nativeElement.querySelector('.hist-filter-action')).order).toBe('3');
    expect(window.getComputedStyle(fixture.nativeElement.querySelector('.hist-filter-module')).order).toBe('4');
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

  it('mantiene separado el borrador hasta Buscar y sincroniza la consulta aplicada', async () => {
    component.toggleUser(3, true);
    component.toggleAction('LOGIN', true);
    component.onPeriodChange({ start: '2026-10-13', end: '2026-10-13' });
    expect(component.appliedFilters().usuarios).toEqual([]);
    expect(component.appliedGroupCount()).toBe(0);
    component.buscar();
    await Promise.resolve();
    expect(component.appliedFilters().usuarios).toEqual([3]);
    expect(component.appliedFilters().acciones).toEqual(['LOGIN']);
    expect(component.appliedGroupCount()).toBe(3);
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual({
      usuarios: [3], acciones: ['LOGIN'], modulos: [],
      referencia: undefined, fechaInicio: '2026-10-13', fechaFin: '2026-10-13', page: 1, limit: 10,
    });
    expect(router.navigate).toHaveBeenCalled();
  });

  it('restaura el período, multiselects y página desde query params', () => {
    queryParams.next(convertToParamMap({
      desde: '2026-10-01', hasta: '2026-10-13', usuarios: ['3', '4'],
      acciones: ['LOGIN', 'CREAR_USUARIO'], modulos: ['reservas'], page: '3',
    }));
    fixture.detectChanges();
    expect(component.appliedFilters()).toEqual({
      period: { start: '2026-10-01', end: '2026-10-13' }, periodExplicit: true, referencia: '', usuarios: [3, 4],
      acciones: ['LOGIN', 'CREAR_USUARIO'], modulos: ['reservas'],
    });
    expect(component.currentPage()).toBe(3);
    expect(service.getHistorial.calls.mostRecent().args[0].page).toBe(3);
  });

  it('formatea DATETIME de MySQL como hora de pared sin desplazar el día por timezone', () => {
    expect(component.formatTimestamp('2026-10-13 00:15:00')).toMatch(/13.*oct.*2026/);
  });

  it('quitar una pill actualiza también el borrador, reinicia página y conserva período', async () => {
    queryParams.next(convertToParamMap({ desde: '2026-10-01', hasta: '2026-10-13', usuarios: ['3'], page: '4' }));
    component.removeAppliedFilter('usuarios');
    await Promise.resolve();
    expect(component.appliedFilters().usuarios).toEqual([]);
    expect(component.draftFilters().usuarios).toEqual([]);
    expect(component.currentPage()).toBe(1);
    expect(service.getHistorial.calls.mostRecent().args[0].fechaInicio).toBe('2026-10-01');
    expect(service.getHistorial.calls.mostRecent().args[0].page).toBe(1);
  });

  it('limpiar filtros elimina también el período explícito y no consulta sin código ni período', async () => {
    queryParams.next(convertToParamMap({
      desde: '2026-09-29', hasta: '2026-10-13', usuarios: ['3'], acciones: ['LOGIN'], modulos: ['reservas'],
    }));
    const callsBefore = service.getHistorial.calls.count();
    component.limpiarFiltros();
    await Promise.resolve();
    expect(component.appliedFilters().periodExplicit).toBeFalse();
    expect(component.appliedFilters().usuarios).toEqual([]);
    expect(component.appliedFilters().acciones).toEqual([]);
    expect(component.appliedFilters().modulos).toEqual([]);
    expect(component.appliedFilters().period).toBeNull();
    expect(service.getHistorial.calls.count()).toBe(callsBefore);
  });

  it('cambiar de página preserva los filtros y exporta todos los filtros aplicados', async () => {
    queryParams.next(convertToParamMap({ desde: '2026-10-13', hasta: '2026-10-13', usuarios: ['4'], acciones: ['LOGIN'], modulos: ['reservas'] }));
    component.totalPages.set(3);
    component.goToPage(2);
    await Promise.resolve();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual({
      usuarios: [4], acciones: ['LOGIN'], modulos: ['reservas'],
      referencia: undefined, fechaInicio: '2026-10-13', fechaFin: '2026-10-13', page: 2, limit: 10,
    });
    component.totalRecords.set(21);
    component.exportarHistorial();
    expect(service.exportarHistorial.calls.mostRecent().args[0]).toEqual({
      usuarios: [4], acciones: ['LOGIN'], modulos: ['reservas'],
      referencia: undefined, fechaInicio: '2026-10-13', fechaFin: '2026-10-13', page: 1, limit: 10,
    });
  });

  it('buscar sin código ni período muestra la alerta informativa estándar y no consulta', () => {
    const alerts = TestBed.inject(SirAlertService);
    const showModal = spyOn(alerts, 'showModal').and.callThrough();
    component.toggleUser(3, true);
    const callsBefore = service.getHistorial.calls.count();
    component.buscar();
    fixture.detectChanges();
    expect(service.getHistorial.calls.count()).toBe(callsBefore);
    expect(component.errorMessage()).toBe('');
    expect(showModal).toHaveBeenCalledWith({ type: 'info', title: 'Sin filtros',
      message: 'Debes ingresar un código o seleccionar un período para buscar.' });
    expect(fixture.nativeElement.textContent).not.toContain('Ingresa un código o selecciona un período para consultar el historial.');
  });

  it('permite consultar un período explícito sin código', async () => {
    component.onPeriodChange({ start: '2026-10-01', end: '2026-10-13' });
    component.buscar();
    await Promise.resolve();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual({
      usuarios: [], acciones: [], modulos: [], referencia: undefined,
      fechaInicio: '2026-10-01', fechaFin: '2026-10-13', page: 1, limit: 10,
    });
  });

  it('Caso B: un código sin período explícito busca todo el historial', async () => {
    component.onReferenceInput('tg82673');
    component.buscar();
    await Promise.resolve();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual({
      usuarios: [], acciones: [], modulos: [], referencia: 'TG82673',
      fechaInicio: undefined, fechaFin: undefined, page: 1, limit: 10,
    });
  });

  it('Caso C: combina código con período modificado explícitamente', async () => {
    component.onReferenceInput('TG82673');
    component.onPeriodChange({ start: '2026-10-01', end: '2026-10-13' });
    component.buscar();
    await Promise.resolve();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual({
      usuarios: [], acciones: [], modulos: [], referencia: 'TG82673',
      fechaInicio: '2026-10-01', fechaFin: '2026-10-13', page: 1, limit: 10,
    });
    expect(router.navigate.calls.mostRecent().args[1]?.queryParams).toEqual(jasmine.objectContaining({
      referencia: 'TG82673', desde: '2026-10-01', hasta: '2026-10-13',
    }));
  });

  it('restaura un código sin rango como búsqueda ilimitada al recargar', () => {
    queryParams.next(convertToParamMap({ referencia: 'TRC76739' }));
    fixture.detectChanges();
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
      referencia: 'TRC76739', fechaInicio: undefined, fechaFin: undefined,
    }));
    expect(component.draftFilters().period).toBeNull();
  });

  it('restaura un período sin código y consulta con el rango de la URL', () => {
    queryParams.next(convertToParamMap({ desde: '2026-10-01', hasta: '2026-10-13' }));
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
      referencia: undefined, fechaInicio: '2026-10-01', fechaFin: '2026-10-13',
    }));
    expect(component.appliedFilters().periodExplicit).toBeTrue();
  });

  it('combina código y período cuando ambos se restauran desde la URL', () => {
    queryParams.next(convertToParamMap({ referencia: 'TG82673', desde: '2026-10-01', hasta: '2026-10-13' }));
    expect(service.getHistorial.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
      referencia: 'TG82673', fechaInicio: '2026-10-01', fechaFin: '2026-10-13',
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
