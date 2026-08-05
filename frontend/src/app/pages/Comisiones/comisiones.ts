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
import { SirDrawerService } from '../../services/Drawer/drawer.service';

type FormaPagoPanel = FormaPagoComision | '';

interface PanelPagoState {
  visible: boolean;
  modoCola: boolean;
  cola: ComisionBeneficiario[];
  indiceCola: number;
  reportante: ComisionBeneficiario | null;
  reservas: ComisionReserva[];
  mostrarDatosPago: boolean;
  formaPago: FormaPagoPanel;
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
  private readonly drawer = inject(SirDrawerService);

  fecha = this.isoLocal(this.addDays(new Date(), -1));
  fechaMaxima = this.isoLocal(new Date());
  idTour = '';
  idCanal = '';
  filtroEstado: EstadoLiquidacion | '' = '';
  filtroLista = '';

  tours: any[] = [];
  canalesDisponibles: any[] = [];
  canales: ComisionCanal[] = [];
  catalogLoading = true;
  catalogError = '';
  hasSearched = false;
  isSearching = false;
  searchError = '';
  isExporting = false;
  estadoConfirmacion: EstadoConfirmacion | null = null;
  showAdvancedFilters = false;

  readonly panel: PanelPagoState = {
    visible: false,
    modoCola: false,
    cola: [],
    indiceCola: 0,
    reportante: null,
    reservas: [],
    mostrarDatosPago: false,
    formaPago: '',
    cuenta: '',
    guardarCentral: false,
    saving: false,
    touched: false,
  };

  private searchSubscription?: Subscription;
  private restoreSearchFromUrl = false;

  ngOnInit(): void {
    this.restoreSearchFromUrl = this.restoreFiltersFromQuery();
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
        if (this.restoreSearchFromUrl) {
          this.restoreSearchFromUrl = false;
          this.buscar(false);
        }
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
      estado: this.confirmacionService.getEstado(this.fecha, this.idTour || null).pipe(catchError(() => of(null))),
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
    this.idCanal = '';
    this.filtroEstado = '';
    this.showAdvancedFilters = false;
    this.syncFiltersToUrl(this.hasSearched);
    this.cdr.markForCheck();
  }

  actualizarFiltro(campo: 'fecha' | 'idTour' | 'idCanal' | 'filtroEstado', valor: string | number | null): void {
    const normalized = valor == null ? '' : String(valor);
    if (campo === 'filtroEstado') {
      this.filtroEstado = normalized === 'PENDIENTE' || normalized === 'PAGADO' ? normalized : '';
    } else {
      this[campo] = normalized;
    }
    this.syncFiltersToUrl(this.hasSearched);
  }

  actualizarBusquedaLocal(value: string): void {
    this.filtroLista = value;
    this.syncFiltersToUrl(this.hasSearched);
    this.cdr.markForCheck();
  }

  toggleAdvancedFilters(): void {
    this.showAdvancedFilters = !this.showAdvancedFilters;
    this.cdr.markForCheck();
  }

  get activeAdvancedFilters(): number {
    return Number(Boolean(this.idCanal)) + Number(Boolean(this.filtroEstado));
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
      this.alerts.successToast('Reporte exportado', 'El archivo conserva el detalle y no cambia el estado de pago.');
    } catch (error) {
      this.alerts.errorToast('No se pudo exportar', this.errorMessage(error, 'Intenta nuevamente.'));
    } finally {
      this.isExporting = false;
      this.cdr.markForCheck();
    }
  }

  abrirPagoBeneficiario(reportante: ComisionBeneficiario): void {
    const pendientes = this.reservasPendientesDe(reportante);
    if (!pendientes.length) return;
    this.panel.modoCola = false;
    this.panel.cola = [];
    this.panel.indiceCola = 0;
    this.cargarReportanteEnPanel(reportante, pendientes);
  }

  iniciarColaPagos(): void {
    const cola = this.canales
      .flatMap((canal) => canal.reportantes)
      .filter((reportante) => this.pendientesDe(reportante) > 0);
    if (!cola.length) return;
    this.panel.modoCola = true;
    this.panel.cola = cola;
    this.panel.indiceCola = 0;
    this.cargarReportanteEnPanel(cola[0], this.reservasPendientesDe(cola[0]));
  }

  private cargarReportanteEnPanel(reportante: ComisionBeneficiario, reservas: ComisionReserva[]): void {
    const forma = reportante.Forma_Pago || reservas[0]?.Forma_Pago || '';
    const cuenta = reportante.Cuenta_Bancaria || reservas[0]?.Cuenta_Bancaria || '';
    this.panel.visible = true;
    this.panel.reportante = reportante;
    this.panel.reservas = reservas;
    this.panel.formaPago = forma;
    this.panel.cuenta = cuenta;
    this.panel.mostrarDatosPago = Boolean(forma || cuenta || reportante.Centralizado);
    this.panel.guardarCentral = reportante.Centralizado;
    this.panel.saving = false;
    this.panel.touched = false;
    this.cdr.markForCheck();
  }

  cerrarPanel(): void {
    if (this.panel.saving) return;
    this.panel.visible = false;
    this.panel.modoCola = false;
    this.panel.cola = [];
    this.panel.indiceCola = 0;
    this.panel.reportante = null;
    this.panel.reservas = [];
    this.panel.mostrarDatosPago = false;
    this.panel.formaPago = '';
    this.panel.cuenta = '';
    this.panel.guardarCentral = false;
    this.panel.touched = false;
    this.cdr.markForCheck();
  }

  toggleDatosPago(): void {
    this.panel.mostrarDatosPago = !this.panel.mostrarDatosPago;
    this.cdr.markForCheck();
  }

  onFormaPagoChange(): void {
    this.panel.touched = true;
    if (!this.panelRequiereCuenta) this.panel.cuenta = '';
  }

  omitirPagoActual(): void {
    if (this.panel.saving) return;
    if (!this.panel.modoCola) {
      this.cerrarPanel();
      return;
    }
    this.avanzarCola();
  }

  async registrarPagoActual(): Promise<void> {
    if (!this.validarPanel()) return;
    await this.persistirPanel();
  }

  private async persistirPanel(): Promise<void> {
    const reportante = this.panel.reportante;
    if (!reportante || this.panel.saving) return;
    this.panel.saving = true;
    this.cdr.markForCheck();
    const ids = this.panel.reservas.map((reserva) => reserva.Id_Reserva);
    const forma = this.panel.formaPago || null;
    const cuenta = forma && this.panelRequiereCuenta && this.panel.cuenta.trim()
      ? this.panel.cuenta.trim()
      : null;

    try {
      if (this.panel.guardarCentral && forma) {
        const beneficiario = await firstValueFrom(this.comisionesService.guardarBeneficiario({
          Id_Beneficiario: reportante.Id_Beneficiario,
          Id_Canal: reportante.Id_Canal,
          Tipo_Beneficiario: reportante.Tipo_Beneficiario || this.inferirTipoBeneficiario(reportante.Id_Canal),
          Nombre: reportante.Nombre_Reportante,
          Telefono: reportante.Telefono,
          Forma_Pago: forma,
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
        Forma_Pago: forma,
        Cuenta_Bancaria: cuenta,
      };
      await firstValueFrom(this.comisionesService.actualizarLiquidacion({ ...payload, Estado: 'PAGADO' }));

      reportante.Forma_Pago = forma;
      reportante.Cuenta_Bancaria = cuenta;
      if (!reportante.Centralizado) reportante.Origen_Datos_Pago = forma ? 'HISTORICO' : 'SIN_DATOS';
      for (const reserva of this.panel.reservas) {
        reserva.Forma_Pago = forma;
        reserva.Cuenta_Bancaria = cuenta;
        reserva.Estado_Liquidacion = 'PAGADO';
        reserva.Fecha_Pago = this.fechaMaxima;
      }
      this.recalcularTotales();
      this.panel.saving = false;

      if (this.panel.modoCola) {
        this.avanzarCola(true);
      } else {
        this.alerts.successToast('Pago registrado', `Se registró el pago de ${reportante.Nombre_Reportante}.`);
        this.cerrarPanel();
      }
    } catch (error) {
      this.panel.saving = false;
      this.alerts.errorToast('No pudimos registrar el pago', this.errorMessage(error, 'Actualiza la consulta e inténtalo nuevamente.'));
      this.cdr.markForCheck();
    }
  }

  private avanzarCola(registroExitoso = false): void {
    const siguiente = this.panel.indiceCola + 1;
    if (siguiente >= this.panel.cola.length) {
      this.panel.saving = false;
      const mensaje = registroExitoso ? 'Terminaste de revisar los pagos pendientes.' : 'No quedan reportantes por revisar.';
      this.cerrarPanel();
      this.alerts.successToast('Revisión completada', mensaje);
      return;
    }
    this.panel.indiceCola = siguiente;
    const reportante = this.panel.cola[siguiente];
    this.cargarReportanteEnPanel(reportante, this.reservasPendientesDe(reportante));
  }

  async reabrirBeneficiario(reportante: ComisionBeneficiario): Promise<void> {
    const pagadas = reportante.reservas.filter((reserva) => reserva.Estado_Liquidacion === 'PAGADO');
    if (!pagadas.length) return;
    const accepted = await this.alerts.confirmDecision(
      'Volver a pendiente',
      `Las comisiones pagadas de ${reportante.Nombre_Reportante} volverán a quedar pendientes.`,
      { confirmText: 'Volver a pendiente', cancelText: 'Cancelar' },
    );
    if (!accepted) return;
    try {
      await firstValueFrom(this.comisionesService.actualizarLiquidacion({
        reservas: pagadas.map((reserva) => reserva.Id_Reserva),
        Estado: 'PENDIENTE',
        Forma_Pago: reportante.Forma_Pago,
        Cuenta_Bancaria: reportante.Cuenta_Bancaria,
      }));
      for (const reserva of pagadas) {
        reserva.Estado_Liquidacion = 'PENDIENTE';
        reserva.Fecha_Pago = null;
      }
      this.recalcularTotales();
      this.alerts.successToast('Comisiones pendientes', 'El reportante puede incluirse nuevamente en un pago.');
    } catch (error) {
      this.alerts.errorToast('No se pudo actualizar', this.errorMessage(error, 'Intenta nuevamente.'));
    }
  }

  verReserva(idReserva: string): void {
    this.drawer.openReserva(String(idReserva));
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.panel.visible) this.cerrarPanel();
  }

  get canalesVisibles(): ComisionCanal[] {
    const query = this.normalizarTexto(this.filtroLista);
    if (!query) return this.canales;
    return this.canales.map((canal) => {
      if (this.normalizarTexto(canal.Nombre_Canal).includes(query)) return canal;
      const reportantes = canal.reportantes.map((reportante) => {
        if (this.normalizarTexto(reportante.Nombre_Reportante).includes(query)) return reportante;
        const reservas = reportante.reservas.filter((reserva) =>
          this.normalizarTexto(`${reserva.Id_Reserva} ${reserva.Nombre_Tour}`).includes(query),
        );
        return reservas.length ? { ...reportante, reservas } : null;
      }).filter((reportante): reportante is ComisionBeneficiario => Boolean(reportante));
      return reportantes.length ? { ...canal, reportantes } : null;
    }).filter((canal): canal is ComisionCanal => Boolean(canal));
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
      (subtotal, rep) => subtotal + this.pendientesDe(rep), 0,
    ), 0);
  }

  get panelTotal(): number {
    return this.panel.reservas.reduce((sum, reserva) => sum + Number(reserva.Total_Comision || 0), 0);
  }

  get panelRequiereCuenta(): boolean {
    return this.requiereCuenta(this.panel.formaPago || null);
  }

  get panelError(): string {
    const forma = this.panel.formaPago || null;
    const cuenta = this.panel.cuenta.trim();
    if (!forma && cuenta) return 'Selecciona el medio de pago asociado a este número.';
    if (!forma || !cuenta) return '';
    if (forma === 'TRANSFERENCIA_BANCOLOMBIA' && !/^\d{11}$/.test(cuenta)) {
      return 'La cuenta Bancolombia debe tener exactamente 11 dígitos.';
    }
    if (forma === 'NEQUI' && !/^3\d{9}$/.test(cuenta)) {
      return 'El celular Nequi debe tener 10 dígitos e iniciar en 3.';
    }
    return '';
  }

  get centralizacionError(): string {
    if (!this.panel.guardarCentral) return '';
    if (!this.panel.formaPago) return 'Selecciona un medio de pago para guardar estos datos.';
    if (this.panelRequiereCuenta && !this.panel.cuenta.trim()) return 'Ingresa la cuenta antes de guardarla para próximas comisiones.';
    return this.panelError;
  }

  get panelCuentaLabel(): string {
    return this.panel.formaPago === 'NEQUI' ? 'Celular Nequi' : 'Número de cuenta';
  }

  get panelCuentaPlaceholder(): string {
    return this.panel.formaPago === 'NEQUI' ? 'Ej. 3001234567 (opcional)' : '11 dígitos (opcional)';
  }

  get pasoCola(): string {
    return `${this.panel.indiceCola + 1} de ${this.panel.cola.length}`;
  }

  pendientesDe(reportante: ComisionBeneficiario): number {
    return this.reservasPendientesDe(reportante).length;
  }

  etiquetaPago(forma: FormaPagoComision | null): string {
    if (forma === 'TRANSFERENCIA_BANCOLOMBIA') return 'Bancolombia';
    if (forma === 'NEQUI') return 'Nequi';
    if (forma === 'EFECTIVO') return 'Efectivo';
    return 'Sin datos de pago';
  }

  cuentaOculta(cuenta: string | null, forma: FormaPagoComision | null): string {
    if (forma === 'EFECTIVO') return 'Sin cuenta';
    if (!cuenta) return 'Cuenta no registrada';
    return `•••• ${String(cuenta).slice(-4)}`;
  }

  formatCOP(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  }

  textoCantidad(cantidad: number, singular: string, plural?: string): string {
    return `${cantidad} ${cantidad === 1 ? singular : (plural || `${singular}s`)}`;
  }

  trackBeneficiario(_: number, reportante: ComisionBeneficiario): string {
    return reportante.Key_Beneficiario;
  }

  private validarPanel(): boolean {
    this.panel.touched = true;
    const error = this.panelError || this.centralizacionError;
    if (error) {
      this.alerts.warningToast('Revisa los datos del pago', error);
      this.cdr.markForCheck();
      return false;
    }
    return Boolean(this.panel.reportante && this.panel.reservas.length);
  }

  private reservasPendientesDe(reportante: ComisionBeneficiario): ComisionReserva[] {
    return reportante.reservas.filter((reserva) => reserva.Estado_Liquidacion !== 'PAGADO');
  }

  private filtros(): FiltrosComisiones {
    return {
      Fecha: this.fecha,
      Id_Tour: this.idTour || undefined,
      Id_Canal: this.idCanal || undefined,
      Estado: this.filtroEstado,
    };
  }

  private restoreFiltersFromQuery(): boolean {
    const params = this.route.snapshot.queryParamMap;
    const fecha = String(params.get('fechaTour') || '').trim();
    const tour = Number(params.get('tour') || params.get('tours'));
    const canal = Number(params.get('canal'));
    const estado = String(params.get('estado') || '').toUpperCase();
    const hasValidFecha = /^\d{4}-\d{2}-\d{2}$/.test(fecha);
    if (hasValidFecha) this.fecha = fecha;
    if (Number.isInteger(tour) && tour > 0) this.idTour = String(tour);
    if (Number.isInteger(canal) && canal > 0) this.idCanal = String(canal);
    if (estado === 'PENDIENTE' || estado === 'PAGADO') this.filtroEstado = estado;
    this.filtroLista = String(params.get('q') || params.get('reportante') || '').trim();
    this.showAdvancedFilters = Boolean(this.idCanal || this.filtroEstado);
    return params.get('buscar') === '1' && hasValidFecha;
  }

  private syncFiltersToUrl(searchApplied: boolean): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        fechaTour: this.fecha || null,
        tour: this.idTour || null,
        tours: null,
        canal: this.idCanal || null,
        estado: this.filtroEstado || null,
        q: this.filtroLista.trim() || null,
        reportante: null,
        buscar: searchApplied ? 1 : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private requiereCuenta(forma: FormaPagoComision | null): boolean {
    return forma === 'TRANSFERENCIA_BANCOLOMBIA' || forma === 'NEQUI';
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

  private normalizarTexto(value: unknown): string {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
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
