import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ComisionesGruposComponent } from './comisiones-grupos';
import { ComisionesGrupoDrawerComponent } from './comisiones-grupo-drawer';
import { ComisionesService, DetalleGrupoComision, GrupoComisionDia, PerfilComisionEntidad, ResultadoGruposComision } from '../../services/Comisiones/comisiones.service';
import { Reservas } from '../../services/Reservas/reservas';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { SirDrawerService } from '../../services/Drawer/drawer.service';

describe('Comisiones: pagos por entidad y día', () => {
  const group = (overrides: Partial<GrupoComisionDia> = {}): GrupoComisionDia => ({
    Id: 'e12~2026-10-15', Id_Entidad_Reportante: 12, Nombre_Entidad: 'Hotel Dann', Tipo_Entidad: 'HOTEL',
    Fecha_Tour: '2026-10-15', Estado: 'PENDIENTE', Cantidad_Reservas: 2, Cantidad_Reservas_Actuales: 2,
    Cantidad_Reservas_Pendientes: 2, Cantidad_Reservas_Pagadas: 0, Total_A_Comisionar: 35000,
    Monto_Pendiente: 35000, Monto_Pagado: 0, Tiene_Ajuste_Pendiente: false, Entidad_Inactiva: false,
    Entidad_Pendiente_Validacion: false, Estado_Validacion_Entidad: 'VALIDADA', Puede_Pagar: true,
    Motivo_No_Pagable: null, Ultimo_Id_Grupo_Pagado: null, Cantidad_Lotes: 0, Cantidad_Lotes_Pagados: 0,
    ...overrides,
  });

  const result = (rows: GrupoComisionDia[] = []): ResultadoGruposComision => ({
    grupos: rows,
    paginacion: { pagina: 1, limite: 25, total: rows.length, paginas: rows.length ? 1 : 0 },
    pendientesPorAsociarEntidad: { reservas: [], paginacion: { pagina: 1, limite: 25, total: 0, paginas: 0 } },
  });

  it('muestra el estado propio del ajuste y bloquea el pago indicando la jornada abierta', async () => {
    const list = jasmine.createSpy('listarGrupos').and.returnValue(of(result([group({
      Estado: 'PENDIENTE', Tiene_Ajuste_Pendiente: true, Cantidad_Reservas: 3,
      Cantidad_Reservas_Pendientes: 1, Cantidad_Reservas_Pagadas: 2, Monto_Pendiente: 8000,
      Puede_Pagar: false, Motivo_No_Pagable: 'JORNADA_NO_CERRADA',
    }), group({
      Id: 'e13~2026-10-16', Id_Entidad_Reportante: 13, Nombre_Entidad: 'Agencia Sur',
      Tipo_Entidad: 'AGENCIA_NACIONAL', Fecha_Tour: '2026-10-16',
      Entidad_Pendiente_Validacion: true, Estado_Validacion_Entidad: 'PENDIENTE_VALIDACION',
      Puede_Pagar: false, Motivo_No_Pagable: 'ENTIDAD_PENDIENTE_VALIDACION',
    })])));
    const drawer = { openComisionesGrupo: jasmine.createSpy('openComisionesGrupo') };
    await TestBed.configureTestingModule({
      imports: [ComisionesGruposComponent],
      providers: [
        provideZonelessChangeDetection(), provideRouter([]),
        { provide: ComisionesService, useValue: { listarGrupos: list } },
        { provide: Reservas, useValue: { getEntidadesReportantes: () => of([]) } },
        { provide: SirAlertService, useValue: { warningToast() {}, errorToast() {}, successToast() {} } },
        { provide: SirDrawerService, useValue: drawer },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ComisionesGruposComponent);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Con ajuste pendiente');
    expect(fixture.nativeElement.textContent).toContain('La jornada de Control de viaje no está cerrada.');
    expect(fixture.nativeElement.textContent).toContain('La entidad está pendiente de validación.');
    const pay = Array.from(fixture.nativeElement.querySelectorAll('button'))
      .find((button: any) => button.textContent.includes('Pagar ajuste')) as HTMLButtonElement;
    expect(pay.disabled).toBeTrue();
    expect(fixture.nativeElement.textContent.toLowerCase()).not.toContain('limpiar filtros');
    fixture.nativeElement.querySelector('.group-actions .button--secondary').click();
    expect(drawer.openComisionesGrupo).toHaveBeenCalledWith('e12~2026-10-15', false, jasmine.any(Object));
  });

  it('envía los filtros y recupera por página la sección de reservas sin entidad', async () => {
    const first = result([]);
    first.pendientesPorAsociarEntidad = {
      reservas: [{ Id_Reserva: 'R-1', Fecha_Tour: '2026-10-15', Tipo_Entidad: 'HOTEL', Nombre_Reportante: 'ZZ', Nombre_Tour: 'Centro', Cantidad_Pasajeros: 1, Monto_Comision: 4000 }],
      paginacion: { pagina: 1, limite: 25, total: 31, paginas: 2 },
    };
    const list = jasmine.createSpy('listarGrupos').and.returnValues(of(first), of(first));
    await TestBed.configureTestingModule({
      imports: [ComisionesGruposComponent],
      providers: [
        provideZonelessChangeDetection(), provideRouter([]),
        { provide: ComisionesService, useValue: { listarGrupos: list } },
        { provide: Reservas, useValue: { getEntidadesReportantes: () => of([]) } },
        { provide: SirAlertService, useValue: { warningToast() {}, errorToast() {}, successToast() {} } },
        { provide: SirDrawerService, useValue: { openComisionesGrupo() {} } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ComisionesGruposComponent);
    fixture.detectChanges();
    await Promise.resolve();
    const component = fixture.componentInstance;
    component.desde = '2026-10-01';
    component.hasta = '2026-10-20';
    component.entidad = '12';
    component.tipo = 'HOTEL';
    component.estado = 'PENDIENTE';
    component.busqueda = 'Hotel';
    component.applyFilters(2);
    await Promise.resolve();
    fixture.detectChanges();

    expect(list.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
      desde: '2026-10-01', hasta: '2026-10-20', Id_Entidad_Reportante: '12',
      Tipo: 'HOTEL', Estado: 'PENDIENTE', q: 'Hotel', page: 2, limit: 25, unlinkedPage: 1,
    }));
    expect(fixture.nativeElement.textContent).toContain('Pendientes por asociar entidad');
    expect(fixture.nativeElement.textContent).toContain('No entran en pagos');
  });

  it('recarga en un 409 y requiere una segunda acción con el total y cantidad nuevos', async () => {
    const initialGroup = group({ Cantidad_Reservas: 1, Cantidad_Reservas_Pendientes: 1, Total_A_Comisionar: 10000, Monto_Pendiente: 10000 });
    const changedGroup = group({ Cantidad_Reservas: 2, Cantidad_Reservas_Pendientes: 2, Total_A_Comisionar: 35000, Monto_Pendiente: 35000 });
    const detail: DetalleGrupoComision = {
      grupo: { Id: initialGroup.Id, Id_Entidad_Reportante: 12, Nombre_Entidad: 'Hotel Dann', Tipo_Entidad: 'HOTEL', Fecha_Tour: '2026-10-15', Entidad_Activa: true, Estado_Validacion: 'VALIDADA' },
      reservasPendientes: [{ Id_Reserva: 'R-1', Fecha_Tour: '2026-10-15', Nombre_Tour: 'Centro', Monto_Comision: 10000 }],
      paginacionReservasPendientes: { pagina: 1, limite: 25, total: 1, paginas: 1 }, lotes: [],
    };
    const service = {
      obtenerDetalleGrupo: jasmine.createSpy('obtenerDetalleGrupo').and.returnValue(of(detail)),
      obtenerPerfilEntidad: jasmine.createSpy('obtenerPerfilEntidad').and.returnValue(of(null)),
      listarGrupos: jasmine.createSpy('listarGrupos').and.returnValue(of(result([changedGroup]))),
      marcarGrupoPagado: jasmine.createSpy('marcarGrupoPagado').and.returnValues(
        throwError(() => ({ status: 409, error: { errorCode: 'GROUP_TOTAL_CHANGED' } })),
        of({ Id_Grupo_Comision: '700', Estado: 'PAGADO' }),
      ),
      actualizarPerfilEntidad: jasmine.createSpy('actualizarPerfilEntidad').and.returnValue(of(null)),
      crearPerfilEntidad: jasmine.createSpy('crearPerfilEntidad').and.returnValue(of(null)),
    };
    const alerts = { warningToast() {}, errorToast() {}, successToast: jasmine.createSpy('successToast') };
    await TestBed.configureTestingModule({
      imports: [ComisionesGrupoDrawerComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ComisionesService, useValue: service },
        { provide: SirAlertService, useValue: alerts },
        { provide: SirDrawerService, useValue: { openReserva() {}, close() {} } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ComisionesGrupoDrawerComponent);
    const component = fixture.componentInstance;
    component.groupId = initialGroup.Id;
    component.group = initialGroup;
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    await component.openPaymentDialog();
    component.paymentMethod = 'EFECTIVO';
    component.paymentRecipient = 'Contabilidad';
    component.paymentRecipientId = 'NIT-1234';

    await component.submitPayment();
    fixture.detectChanges();
    expect(service.marcarGrupoPagado.calls.argsFor(0)[1]).toEqual(jasmine.objectContaining({
      Monto_Pendiente_Esperado: 10000, Cantidad_Reservas_Pendientes_Esperada: 1,
    }));
    expect(component.showPaymentDialog).toBeTrue();
    expect(component.paymentConflict).toContain('confirma otra vez');
    expect(component.pendingTotal).toBe(35000);
    expect(component.pendingCount).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('35000');

    await component.submitPayment();
    expect(service.marcarGrupoPagado.calls.argsFor(1)[1]).toEqual(jasmine.objectContaining({
      Monto_Pendiente_Esperado: 35000, Cantidad_Reservas_Pendientes_Esperada: 2,
    }));
    expect(component.showPaymentDialog).toBeFalse();
  });

  it('mantiene el aviso de perfil dentro del drawer hasta guardar o descartar', async () => {
    const payableGroup = group({ Cantidad_Reservas: 1, Cantidad_Reservas_Pendientes: 1, Total_A_Comisionar: 10000, Monto_Pendiente: 10000 });
    const detail: DetalleGrupoComision = {
      grupo: { Id: payableGroup.Id, Id_Entidad_Reportante: 12, Nombre_Entidad: 'Hotel Dann', Tipo_Entidad: 'HOTEL', Fecha_Tour: '2026-10-15', Entidad_Activa: true, Estado_Validacion: 'VALIDADA' },
      reservasPendientes: [{ Id_Reserva: 'R-1', Fecha_Tour: '2026-10-15', Nombre_Tour: 'Centro', Monto_Comision: 10000 }],
      paginacionReservasPendientes: { pagina: 1, limite: 25, total: 1, paginas: 1 }, lotes: [],
    };
    const profile: PerfilComisionEntidad = {
      Id_Perfil_Comision: 42, Id_Entidad_Reportante: 12, Tipo_Entidad: 'HOTEL' as const,
      Nombre_Entidad: 'Hotel Dann', Forma_Pago: 'EFECTIVO' as const, Numero_Cuenta: null,
      Nombre_Receptor: 'Contabilidad', DNI_Receptor: 'NIT-1234', Activo: 1,
    };
    const service = {
      obtenerDetalleGrupo: jasmine.createSpy('obtenerDetalleGrupo').and.returnValue(of(detail)),
      obtenerPerfilEntidad: jasmine.createSpy('obtenerPerfilEntidad').and.returnValue(of(null)),
      listarGrupos: jasmine.createSpy('listarGrupos').and.returnValue(of(result([payableGroup]))),
      marcarGrupoPagado: jasmine.createSpy('marcarGrupoPagado').and.returnValue(of({ Id_Grupo_Comision: '701' })),
      actualizarPerfilEntidad: jasmine.createSpy('actualizarPerfilEntidad').and.returnValue(of(profile)),
      crearPerfilEntidad: jasmine.createSpy('crearPerfilEntidad').and.returnValues(
        throwError(() => new Error('No hay conexión')),
        of(profile),
      ),
      recordarPerfilPendiente: jasmine.createSpy('recordarPerfilPendiente'),
      olvidarPerfilPendiente: jasmine.createSpy('olvidarPerfilPendiente'),
      obtenerPerfilPendiente: jasmine.createSpy('obtenerPerfilPendiente').and.returnValue(null),
    };
    const alerts = { warningToast() {}, errorToast() {}, successToast: jasmine.createSpy('successToast') };
    await TestBed.configureTestingModule({
      imports: [ComisionesGrupoDrawerComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ComisionesService, useValue: service },
        { provide: SirAlertService, useValue: alerts },
        { provide: SirDrawerService, useValue: { openReserva() {}, close() {} } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ComisionesGrupoDrawerComponent);
    const component = fixture.componentInstance;
    component.groupId = payableGroup.Id;
    component.group = payableGroup;
    fixture.detectChanges();
    await Promise.resolve();
    await component.openPaymentDialog();
    component.paymentMethod = 'EFECTIVO';
    component.paymentRecipient = 'Contabilidad';
    component.paymentRecipientId = 'NIT-1234';
    component.saveProfile = true;

    await component.submitPayment();
    fixture.detectChanges();
    expect(component.profileSaveWarning).toContain('El pago quedó registrado');
    expect(fixture.nativeElement.querySelector('.profile-save-warning')).not.toBeNull();
    expect(service.recordarPerfilPendiente).toHaveBeenCalled();

    await component.retryProfileSave();
    fixture.detectChanges();
    expect(component.profileSaveWarning).toBe('');
    expect(fixture.nativeElement.querySelector('.profile-save-warning')).toBeNull();
    expect(service.olvidarPerfilPendiente).toHaveBeenCalledWith(12);
  });
});
