import { SirSelectComponent, SirSelectOption, compareSelectValuesAsStrings } from '../../shared/select/select';
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
  ComisionCanal,
  ComisionGrupo,
  ComisionReserva,
  ComisionesService,
  EstadoLiquidacion,
  FiltrosComisiones,
  FormaPagoComision,
  GrupoPagoComision,
  PerfilComisionEntidad,
} from '../../services/Comisiones/comisiones.service';
import { Tours } from '../../services/Tours/tours';
import { Reservas } from '../../services/Reservas/reservas';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { SirFilterBarComponent } from '../../shared/filter-bar/filter-bar';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';
import { QueryEmptyStateComponent } from '../../shared/query-empty-state/query-empty-state';
import { ConfirmacionService, EstadoConfirmacion, JornadaConfirmacion } from '../../services/confirmacion.service';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirDrawerService } from '../../services/Drawer/drawer.service';
import { DrawerCloseButtonComponent } from '../../shared/drawer-close-button/drawer-close-button';
import { ComisionesGruposComponent } from './comisiones-grupos';

type FormaPagoPanel = FormaPagoComision | '';

interface CommissionFilterState {
  fecha: string;
  idTour: string;
  idCanal: string;
  filtroEstado: EstadoLiquidacion | '';
}

interface PanelPagoState {
  visible: boolean;
  modoCola: boolean;
  cola: ComisionGrupo[];
  indiceCola: number;
  grupo: ComisionGrupo | null;
  reservas: ComisionReserva[];
  mostrarDatosPago: boolean;
  formaPago: FormaPagoPanel;
  cuenta: string;
  nombreReceptor: string;
  dniReceptor: string;
  guardarPerfil: boolean;
  perfilExiste: boolean;
  perfilCargando: boolean;
  perfilError: string;
  saving: boolean;
  touched: boolean;
}

@Component({
  selector: 'app-comisiones',
  standalone: true,
  imports: [ComisionesGruposComponent, SirSelectComponent, SirFilterBarComponent, CommonModule, FormsModule, DatepickerComponent,
    LoadingStateComponent, QueryEmptyStateComponent, DrawerCloseButtonComponent],
  templateUrl: './comisiones.html',
  styleUrl: './comisiones.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComisionesComponent implements OnInit {
  readonly compareSelectValues = compareSelectValuesAsStrings;

  private tourSelectOptionsCache?: { source: readonly any[]; options: SirSelectOption[] };
  get tourSelectOptions(): SirSelectOption[] {
    const source = this.tours;
    if (this.tourSelectOptionsCache?.source !== source) {
      this.tourSelectOptionsCache = { source, options: [{ value: "", label: "Todos los tours" },
      ...(this.tours || []).map((tour: any) => ({ value: String(tour.Id_Tour), label: String(tour.Nombre_Tour) }))] };
    }
    return this.tourSelectOptionsCache.options;
  }

  private canalSelectOptionsCache?: { source: readonly any[]; options: SirSelectOption[] };
  get canalSelectOptions(): SirSelectOption[] {
    const source = this.canalesDisponibles;
    if (this.canalSelectOptionsCache?.source !== source) {
      this.canalSelectOptionsCache = { source, options: [{ value: "", label: "Todos los canales" },
      ...(this.canalesDisponibles || []).map((canal: any) => ({ value: String(canal.Id_Canal), label: String(canal.Nombre_Canal) }))] };
    }
    return this.canalSelectOptionsCache.options;
  }

  readonly estadoSelectOptions: SirSelectOption[] = [{ value: "", label: "Todos los estados" },
      { value: "PENDIENTE", label: "Pendientes" },
      { value: "PAGADO", label: "Pagadas" }];

  readonly formaPagoSelectOptions: SirSelectOption[] = [{ value: "", label: "Sin especificar" },
      { value: "TRANSFERENCIA_BANCOLOMBIA", label: "Bancolombia" },
      { value: "NEQUI", label: "Nequi" },
      { value: "EFECTIVO", label: "Efectivo" }];

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
  appliedFilters: CommissionFilterState | null = null;
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
    grupo: null,
    reservas: [],
    mostrarDatosPago: false,
    formaPago: '',
    cuenta: '',
    nombreReceptor: '',
    dniReceptor: '',
    guardarPerfil: false,
    perfilExiste: false,
    perfilCargando: false,
    perfilError: '',
    saving: false,
    touched: false,
  };

  private searchSubscription?: Subscription;
  private restoreSearchFromUrl = false;
  private perfilRequestVersion = 0;

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
    this.runSearch(this.draftFilterSnapshot(), preserveResults);
  }

  private runSearch(filters: CommissionFilterState, preserveResults = true): void {
    if (!filters.fecha || this.isSearching) return;
    this.searchSubscription?.unsubscribe();
    this.hasSearched = true;
    this.isSearching = true;
    this.searchError = '';
    if (!preserveResults) this.canales = [];
    this.cerrarPanel();
    this.showAdvancedFilters = false;

    this.searchSubscription = forkJoin({
      canales: this.comisionesService.listarComisiones(this.filtros(filters)),
      estado: this.confirmacionService.getEstado(filters.fecha, filters.idTour || null).pipe(catchError(() => of(null))),
    }).pipe(
      finalize(() => {
        this.isSearching = false;
        this.cdr.markForCheck();
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: ({ canales, estado }) => {
        this.appliedFilters = { ...filters };
        this.canales = (canales || []).map((canal) => {
          const grupos = (canal.grupos || []).filter((grupo) => !grupo.Id_Entidad_Reportante);
          return {
            ...canal,
            grupos,
            Total_Canal: grupos.reduce((total, grupo) => total + Number(grupo.Total_Reportante || 0), 0),
            Pendiente_Canal: grupos.reduce((total, grupo) => total + Number(grupo.Pendiente_Reportante || 0), 0),
            Pagado_Canal: grupos.reduce((total, grupo) => total + Number(grupo.Pagado_Reportante || 0), 0),
          };
        }).filter((canal) => canal.grupos.length > 0);
        this.estadoConfirmacion = estado;
        this.syncFiltersToUrl(true);
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
    if (this.appliedFilters && this.activeAdvancedFilters) {
      this.runSearch({ ...this.appliedFilters, idCanal: '', filtroEstado: '' });
    }
    this.cdr.markForCheck();
  }

  quitarFiltroAplicado(campo: 'idCanal' | 'filtroEstado'): void {
    if (!this.appliedFilters || this.isSearching) return;
    this[campo] = '';
    this.runSearch({ ...this.appliedFilters, [campo]: '' });
  }

  actualizarFiltro(campo: 'fecha' | 'idTour' | 'idCanal' | 'filtroEstado', valor: string | number | null): void {
    const normalized = valor == null ? '' : String(valor);
    if (campo === 'filtroEstado') {
      this.filtroEstado = normalized === 'PENDIENTE' || normalized === 'PAGADO' ? normalized : '';
    } else {
      this[campo] = normalized;
    }
    this.cdr.markForCheck();
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
    return Number(Boolean(this.appliedFilters?.idCanal)) + Number(Boolean(this.appliedFilters?.filtroEstado));
  }

  get appliedCanalLabel(): string {
    const id = this.appliedFilters?.idCanal;
    return this.canalesDisponibles.find((canal) => String(canal.Id_Canal) === id)?.Nombre_Canal || `Canal #${id}`;
  }

  get appliedEstadoLabel(): string {
    return this.appliedFilters?.filtroEstado === 'PAGADO' ? 'Pagada' : 'Pendiente';
  }

  get jornadasPorConfirmar(): JornadaConfirmacion[] {
    if (this.appliedFilters?.filtroEstado === 'PAGADO') return [];
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
    const filters = this.appliedFilters;
    if (!this.canOpenConfirmation || !filters?.fecha || !this.jornadasPorConfirmar.length) return;
    const targetTour = filters.idTour || (this.jornadasPorConfirmar.length === 1
      ? String(this.jornadasPorConfirmar[0].Id_Tour)
      : '');
    void this.router.navigate(['/Reservas/Confirmacion'], {
      queryParams: {
        fechaTour: filters.fecha,
        tour: targetTour || null,
        buscar: targetTour ? 1 : null,
        origen: 'comisiones',
        origenCanal: filters.idCanal || null,
        origenEstado: filters.filtroEstado || null,
      },
    });
  }

  async exportar(): Promise<void> {
    if (!this.appliedFilters?.fecha || this.isExporting) return;
    this.isExporting = true;
    this.cdr.markForCheck();
    try {
      const blob = await firstValueFrom(this.comisionesService.exportarExcel(this.filtros()));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Comisiones_${this.appliedFilters.fecha}.xlsx`;
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

  abrirPagoGrupo(grupo: ComisionGrupo): void {
    if (this.esEntidadComisionable(grupo)) return;
    const pendientes = this.reservasPendientesDeGrupo(grupo);
    if (!pendientes.length) return;
    this.panel.modoCola = false;
    this.panel.cola = [];
    this.panel.indiceCola = 0;
    this.cargarGrupoEnPanel(grupo, pendientes);
  }

  iniciarColaPagos(): void {
    const cola = this.canales
      .flatMap((canal) => canal.grupos)
      .filter((grupo) => !this.esEntidadComisionable(grupo) && this.pendientesDe(grupo) > 0);
    if (!cola.length) return;
    this.panel.modoCola = true;
    this.panel.cola = cola;
    this.panel.indiceCola = 0;
    this.cargarGrupoEnPanel(cola[0], this.reservasPendientesDeGrupo(cola[0]));
  }

  private cargarGrupoEnPanel(grupo: ComisionGrupo, reservas: ComisionReserva[]): void {
    const forma = grupo.Forma_Pago || reservas[0]?.Forma_Pago || '';
    const cuenta = grupo.Cuenta_Bancaria || reservas[0]?.Cuenta_Bancaria || '';
    this.panel.visible = true;
    this.panel.grupo = grupo;
    this.panel.reservas = reservas;
    this.panel.formaPago = forma;
    this.panel.cuenta = cuenta;
    this.panel.nombreReceptor = grupo.Nombre_Receptor || reservas[0]?.Nombre_Receptor || '';
    this.panel.dniReceptor = grupo.DNI_Receptor || reservas[0]?.DNI_Receptor || '';
    this.panel.mostrarDatosPago = this.esFreelance(grupo) || Boolean(forma || cuenta || grupo.Nombre_Receptor);
    this.panel.guardarPerfil = false;
    this.panel.perfilExiste = false;
    this.panel.perfilError = '';
    this.panel.perfilCargando = this.esEntidadComisionable(grupo);
    this.panel.saving = false;
    this.panel.touched = false;
    const requestVersion = ++this.perfilRequestVersion;
    if (this.panel.perfilCargando && grupo.Id_Entidad_Reportante) {
      void this.precargarPerfilEntidad(grupo, requestVersion);
    }
    this.cdr.markForCheck();
  }

  private async precargarPerfilEntidad(grupo: ComisionGrupo, requestVersion: number): Promise<void> {
    try {
      const perfil = await firstValueFrom(this.comisionesService.obtenerPerfilEntidad(Number(grupo.Id_Entidad_Reportante)));
      if (requestVersion !== this.perfilRequestVersion || this.panel.grupo !== grupo) return;
      this.aplicarPerfilEntidad(perfil);
    } catch (error) {
      if (requestVersion !== this.perfilRequestVersion || this.panel.grupo !== grupo) return;
      this.panel.perfilError = this.errorMessage(error, 'No se pudo cargar el perfil de esta entidad.');
      this.panel.guardarPerfil = false;
      this.panel.mostrarDatosPago = true;
    } finally {
      if (requestVersion === this.perfilRequestVersion && this.panel.grupo === grupo) {
        this.panel.perfilCargando = false;
        this.cdr.markForCheck();
      }
    }
  }

  private aplicarPerfilEntidad(perfil: PerfilComisionEntidad | null): void {
    this.panel.perfilExiste = Boolean(perfil);
    this.panel.guardarPerfil = Boolean(perfil);
    if (perfil) {
      this.panel.formaPago = perfil.Forma_Pago || this.panel.formaPago;
      this.panel.cuenta = perfil.Numero_Cuenta || this.panel.cuenta;
      this.panel.nombreReceptor = perfil.Nombre_Receptor || this.panel.nombreReceptor;
      this.panel.dniReceptor = perfil.DNI_Receptor || this.panel.dniReceptor;
      this.panel.grupo!.Id_Perfil_Comision = perfil.Id_Perfil_Comision;
      this.panel.mostrarDatosPago = true;
    } else if (this.esEntidadComisionable(this.panel.grupo)) {
      this.panel.mostrarDatosPago = true;
    }
    this.cdr.markForCheck();
  }

  cerrarPanel(): void {
    if (this.panel.saving) return;
    this.perfilRequestVersion += 1;
    this.panel.visible = false;
    this.panel.modoCola = false;
    this.panel.cola = [];
    this.panel.indiceCola = 0;
    this.panel.grupo = null;
    this.panel.reservas = [];
    this.panel.mostrarDatosPago = false;
    this.panel.formaPago = '';
    this.panel.cuenta = '';
    this.panel.nombreReceptor = '';
    this.panel.dniReceptor = '';
    this.panel.guardarPerfil = false;
    this.panel.perfilExiste = false;
    this.panel.perfilCargando = false;
    this.panel.perfilError = '';
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
    const grupo = this.panel.grupo;
    if (!grupo || this.panel.saving || this.panel.perfilCargando) return;
    this.panel.saving = true;
    this.cdr.markForCheck();
    const ids = this.panel.reservas.map((reserva) => reserva.Id_Reserva);
    const forma = this.panel.formaPago || null;
    const cuenta = forma && this.panelRequiereCuenta && this.panel.cuenta.trim()
      ? this.panel.cuenta.trim()
      : null;

    try {
      if (this.panel.guardarPerfil && forma && this.esEntidadComisionable(grupo) && grupo.Id_Entidad_Reportante) {
        const profilePayload = {
          ...(this.panel.perfilExiste && grupo.Id_Perfil_Comision
            ? { Id_Perfil_Comision: grupo.Id_Perfil_Comision }
            : {}),
          Id_Entidad_Reportante: grupo.Id_Entidad_Reportante,
          Forma_Pago: forma,
          Numero_Cuenta: cuenta,
          Nombre_Receptor: this.panel.nombreReceptor.trim(),
          DNI_Receptor: this.panel.dniReceptor.trim(),
        };
        const perfil = this.panel.perfilExiste
          ? await firstValueFrom(this.comisionesService.actualizarPerfilEntidad(profilePayload))
          : await firstValueFrom(this.comisionesService.crearPerfilEntidad(profilePayload));
        grupo.Id_Perfil_Comision = Number(perfil.Id_Perfil_Comision);
        grupo.Forma_Pago = perfil.Forma_Pago;
        grupo.Cuenta_Bancaria = perfil.Numero_Cuenta;
        grupo.Nombre_Receptor = perfil.Nombre_Receptor;
        grupo.DNI_Receptor = perfil.DNI_Receptor;
        this.panel.perfilExiste = true;
      }

      const payload: GrupoPagoComision = {
        reservas: ids,
        Forma_Pago: forma,
        Cuenta_Bancaria: cuenta,
        Nombre_Receptor: forma ? this.panel.nombreReceptor.trim() : null,
        DNI_Receptor: forma ? this.panel.dniReceptor.trim() : null,
      };
      const paymentResult = await firstValueFrom(this.comisionesService.actualizarLiquidacion({ ...payload, Estado: 'PAGADO' }));

      grupo.Forma_Pago = forma;
      grupo.Cuenta_Bancaria = cuenta;
      grupo.Nombre_Receptor = payload.Nombre_Receptor;
      grupo.DNI_Receptor = payload.DNI_Receptor;
      for (const reserva of this.panel.reservas) {
        reserva.Forma_Pago = forma;
        reserva.Cuenta_Bancaria = cuenta;
        reserva.Nombre_Receptor = payload.Nombre_Receptor;
        reserva.DNI_Receptor = payload.DNI_Receptor;
        reserva.Estado_Liquidacion = 'PAGADO';
        reserva.Fecha_Pago = this.fechaMaxima;
        reserva.Monto_Comision_Pagada = Number(paymentResult.montos?.[reserva.Id_Reserva] ?? reserva.Total_Comision);
      }
      this.recalcularTotales();
      this.panel.saving = false;

      if (this.panel.modoCola) {
        this.avanzarCola(true);
      } else {
        this.alerts.successToast('Pago registrado', `Se registró el pago de ${this.nombreGrupo(grupo)}.`);
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
      const mensaje = registroExitoso ? 'Terminaste de revisar los pagos pendientes.' : 'No quedan grupos por revisar.';
      this.cerrarPanel();
      this.alerts.successToast('Revisión completada', mensaje);
      return;
    }
    this.panel.indiceCola = siguiente;
    const grupo = this.panel.cola[siguiente];
    this.cargarGrupoEnPanel(grupo, this.reservasPendientesDeGrupo(grupo));
  }

  async reabrirGrupo(grupo: ComisionGrupo): Promise<void> {
    if (this.esEntidadComisionable(grupo)) return;
    const pagadas = grupo.reservas.filter((reserva) => reserva.Estado_Liquidacion === 'PAGADO');
    if (!pagadas.length) return;
    const accepted = await this.alerts.confirmDecision(
      'Volver a pendiente',
      `Las comisiones pagadas de ${this.nombreGrupo(grupo)} volverán a quedar pendientes.`,
      { confirmText: 'Volver a pendiente', cancelText: 'Cancelar' },
    );
    if (!accepted) return;
    try {
      await firstValueFrom(this.comisionesService.actualizarLiquidacion({
        reservas: pagadas.map((reserva) => reserva.Id_Reserva),
        Estado: 'PENDIENTE',
        Forma_Pago: grupo.Forma_Pago,
        Cuenta_Bancaria: grupo.Cuenta_Bancaria,
        Nombre_Receptor: grupo.Nombre_Receptor,
        DNI_Receptor: grupo.DNI_Receptor,
      }));
      for (const reserva of pagadas) {
        reserva.Estado_Liquidacion = 'PENDIENTE';
        reserva.Fecha_Pago = null;
        reserva.Monto_Comision_Pagada = null;
      }
      this.recalcularTotales();
      this.alerts.successToast('Comisiones pendientes', 'El grupo puede incluirse nuevamente en un pago.');
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
      const grupos = canal.grupos.map((grupo) => {
        if (this.normalizarTexto(`${this.nombreGrupo(grupo)} ${grupo.Nombre_Reportante || ''}`).includes(query)) return grupo;
        const reservas = grupo.reservas.filter((reserva) =>
          this.normalizarTexto(`${reserva.Id_Reserva} ${reserva.Nombre_Tour} ${reserva.Nombre_Reportante || ''}`).includes(query),
        );
        return reservas.length ? { ...grupo, reservas } : null;
      }).filter((grupo): grupo is ComisionGrupo => Boolean(grupo));
      return grupos.length ? { ...canal, grupos } : null;
    }).filter((canal): canal is ComisionCanal => Boolean(canal));
  }

  get totalReservas(): number {
    return this.canales.reduce((sum, canal) => sum + canal.grupos.reduce((subtotal, grupo) => subtotal + grupo.reservas.length, 0), 0);
  }

  get totalPasajeros(): number {
    return this.canales.reduce((sum, canal) => sum + canal.grupos.reduce(
      (subtotal, rep) => subtotal + rep.reservas.reduce((count, reserva) => count + reserva.Num_Pasajeros, 0), 0,
    ), 0);
  }

  get totalGrupos(): number {
    return this.canales.reduce((sum, canal) => sum + canal.grupos.length, 0);
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
    return this.canales.reduce((sum, canal) => sum + canal.grupos.reduce(
      (subtotal, grupo) => subtotal + this.pendientesDe(grupo), 0,
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
    if (!forma) return 'Selecciona un medio de pago para registrar la comisión.';
    if (forma && !this.panel.nombreReceptor.trim()) return 'Ingresa el nombre de la persona o empresa que recibe el pago.';
    if (forma && !this.panel.dniReceptor.trim()) return 'Ingresa el DNI, NIT o documento de quien recibe el pago.';
    if (forma && !/^[a-zA-Z0-9.\-\s]{4,50}$/.test(this.panel.dniReceptor.trim())) return 'El DNI, NIT o documento del receptor no es válido.';
    if (this.panelRequiereCuenta && !cuenta) return 'Ingresa el dato de pago asociado a este medio.';
    if (forma === 'TRANSFERENCIA_BANCOLOMBIA' && !/^\d{11}$/.test(cuenta)) {
      return 'La cuenta Bancolombia debe tener exactamente 11 dígitos.';
    }
    if (forma === 'NEQUI' && !/^3\d{9}$/.test(cuenta)) {
      return 'El celular Nequi debe tener 10 dígitos e iniciar en 3.';
    }
    return '';
  }

  get perfilGuardadoError(): string {
    if (!this.panel.guardarPerfil) return '';
    if (!this.panel.formaPago) return 'Selecciona un medio de pago para guardar estos datos.';
    if (this.panelRequiereCuenta && !this.panel.cuenta.trim()) return 'Ingresa la cuenta antes de guardarla para próximas comisiones.';
    return this.panelError;
  }

  get panelCuentaLabel(): string {
    return this.panel.formaPago === 'NEQUI' ? 'Celular Nequi' : 'Número de cuenta';
  }

  get panelCuentaPlaceholder(): string {
    return this.panel.formaPago === 'NEQUI' ? 'Ej. 3001234567' : '11 dígitos';
  }

  get pasoCola(): string {
    return `${this.panel.indiceCola + 1} de ${this.panel.cola.length}`;
  }

  pendientesDe(grupo: ComisionGrupo): number {
    return this.reservasPendientesDeGrupo(grupo).length;
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

  trackGrupo(_: number, grupo: ComisionGrupo): string {
    if (grupo.Id_Entidad_Reportante) return `entidad:${grupo.Id_Entidad_Reportante}`;
    return `reserva:${grupo.reservas[0]?.Id_Reserva || 'sin-reserva'}`;
  }

  private validarPanel(): boolean {
    this.panel.touched = true;
    const error = this.panel.perfilCargando
      ? 'Espera a que termine la carga del perfil de la entidad.'
      : this.panelError || this.perfilGuardadoError;
    if (error) {
      this.alerts.warningToast('Revisa los datos del pago', error);
      this.panel.mostrarDatosPago = true;
      this.cdr.markForCheck();
      return false;
    }
    return Boolean(this.panel.grupo && this.panel.reservas.length);
  }

  private reservasPendientesDeGrupo(grupo: ComisionGrupo): ComisionReserva[] {
    return grupo.reservas.filter((reserva) => reserva.Estado_Liquidacion !== 'PAGADO');
  }

  esFreelance(grupo: ComisionGrupo | null): boolean {
    return Boolean(grupo && !grupo.Id_Entidad_Reportante);
  }

  esEntidadComisionable(grupo: ComisionGrupo | null): boolean {
    return Boolean(grupo?.Id_Entidad_Reportante
      && (grupo.Tipo_Entidad === 'HOTEL' || grupo.Tipo_Entidad === 'AGENCIA_NACIONAL'));
  }

  nombreGrupo(grupo: ComisionGrupo | null): string {
    if (!grupo) return '';
    if (this.esEntidadComisionable(grupo)) return grupo.Nombre_Entidad || 'Entidad reportante';
    return grupo.Nombre_Reportante || 'Freelance';
  }

  etiquetaTipoGrupo(grupo: ComisionGrupo | null): string {
    if (!grupo) return '';
    if (this.esFreelance(grupo)) return 'Freelance';
    if (grupo.Tipo_Entidad === 'AGENCIA_NACIONAL') return 'Agencia nacional';
    if (grupo.Tipo_Entidad === 'HOTEL') return 'Hotel';
    return 'Entidad reportante';
  }

  montoVisibleReserva(reserva: ComisionReserva): number {
    if (reserva.Estado_Liquidacion === 'PAGADO' && reserva.Monto_Comision_Pagada != null) {
      return Number(reserva.Monto_Comision_Pagada);
    }
    return Number(reserva.Total_Comision || 0);
  }

  private draftFilterSnapshot(): CommissionFilterState {
    return { fecha: this.fecha, idTour: this.idTour, idCanal: this.idCanal, filtroEstado: this.filtroEstado };
  }

  private filtros(filters: CommissionFilterState = this.appliedFilters || this.draftFilterSnapshot()): FiltrosComisiones {
    return {
      Fecha: filters.fecha,
      Id_Tour: filters.idTour || undefined,
      Id_Canal: filters.idCanal || undefined,
      Estado: filters.filtroEstado,
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
    this.showAdvancedFilters = false;
    return params.get('buscar') === '1' && hasValidFecha;
  }

  private syncFiltersToUrl(searchApplied: boolean): void {
    const filters = this.appliedFilters || this.draftFilterSnapshot();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        fechaTour: filters.fecha || null,
        tour: filters.idTour || null,
        tours: null,
        canal: filters.idCanal || null,
        estado: filters.filtroEstado || null,
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

  private recalcularTotales(): void {
    for (const canal of this.canales) {
      canal.Total_Canal = 0;
      canal.Pendiente_Canal = 0;
      canal.Pagado_Canal = 0;
      for (const grupo of canal.grupos) {
        grupo.Total_Reportante = grupo.reservas.reduce((sum, reserva) => sum + Number(reserva.Total_Comision || 0), 0);
        grupo.Pendiente_Reportante = grupo.reservas
          .filter((reserva) => reserva.Estado_Liquidacion !== 'PAGADO')
          .reduce((sum, reserva) => sum + Number(reserva.Total_Comision || 0), 0);
        grupo.Pagado_Reportante = grupo.reservas
          .filter((reserva) => reserva.Estado_Liquidacion === 'PAGADO')
          .reduce((sum, reserva) => sum + this.montoVisibleReserva(reserva), 0);
        canal.Total_Canal += grupo.Total_Reportante;
        canal.Pendiente_Canal += grupo.Pendiente_Reportante;
        canal.Pagado_Canal += grupo.Pagado_Reportante;
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
