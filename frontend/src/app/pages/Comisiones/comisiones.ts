import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, catchError, finalize, firstValueFrom, forkJoin, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ComisionBeneficiario,
  ComisionCanal,
  ComisionReserva,
  ComisionesService,
  EstadoLiquidacion,
  FiltrosComisiones,
  FormaPagoComision,
  GrupoPagoComision,
  TipoBeneficiario,
} from '../../services/Comisiones/comisiones.service';
import { Tours } from '../../services/Tours/tours';
import { Reservas } from '../../services/Reservas/reservas';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';
import { ConfirmacionService, EstadoConfirmacion, JornadaConfirmacion } from '../../services/confirmacion.service';
import { PermisosService } from '../../services/Permisos/permisos.service';

interface PanelPagoState {
  visible: boolean;
  reportante: ComisionBeneficiario | null;
  reservas: ComisionReserva[];
  formaPago: FormaPagoComision;
  cuenta: string;
  guardarCentral: boolean;
  saving: boolean;
  touched: boolean;
}

@Component({
  selector: 'app-comisiones',
  standalone: true,
  imports: [CommonModule, FormsModule, DatepickerComponent, LoadingStateComponent],
  templateUrl: './comisiones.html',
  styleUrl: './comisiones.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComisionesComponent implements OnInit {
  private readonly comisionesService = inject(ComisionesService);
  private readonly toursService = inject(Tours);
  private readonly reservasService = inject(Reservas);
  private readonly alerts = inject(SirAlertService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly confirmacionService = inject(ConfirmacionService);
  private readonly permisosService = inject(PermisosService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  fecha = this.isoLocal(this.addDays(new Date(), -1));
  fechaMaxima = this.isoLocal(new Date());
  idTour = '';
  idCanal = '';
  filtroEstado: EstadoLiquidacion | '' = '';
  filtroReportante = '';

  tours: any[] = [];
  canalesDisponibles: any[] = [];
  canales: ComisionCanal[] = [];
  catalogLoading = true;
  catalogError = '';
  hasSearched = false;
  isSearching = false;
  searchError = '';
  isExporting = false;
  isSavingGlobal = false;
  estadoConfirmacion: EstadoConfirmacion | null = null;

  readonly panel: PanelPagoState = {
    visible: false,
    reportante: null,
    reservas: [],
    formaPago: 'TRANSFERENCIA_BANCOLOMBIA',
    cuenta: '',
    guardarCentral: false,
    saving: false,
    touched: false,
  };

  private searchSubscription?: Subscription;
  private readonly collapsedChannels = new Set<number>();
  private readonly expandedBeneficiaries = new Set<string>();
  private readonly expandedReservations = new Set<string>();

  ngOnInit(): void {
    this.restoreFiltersFromQuery();
    this.cargarCatalogos();
  }

  cargarCatalogos(): void {
    this.catalogLoading = true;
    this.catalogError = '';
    forkJoin({
      tours: this.toursService.getTours(),
      canales: this.reservasService.getCanales(),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ tours, canales }) => {
        this.tours = tours || [];
        this.canalesDisponibles = (canales || []).filter(
          (canal: any) => canal?.Tiene_Comision !== false && Number(canal?.Tiene_Comision) !== 0,
        );
        this.catalogLoading = false;
        this.buscar();
        this.cdr.markForCheck();
      },
      error: () => {
        this.catalogLoading = false;
        this.catalogError = 'No pudimos cargar los tours y canales disponibles.';
        this.cdr.markForCheck();
      },
    });
  }

  buscar(preserveResults = true): void {
    if (!this.fecha || this.isSearching) return;
    this.searchSubscription?.unsubscribe();
    this.hasSearched = true;
    this.isSearching = true;
    this.searchError = '';
    if (!preserveResults) this.canales = [];
    this.cerrarPanel();

    this.syncFiltersToUrl(true);
    this.searchSubscription = forkJoin({
      canales: this.comisionesService.listarComisiones(this.filtros()),
      estado: this.confirmacionService.getEstado(this.fecha, this.idTour || null).pipe(
        catchError(() => of(null)),
      ),
    }).pipe(
      finalize(() => {
        this.isSearching = false;
        this.cdr.markForCheck();
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: ({ canales, estado }) => {
        this.canales = canales || [];
        this.estadoConfirmacion = estado;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.searchError = this.errorMessage(error, 'No pudimos cargar las comisiones.');
        this.cdr.markForCheck();
      },
    });
  }

  limpiarFiltros(): void {
    this.fecha = this.isoLocal(this.addDays(new Date(), -1));
    this.idTour = '';
    this.idCanal = '';
    this.filtroEstado = '';
    this.filtroReportante = '';
    this.buscar();
  }

  get jornadasPorConfirmar(): JornadaConfirmacion[] {
    if (this.filtroEstado === 'PAGADO') return [];
    return this.estadoConfirmacion?.jornadas?.filter(
      (jornada) => jornada.Requiere_Confirmacion && jornada.Total_Comisionables > 0,
    ) || [];
  }

  get pasajerosPorConfirmar(): number {
    return this.jornadasPorConfirmar.reduce((total, jornada) => total + jornada.Total_Comisionables, 0);
  }

  get canOpenConfirmation(): boolean {
    return this.permisosService.tienePermiso('CONTROL_VIAJE.LEER');
  }

  irAConfirmacion(): void {
    if (!this.canOpenConfirmation || !this.fecha || !this.jornadasPorConfirmar.length) return;
    const targetTour = this.idTour || (this.jornadasPorConfirmar.length === 1
      ? String(this.jornadasPorConfirmar[0].Id_Tour)
      : '');
    void this.router.navigate(['/Reservas/Confirmacion'], {
      queryParams: {
        fechaTour: this.fecha,
        tour: targetTour || null,
        buscar: targetTour ? 1 : null,
        origen: 'comisiones',
        origenCanal: this.idCanal || null,
        origenEstado: this.filtroEstado || null,
        origenReportante: this.filtroReportante.trim() || null,
      },
    });
  }

  async exportar(): Promise<void> {
    if (!this.fecha || this.isExporting) return;
    this.isExporting = true;
    this.cdr.markForCheck();
    try {
      const blob = await firstValueFrom(this.comisionesService.exportarExcel(this.filtros()));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Comisiones_${this.fecha}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      this.alerts.successToast('Reporte exportado', 'El archivo conserva el detalle por pasajero y no cambia el estado de pago.');
    } catch (error) {
      this.alerts.errorToast('No se pudo exportar', this.errorMessage(error, 'Intenta nuevamente.'));
    } finally {
      this.isExporting = false;
      this.cdr.markForCheck();
    }
  }

  abrirPagoReserva(reserva: ComisionReserva, reportante: ComisionBeneficiario): void {
    this.abrirPanel(reportante, [reserva]);
  }

  abrirPagoBeneficiario(reportante: ComisionBeneficiario): void {
    const pendientes = reportante.reservas.filter((reserva) => reserva.Estado_Liquidacion !== 'PAGADO');
    if (pendientes.length) this.abrirPanel(reportante, pendientes);
  }

  private abrirPanel(reportante: ComisionBeneficiario, reservas: ComisionReserva[]): void {
    const forma = reportante.Forma_Pago || reservas[0]?.Forma_Pago || 'TRANSFERENCIA_BANCOLOMBIA';
    this.panel.visible = true;
    this.panel.reportante = reportante;
    this.panel.reservas = reservas;
    this.panel.formaPago = forma;
    this.panel.cuenta = reportante.Cuenta_Bancaria || reservas[0]?.Cuenta_Bancaria || '';
    this.panel.guardarCentral = reportante.Centralizado;
    this.panel.saving = false;
    this.panel.touched = false;
    this.cdr.markForCheck();
  }

  cerrarPanel(): void {
    if (this.panel.saving) return;
    this.panel.visible = false;
    this.panel.reportante = null;
    this.panel.reservas = [];
    this.panel.cuenta = '';
    this.panel.touched = false;
    this.cdr.markForCheck();
  }

  onFormaPagoChange(): void {
    this.panel.touched = true;
    if (!this.panelRequiereCuenta) this.panel.cuenta = '';
  }

  async guardarDatosPago(): Promise<void> {
    if (!this.validarPanel()) return;
    await this.persistirPanel(false);
  }

  async confirmarPago(): Promise<void> {
    if (!this.validarPanel()) return;
    const accepted = await this.alerts.confirmDecision(
      this.panel.reservas.length === 1 ? 'Registrar pago' : 'Registrar pagos',
      `Se marcarán ${this.panel.reservas.length} reserva(s) como pagadas por ${this.formatCOP(this.panelTotal)}.`,
      { confirmText: 'Registrar pago', cancelText: 'Volver' },
    );
    if (accepted) await this.persistirPanel(true);
  }

  private async persistirPanel(markAsPaid: boolean): Promise<void> {
    const reportante = this.panel.reportante;
    if (!reportante || this.panel.saving) return;
    this.panel.saving = true;
    this.cdr.markForCheck();
    const ids = this.panel.reservas.map((reserva) => reserva.Id_Reserva);
    const cuenta = this.panelRequiereCuenta ? this.panel.cuenta.trim() : null;

    try {
      if (this.panel.guardarCentral || reportante.Centralizado) {
        const beneficiario = await firstValueFrom(this.comisionesService.guardarBeneficiario({
          Id_Beneficiario: reportante.Id_Beneficiario,
          Id_Canal: reportante.Id_Canal,
          Tipo_Beneficiario: reportante.Tipo_Beneficiario || this.inferirTipoBeneficiario(reportante.Id_Canal),
          Nombre: reportante.Nombre_Reportante,
          Telefono: reportante.Telefono,
          Forma_Pago: this.panel.formaPago,
          Numero_Cuenta: cuenta,
          reservas: ids,
        }));
        reportante.Id_Beneficiario = Number(beneficiario.Id_Beneficiario);
        reportante.Centralizado = true;
        reportante.Tipo_Beneficiario = beneficiario.Tipo_Beneficiario;
        reportante.Origen_Datos_Pago = 'CENTRALIZADO';
      }

      const payload: GrupoPagoComision = {
        reservas: ids,
        Forma_Pago: this.panel.formaPago,
        Cuenta_Bancaria: cuenta,
      };
      if (markAsPaid) {
        await firstValueFrom(this.comisionesService.actualizarLiquidacion({ ...payload, Estado: 'PAGADO' }));
      } else {
        await firstValueFrom(this.comisionesService.actualizarDatosPago(payload));
      }

      reportante.Forma_Pago = this.panel.formaPago;
      reportante.Cuenta_Bancaria = cuenta;
      if (!reportante.Centralizado) reportante.Origen_Datos_Pago = 'HISTORICO';
      for (const reserva of this.panel.reservas) {
        reserva.Forma_Pago = this.panel.formaPago;
        reserva.Cuenta_Bancaria = cuenta;
        if (markAsPaid) {
          reserva.Estado_Liquidacion = 'PAGADO';
          reserva.Fecha_Pago = this.fechaMaxima;
        }
      }
      this.recalcularTotales();
      this.alerts.successToast(
        markAsPaid ? 'Pago registrado' : 'Datos guardados',
        markAsPaid ? 'La liquidación quedó actualizada.' : 'No se modificó el estado de las comisiones.',
      );
      this.panel.saving = false;
      this.cerrarPanel();
    } catch (error) {
      this.panel.saving = false;
      this.alerts.errorToast('No pudimos completar la acción', this.errorMessage(error, 'Actualiza la consulta e inténtalo nuevamente.'));
      this.cdr.markForCheck();
    }
  }

  async pagarTodo(): Promise<void> {
    if (this.isSavingGlobal) return;
    const targets = this.canales.flatMap((canal) => canal.reportantes)
      .map((reportante) => ({
        reportante,
        reservas: reportante.reservas.filter((reserva) => reserva.Estado_Liquidacion !== 'PAGADO'),
      }))
      .filter((target) => target.reservas.length);
    if (!targets.length) return;

    const invalid = targets.find(({ reportante }) => this.errorPago(reportante.Forma_Pago, reportante.Cuenta_Bancaria));
    if (invalid) {
      this.expandedBeneficiaries.add(invalid.reportante.Key_Beneficiario);
      this.alerts.warningToast(
        'Faltan datos de pago',
        `Completa primero los datos de ${invalid.reportante.Nombre_Reportante}.`,
      );
      this.abrirPagoBeneficiario(invalid.reportante);
      return;
    }

    const count = targets.reduce((total, target) => total + target.reservas.length, 0);
    const accepted = await this.alerts.confirmDecision(
      'Registrar todos los pagos visibles',
      `Se marcarán ${count} reservas como pagadas por ${this.formatCOP(this.totalPendiente)}. Esta acción usa exactamente los filtros actuales.`,
      { confirmText: 'Registrar todo', cancelText: 'Cancelar' },
    );
    if (!accepted) return;

    this.isSavingGlobal = true;
    this.cdr.markForCheck();
    try {
      await firstValueFrom(this.comisionesService.actualizarLiquidacionesLote({
        Estado: 'PAGADO',
        pagos: targets.map(({ reportante, reservas }) => ({
          reservas: reservas.map((reserva) => reserva.Id_Reserva),
          Forma_Pago: reportante.Forma_Pago!,
          Cuenta_Bancaria: this.requiereCuenta(reportante.Forma_Pago) ? reportante.Cuenta_Bancaria : null,
        })),
      }));
      for (const target of targets) {
        for (const reserva of target.reservas) {
          reserva.Estado_Liquidacion = 'PAGADO';
          reserva.Fecha_Pago = this.fechaMaxima;
        }
      }
      this.recalcularTotales();
      this.alerts.successToast('Pagos registrados', `${count} reservas quedaron marcadas como pagadas.`);
    } catch (error) {
      this.alerts.errorToast('No se registraron los pagos', this.errorMessage(error, 'Ningún cambio del lote fue aplicado.'));
    } finally {
      this.isSavingGlobal = false;
      this.cdr.markForCheck();
    }
  }

  async reabrirReserva(reserva: ComisionReserva, reportante: ComisionBeneficiario): Promise<void> {
    const accepted = await this.alerts.confirmDecision(
      'Volver a pendiente',
      `La reserva ${reserva.Id_Reserva} volverá a quedar disponible para pago.`,
      { confirmText: 'Volver a pendiente', cancelText: 'Cancelar' },
    );
    if (!accepted) return;
    try {
      await firstValueFrom(this.comisionesService.actualizarLiquidacion({
        reservas: [reserva.Id_Reserva],
        Estado: 'PENDIENTE',
        Forma_Pago: reserva.Forma_Pago || reportante.Forma_Pago || 'EFECTIVO',
        Cuenta_Bancaria: reserva.Cuenta_Bancaria || reportante.Cuenta_Bancaria,
      }));
      reserva.Estado_Liquidacion = 'PENDIENTE';
      reserva.Fecha_Pago = null;
      this.recalcularTotales();
      this.alerts.successToast('Comisión pendiente', 'La reserva puede incluirse nuevamente en un pago.');
    } catch (error) {
      this.alerts.errorToast('No se pudo actualizar', this.errorMessage(error, 'Intenta nuevamente.'));
    }
  }

  toggleCanal(idCanal: number): void {
    this.collapsedChannels.has(idCanal) ? this.collapsedChannels.delete(idCanal) : this.collapsedChannels.add(idCanal);
  }

  canalColapsado(idCanal: number): boolean {
    return this.collapsedChannels.has(idCanal);
  }

  toggleBeneficiario(key: string): void {
    this.expandedBeneficiaries.has(key) ? this.expandedBeneficiaries.delete(key) : this.expandedBeneficiaries.add(key);
  }

  beneficiarioExpandido(key: string): boolean {
    return this.expandedBeneficiaries.has(key);
  }

  toggleReserva(idReserva: string): void {
    this.expandedReservations.has(idReserva) ? this.expandedReservations.delete(idReserva) : this.expandedReservations.add(idReserva);
  }

  reservaExpandida(idReserva: string): boolean {
    return this.expandedReservations.has(idReserva);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.panel.visible) this.cerrarPanel();
  }

  get totalReservas(): number {
    return this.canales.reduce((sum, canal) => sum + canal.reportantes.reduce((subtotal, rep) => subtotal + rep.reservas.length, 0), 0);
  }

  get totalPasajeros(): number {
    return this.canales.reduce((sum, canal) => sum + canal.reportantes.reduce(
      (subtotal, rep) => subtotal + rep.reservas.reduce((count, reserva) => count + reserva.Num_Pasajeros, 0), 0,
    ), 0);
  }

  get totalBeneficiarios(): number {
    return this.canales.reduce((sum, canal) => sum + canal.reportantes.length, 0);
  }

  get totalGlobal(): number {
    return this.canales.reduce((sum, canal) => sum + Number(canal.Total_Canal || 0), 0);
  }

  get totalPendiente(): number {
    return this.canales.reduce((sum, canal) => sum + Number(canal.Pendiente_Canal || 0), 0);
  }

  get totalPagado(): number {
    return this.canales.reduce((sum, canal) => sum + Number(canal.Pagado_Canal || 0), 0);
  }

  get reservasPendientes(): number {
    return this.canales.reduce((sum, canal) => sum + canal.reportantes.reduce(
      (subtotal, rep) => subtotal + rep.reservas.filter((reserva) => reserva.Estado_Liquidacion !== 'PAGADO').length, 0,
    ), 0);
  }

  get panelTotal(): number {
    return this.panel.reservas.reduce((sum, reserva) => sum + Number(reserva.Total_Comision || 0), 0);
  }

  get panelRequiereCuenta(): boolean {
    return this.requiereCuenta(this.panel.formaPago);
  }

  get panelError(): string {
    return this.errorPago(this.panel.formaPago, this.panel.cuenta);
  }

  get panelCuentaLabel(): string {
    return this.panel.formaPago === 'NEQUI' ? 'Celular Nequi' : 'Número de cuenta';
  }

  get panelCuentaPlaceholder(): string {
    return this.panel.formaPago === 'NEQUI' ? 'Ej. 3001234567' : '11 dígitos';
  }

  pendientesDe(reportante: ComisionBeneficiario): number {
    return reportante.reservas.filter((reserva) => reserva.Estado_Liquidacion !== 'PAGADO').length;
  }

  etiquetaPago(forma: FormaPagoComision | null): string {
    if (forma === 'TRANSFERENCIA_BANCOLOMBIA') return 'Bancolombia';
    if (forma === 'NEQUI') return 'Nequi';
    if (forma === 'EFECTIVO') return 'Efectivo';
    return 'Sin datos de pago';
  }

  cuentaOculta(cuenta: string | null, forma: FormaPagoComision | null): string {
    if (forma === 'EFECTIVO') return 'Sin número';
    if (!cuenta) return 'Completar datos';
    return `•••• ${String(cuenta).slice(-4)}`;
  }

  formatCOP(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  }

  trackBeneficiario(_: number, reportante: ComisionBeneficiario): string {
    return reportante.Key_Beneficiario;
  }

  private validarPanel(): boolean {
    this.panel.touched = true;
    const error = this.panelError;
    if (error) {
      this.alerts.warningToast('Revisa los datos de pago', error);
      this.cdr.markForCheck();
      return false;
    }
    return Boolean(this.panel.reportante && this.panel.reservas.length);
  }

  private filtros(): FiltrosComisiones {
    return {
      Fecha: this.fecha,
      Id_Tour: this.idTour || undefined,
      Id_Canal: this.idCanal || undefined,
      Estado: this.filtroEstado,
      Nombre_Reportante: this.filtroReportante.trim() || undefined,
    };
  }

  private restoreFiltersFromQuery(): void {
    const params = this.route.snapshot.queryParamMap;
    const fecha = String(params.get('fechaTour') || '').trim();
    const tour = Number(params.get('tour'));
    const canal = Number(params.get('canal'));
    const estado = String(params.get('estado') || '').toUpperCase();
    if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) this.fecha = fecha;
    if (Number.isInteger(tour) && tour > 0) this.idTour = String(tour);
    if (Number.isInteger(canal) && canal > 0) this.idCanal = String(canal);
    if (estado === 'PENDIENTE' || estado === 'PAGADO') this.filtroEstado = estado;
    this.filtroReportante = String(params.get('reportante') || '').trim();
  }

  private syncFiltersToUrl(searchApplied: boolean): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        fechaTour: this.fecha || null,
        tour: this.idTour || null,
        canal: this.idCanal || null,
        estado: this.filtroEstado || null,
        reportante: this.filtroReportante.trim() || null,
        buscar: searchApplied ? 1 : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private requiereCuenta(forma: FormaPagoComision | null): boolean {
    return forma === 'TRANSFERENCIA_BANCOLOMBIA' || forma === 'NEQUI';
  }

  private errorPago(forma: FormaPagoComision | null, cuenta: string | null): string {
    if (!forma) return 'Selecciona Bancolombia, Nequi o efectivo.';
    const value = String(cuenta || '').trim();
    if (forma === 'TRANSFERENCIA_BANCOLOMBIA' && !/^\d{11}$/.test(value)) {
      return 'La cuenta Bancolombia debe tener exactamente 11 dígitos.';
    }
    if (forma === 'NEQUI' && !/^3\d{9}$/.test(value)) {
      return 'El celular Nequi debe tener 10 dígitos e iniciar en 3.';
    }
    return '';
  }

  private inferirTipoBeneficiario(idCanal: number): TipoBeneficiario {
    const nombre = String(this.canalesDisponibles.find((canal) => Number(canal.Id_Canal) === idCanal)?.Nombre_Canal || '').toUpperCase();
    if (nombre.includes('HOTEL')) return 'HOTEL';
    if (nombre.includes('AGENCIA')) return 'AGENCIA';
    return 'FREELANCE';
  }

  private recalcularTotales(): void {
    for (const canal of this.canales) {
      canal.Total_Canal = 0;
      canal.Pendiente_Canal = 0;
      canal.Pagado_Canal = 0;
      for (const reportante of canal.reportantes) {
        reportante.Total_Reportante = reportante.reservas.reduce((sum, reserva) => sum + Number(reserva.Total_Comision || 0), 0);
        reportante.Pendiente_Reportante = reportante.reservas
          .filter((reserva) => reserva.Estado_Liquidacion !== 'PAGADO')
          .reduce((sum, reserva) => sum + Number(reserva.Total_Comision || 0), 0);
        reportante.Pagado_Reportante = reportante.Total_Reportante - reportante.Pendiente_Reportante;
        canal.Total_Canal += reportante.Total_Reportante;
        canal.Pendiente_Canal += reportante.Pendiente_Reportante;
        canal.Pagado_Canal += reportante.Pagado_Reportante;
      }
    }
    this.cdr.markForCheck();
  }

  private errorMessage(error: any, fallback: string): string {
    return error?.error?.message || error?.error?.error || error?.message || fallback;
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  private isoLocal(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}
