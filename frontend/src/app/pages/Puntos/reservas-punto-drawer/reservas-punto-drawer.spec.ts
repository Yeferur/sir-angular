import { registerLocaleData } from '@angular/common';
import localeEsCO from '@angular/common/locales/es-CO';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { puntosService, ReservasPuntoPage } from '../../../services/Puntos/puntos';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { ReservasPuntoDrawerComponent } from './reservas-punto-drawer';

describe('Reservas asociadas a punto', () => {
  registerLocaleData(localeEsCO);
  let fixture: ComponentFixture<ReservasPuntoDrawerComponent>;
  let component: ReservasPuntoDrawerComponent;
  let api: jasmine.SpyObj<puntosService>;
  let canExport = signal(true);
  const page: ReservasPuntoPage = { data: [{ Id_Reserva: 'RSV1', Fecha_Tour: '2026-10-14',
    Nombre_Tour: 'City Tour', Pasajeros: 2, Estado: 'Confirmada' }], total: 26, page: 1, limit: 25,
    totalPages: 2 };

  beforeEach(async () => {
    canExport = signal(true);
    api = jasmine.createSpyObj<puntosService>('puntosService',
      ['getEstadosReservasPuntos', 'getReservasPunto', 'exportarReservasPunto']);
    api.getEstadosReservasPuntos.and.returnValue(of(['Pendiente', 'Confirmada', 'Completada', 'Cancelada']));
    api.getReservasPunto.and.returnValue(of(page));
    api.exportarReservasPunto.and.returnValue(of(new Blob(['excel'])));
    await TestBed.configureTestingModule({
      imports: [ReservasPuntoDrawerComponent],
      providers: [provideZonelessChangeDetection(),
        { provide: puntosService, useValue: api },
        { provide: PermisosService, useValue: { tienePermiso: (code: string) =>
          code === 'PUNTOS.RESERVAS.EXPORTAR' && canExport() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ReservasPuntoDrawerComponent);
    component = fixture.componentInstance;
    component.puntoId = '12';
    component.puntoNombre = 'Estación Poblado';
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('inicia en hoy sin consultar y aplica filtros solo al pulsar Buscar', () => {
    expect(api.getReservasPunto).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Estación Poblado');
    expect(fixture.nativeElement.textContent).toContain('Listo para consultar');
    expect(component.estadoOptions().map(option => option.label)).toEqual([
      'Todos los estados', 'Pendiente', 'Confirmada', 'Completada', 'Cancelada',
    ]);
    const today = component.draftRange().start!;
    expect(component.draftRange().end).toBe(today);
    component.draftEstado.set('Pendiente');
    component.buscar();
    expect(api.getReservasPunto).toHaveBeenCalledWith(12,
      { desde: today, hasta: today, estado: 'Pendiente' }, 1, 25);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('RSV1');
  });

  it('muestra solo loading local al buscar por primera vez y solo empty state sin datos', () => {
    const pending = new Subject<ReservasPuntoPage>();
    api.getReservasPunto.and.returnValue(pending.asObservable());
    component.buscar();
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('.reservation-search-button') as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
    expect(button.textContent?.trim()).toBe('Buscar');
    expect(fixture.nativeElement.querySelector('.btn-spinner')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Consultando reservas asociadas');
    expect(fixture.nativeElement.textContent).not.toContain('Actualizando');
    pending.next({ data: [], total: 0, page: 1, limit: 25, totalPages: 1 });
    pending.complete();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sin reservas asociadas');
    expect(fixture.nativeElement.textContent).not.toContain('0 reservas');
    expect(fixture.nativeElement.querySelector('.point-reservations__export')).toBeNull();
    component.exportar();
    expect(api.exportarReservasPunto).not.toHaveBeenCalled();
  });

  it('mantiene resultados durante carga, pagina con filtros aplicados y evita duplicados', () => {
    component.buscar();
    const pending = new Subject<ReservasPuntoPage>();
    api.getReservasPunto.and.returnValue(pending.asObservable());
    component.draftEstado.set('Pendiente');
    component.buscar(2);
    fixture.detectChanges();
    expect(component.loading()).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('RSV1');
    expect(fixture.nativeElement.textContent).toContain('Actualizando');
    expect(fixture.nativeElement.textContent).not.toContain('Consultando reservas asociadas');
    expect(fixture.nativeElement.querySelector('.btn-spinner')).toBeNull();
    const count = api.getReservasPunto.calls.count();
    component.buscar(2);
    expect(api.getReservasPunto.calls.count()).toBe(count);
    expect(api.getReservasPunto.calls.mostRecent().args[1].estado).toBe('');
    pending.next({ ...page, page: 2 });
    pending.complete();
    expect(component.loading()).toBeFalse();
  });

  it('oculta exportación sin permiso y usa exactamente filtros aplicados al exportar', () => {
    component.buscar();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.point-reservations__export')?.textContent).toContain('Exportar Excel');
    canExport.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.point-reservations__export')).toBeNull();
    canExport.set(true);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:test');
    spyOn(URL, 'revokeObjectURL');
    spyOn(HTMLAnchorElement.prototype, 'click');
    component.draftEstado.set('Pendiente');
    component.exportar();
    expect(api.exportarReservasPunto).toHaveBeenCalledWith(12, component.applied()!);
    expect(api.exportarReservasPunto.calls.mostRecent().args[1].estado).toBe('');
  });
});
