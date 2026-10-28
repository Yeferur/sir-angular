import { provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEsCO from '@angular/common/locales/es-CO';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { ProgramacionDashboardService } from '../../../services/Programacion/programacion';
import { ListadoGeneralOptions, ListadoGeneralResult, ListadoGeneralService } from '../../../services/Programacion/listado-general.service';
import { ListadoGeneralComponent } from './listado-general';

registerLocaleData(localeEsCO);

const options: ListadoGeneralOptions = {
  tours: [{ Id_Tour: 1, Nombre_Tour: 'Coffee Tour', Activo: 1 }],
  rutas: [{ Ruta: 'Centro' }],
  canales: [{ Id_Canal: 2, Nombre_Canal: 'Web' }],
  estados: [{ value: 'CONFIRMADA', label: 'Confirmada' }],
};

const result: ListadoGeneralResult = {
  items: [{ Id_Reserva: 'COF1', Fecha_Tour: '2026-10-01', Nombre_Tour: 'Coffee Tour', Estado: 'Confirmada',
    Nombre_Canal: 'Web', Nombre_Reportante: 'Ana', NumeroPasajeros: 2, Rutas: 'Centro' }],
  totalReservas: 1,
  totalPasajeros: 2,
  limite: 100,
};

describe('ListadoGeneralComponent', () => {
  let fixture: ComponentFixture<ListadoGeneralComponent>;
  let component: ListadoGeneralComponent;
  let api: jasmine.SpyObj<ListadoGeneralService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ListadoGeneralService>('ListadoGeneralService', ['obtenerOpciones', 'consultar', 'exportar']);
    api.obtenerOpciones.and.returnValue(of(options));
    api.consultar.and.returnValue(of(result));
    const programacion = jasmine.createSpyObj<ProgramacionDashboardService>('ProgramacionDashboardService', [
      'obtenerTransfersDia', 'exportarTransfersDia',
    ]);

    await TestBed.configureTestingModule({
      imports: [ListadoGeneralComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ListadoGeneralService, useValue: api },
        { provide: ProgramacionDashboardService, useValue: programacion },
        { provide: SirAlertService, useValue: { successToast: jasmine.createSpy(), errorToast: jasmine.createSpy() } },
        { provide: PermisosService, useValue: { tienePermiso: () => true } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ListadoGeneralComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('usa el cascarón global de tabla y la nota global de detalle', () => {
    component.search();
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('.sir-results-heading')).not.toBeNull();
    expect(html.querySelector('.sir-data-table')).not.toBeNull();
    expect(html.querySelector('.sir-note')?.textContent).toContain('La tabla resume una fila por reserva');
  });

  it('muestra el número y las pills de filtros activos, y deja ancho suficiente para la fecha', () => {
    component.onExactTourDate('2026-10-01');
    component.setMultiFilter('tours', [1]);
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;
    expect(component.filterCount()).toBe(2);
    expect(html.querySelector('.sir-filter-count')?.textContent?.trim()).toBe('2');
    const pills = html.querySelector('.general-active-filters')?.textContent || '';
    expect(pills).toContain('Fecha del tour:');
    expect(pills).toContain('Tours: Coffee Tour');
    expect(getComputedStyle(html.querySelector('.general-exact-date') as HTMLElement).minWidth).toBe('250px');
  });
});
