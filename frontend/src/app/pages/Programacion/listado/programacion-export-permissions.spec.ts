import { provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import localeEsCo from '@angular/common/locales/es-CO';

import { Bus, Sugerencia } from '../../../interfaces/Programacion/reservas';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { SirDrawerService } from '../../../services/Drawer/drawer.service';
import {
  ProgramacionDashboardService,
  TransfersProgramacionResponse,
} from '../../../services/Programacion/programacion';
import { ProgramacionListadoPanelComponent } from '../../../components/programacion-listado-panel/programacion-listado-panel';
import { ProgramacionEditorComponent } from './programacion-editor';
import { ProgramacionPrivadosComponent } from './programacion-privados';
import { ProgramacionTransfersComponent } from './programacion-transfers';

registerLocaleData(localeEsCo);

const emptyTransfers: TransfersProgramacionResponse = {
  fecha: '2026-08-15',
  totalTransfers: 0,
  totalPasajeros: 0,
  totalServicios: 0,
  totalPendientes: 0,
  servicios: [],
  transfers: [],
};

const bus: Bus = {
  id: 'Bus 1',
  capacidad: 10,
  ocupados: 2,
  reservas: [],
  recorridoKm: 0,
};

const privateBus = {
  id: 'Vehículo 1',
  guia: 'Guía',
  capacidad: 10,
  ocupados: 2,
  indice: 1,
  totalBuses: 1,
  Id_Reserva_Privada: 'R-1',
  Nombre_Tour: 'Tour privado',
  persistido: true,
};

describe('permisos de exportación de Programación en la interfaz', () => {
  it('oculta y muestra las opciones del editor según canExport', async () => {
    await TestBed.configureTestingModule({
      imports: [ProgramacionEditorComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProgramacionEditorComponent);
    fixture.componentRef.setInput('plan', {
      combinacion: [],
      buses: [bus],
      costoTotalKm: 0,
      ocupacionPromedio: 20,
      totalBuses: 1,
      reservasSinAsignar: [],
    } satisfies Sugerencia);
    fixture.componentRef.setInput('activeBus', bus);
    fixture.componentRef.setInput('activeStops', []);
    fixture.componentRef.setInput('unassigned', []);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Exportar todos');
    expect(fixture.nativeElement.textContent).not.toContain('Exportar bus');

    fixture.componentRef.setInput('canExport', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Exportar todos');
    expect(fixture.nativeElement.textContent).toContain('Exportar bus');
  });

  it('oculta y muestra las exportaciones por reserva y masiva de privados', async () => {
    const service = jasmine.createSpyObj<ProgramacionDashboardService>(
      'ProgramacionDashboardService', ['exportarReservaPrivada', 'exportarPrivadosZip']
    );
    service.exportarReservaPrivada.and.returnValue(of(new Blob()));
    service.exportarPrivadosZip.and.returnValue(of(new Blob()));
    await TestBed.configureTestingModule({
      imports: [ProgramacionPrivadosComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ProgramacionDashboardService, useValue: service },
        { provide: SirAlertService, useValue: { showAlert: jasmine.createSpy(), confirmDecision: jasmine.createSpy() } },
        { provide: SirDrawerService, useValue: { isOpen: () => true, openReserva: jasmine.createSpy() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProgramacionPrivadosComponent);
    fixture.componentRef.setInput('operationDate', '2026-08-15');
    fixture.componentRef.setInput('buses', [privateBus]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Exportar todos');
    expect(fixture.nativeElement.textContent).not.toContain('Exportar reserva');
    fixture.componentInstance.exportAll();
    fixture.componentInstance.exportSelected(fixture.componentInstance.selectedGroup as any);
    expect(service.exportarPrivadosZip).not.toHaveBeenCalled();
    expect(service.exportarReservaPrivada).not.toHaveBeenCalled();

    fixture.componentRef.setInput('canExport', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Exportar todos');
    expect(fixture.nativeElement.textContent).toContain('Exportar reserva');
  });

  it('oculta y muestra el botón de exportación de transfers según canExport', async () => {
    await TestBed.configureTestingModule({
      imports: [ProgramacionTransfersComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProgramacionTransfersComponent);
    fixture.componentRef.setInput('operationDate', '2026-08-15');
    fixture.componentRef.setInput('data', emptyTransfers);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Exportar Excel');

    fixture.componentRef.setInput('canExport', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Exportar Excel');
  });

  it('oculta y muestra las opciones de exportación del drawer de listados guardados', async () => {
    await TestBed.configureTestingModule({
      imports: [ProgramacionListadoPanelComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    const drawer = TestBed.inject(SirDrawerService);
    drawer.openProgramacionListado({
      tourName: 'Tour de prueba',
      operationDate: '2026-08-15',
      buses: [bus],
      canEdit: false,
      canExport: false,
    });
    const fixture = TestBed.createComponent(ProgramacionListadoPanelComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Descargar bus');
    expect(fixture.nativeElement.textContent).not.toContain('Descargar todos');

    drawer.openProgramacionListado({
      tourName: 'Tour de prueba',
      operationDate: '2026-08-15',
      buses: [bus],
      canEdit: false,
      canExport: true,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Descargar bus');
    expect(fixture.nativeElement.textContent).toContain('Descargar todos');
  });
});
