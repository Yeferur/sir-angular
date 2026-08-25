import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  effect,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, catchError, finalize, firstValueFrom, forkJoin, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { SeguroBus, SeguroPasajero, SegurosService } from '../../services/Seguros/seguros.service';
import { Tours } from '../../services/Tours/tours';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { ConfirmacionService, EstadoConfirmacion, JornadaConfirmacion } from '../../services/confirmacion.service';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirDrawerService } from '../../services/Drawer/drawer.service';

type EstadoLista = 'todos' | 'pendientes' | 'listos';

interface PanelSeguroState {
  visible: boolean;
  modoCola: boolean;
  cola: SeguroBus[];
  indiceCola: number;
  bus: SeguroBus | null;
  placa: string;
  guia: string;
  conductor: string;
  dniConductor: string;
  dniGuia: string;
  saving: boolean;
  touched: boolean;
}

@Component({
  selector: 'app-seguros',
  standalone: true,
  imports: [CommonModule, FormsModule, DatepickerComponent, LoadingStateComponent],
  templateUrl: './seguros.html',
  styleUrl: './seguros.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SegurosComponent implements OnInit {
  private readonly segurosService = inject(SegurosService);
  private readonly toursService = inject(Tours);
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
  tours: any[] = [];
  buses: SeguroBus[] = [];
  estadoLista: EstadoLista = 'todos';

  catalogLoading = true;
  catalogError = '';
  hasSearched = false;
  isSearching = false;
  searchError = '';
  isExporting = false;
  estadoConfirmacion: EstadoConfirmacion | null = null;

  readonly panel: PanelSeguroState = {
    visible: false,
    modoCola: false,
    cola: [],
    indiceCola: 0,
    bus: null,
    placa: '',
    guia: '',
    conductor: '',
    dniConductor: '',
    dniGuia: '',
    saving: false,
    touched: false,
  };

  private restoreSearchFromUrl = false;
  private searchSubscription?: Subscription;
  private awaitingReservationRefresh = false;
  private readonly reservationRefreshEffect = effect(() => {
    const drawerState = this.drawer.drawer();
    if (!this.awaitingReservationRefresh || drawerState) return;
    this.awaitingReservationRefresh = false;
    queueMicrotask(() => this.buscar(true));
  });

  ngOnInit(): void {
    this.restoreSearchFromUrl = this.restoreFiltersFromQuery();
    this.cargarTours();
  }

  cargarTours(): void {
    this.catalogLoading = true;
    this.catalogError = '';
    this.toursService.getTours().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: tours => {
        this.tours = tours || [];
        this.catalogLoading = false;
        if (this.restoreSearchFromUrl) {
          this.restoreSearchFromUrl = false;
          this.buscar(false);
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.catalogLoading = false;
        this.catalogError = 'No pudimos cargar los tours disponibles.';
        this.cdr.markForCheck();
      },
    });
  }

  actualizarFecha(fecha: string): void {
    this.fecha = fecha;
    this.marcarFiltrosSinAplicar();
  }

  actualizarTour(idTour: string): void {
    this.idTour = String(idTour || '');
    this.marcarFiltrosSinAplicar();
  }

  private marcarFiltrosSinAplicar(): void {
    if (!this.hasSearched) return;
    this.hasSearched = false;
    this.buses = [];
    this.searchError = '';
    this.estadoConfirmacion = null;
    this.cerrarPanel();
    this.syncFiltersToUrl(false);
  }

  buscar(preserveResults = true): void {
    if (!this.fecha || !this.idTour || this.isSearching) return;
    this.searchSubscription?.unsubscribe();
    this.hasSearched = true;
    this.isSearching = true;
    this.searchError = '';
    if (!preserveResults) this.buses = [];
    this.cerrarPanel();
    this.syncFiltersToUrl(true);

    this.searchSubscription = forkJoin({
      buses: this.segurosService.listarSeguros({ Fecha: this.fecha, Id_Tour: this.idTour }),
      estado: this.confirmacionService.getEstado(this.fecha, this.idTour).pipe(catchError(() => of(null))),
    }).pipe(
      finalize(() => {
        this.isSearching = false;
        this.cdr.markForCheck();
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: ({ buses, estado }) => {
        this.buses = buses || [];
        this.estadoConfirmacion = estado;
        this.cdr.markForCheck();
      },
      error: error => {
        this.searchError = this.errorMessage(error, 'No pudimos cargar los seguros.');
        this.cdr.markForCheck();
      },
    });
  }

  seleccionarEstado(estado: EstadoLista): void {
    this.estadoLista = estado;
  }

  abrirBus(bus: SeguroBus): void {
    this.panel.modoCola = false;
    this.panel.cola = [];
    this.panel.indiceCola = 0;
    this.cargarBusEnPanel(bus);
  }

  iniciarCompletarDatos(): void {
    const cola = this.buses.filter(bus => !bus.Datos_Completos);
    if (!cola.length) {
      this.alerts.successToast('Todo listo', 'Los buses ya tienen la información necesaria para descargar.');
      return;
    }
    this.panel.modoCola = true;
    this.panel.cola = cola;
    this.panel.indiceCola = 0;
    this.cargarBusEnPanel(cola[0]);
  }

  private cargarBusEnPanel(bus: SeguroBus): void {
    this.panel.visible = true;
    this.panel.bus = bus;
    this.panel.placa = bus.Placa_Display || '';
    this.panel.guia = bus.Guia || '';
    this.panel.conductor = bus.Conductor || '';
    this.panel.dniConductor = bus.DNI_Conductor || '';
    this.panel.dniGuia = bus.DNI_Guia || '';
    this.panel.saving = false;
    this.panel.touched = false;
    this.cdr.markForCheck();
  }

  cerrarPanel(): void {
    if (this.panel.saving) return;
    this.panel.visible = false;
    this.panel.bus = null;
    this.panel.cola = [];
    this.panel.indiceCola = 0;
    this.panel.modoCola = false;
  }

  omitirBusActual(): void {
    if (!this.panel.modoCola) {
      this.cerrarPanel();
      return;
    }
    this.avanzarCola(false);
  }

  async guardarBusActual(): Promise<void> {
    const bus = this.panel.bus;
    if (!bus || this.panel.saving) return;
    this.panel.touched = true;
    if (this.panelError) {
      this.cdr.markForCheck();
      return;
    }

    const accepted = await this.alerts.confirmDecision(
      `Guardar datos de ${this.etiquetaBus(bus)}`,
      this.panel.modoCola
        ? 'Se actualizarán la placa, el guía y el conductor de este listado. Al terminar continuaremos con el siguiente bus pendiente.'
        : 'Se actualizarán la placa, el guía y el conductor utilizados para preparar este listado de seguros.',
      { confirmText: 'Guardar datos', cancelText: 'Cancelar' },
    );
    if (!accepted) return;

    this.panel.saving = true;
    this.cdr.markForCheck();
    try {
      await firstValueFrom(this.segurosService.actualizarPersonalBus(bus.Id_Bus_Prog, {
        Placa_Display: this.panel.placa || null,
        Guia: this.panel.guia || null,
        Conductor: this.panel.conductor || null,
        DNI_Conductor: this.panel.dniConductor || null,
        DNI_Guia: this.panel.dniGuia || null,
      }));
      bus.Placa_Display = this.panel.placa.trim() || `Bus ${bus.Orden_Bus}`;
      bus.Guia = this.panel.guia.trim() || null;
      bus.Conductor = this.panel.conductor.trim() || null;
      bus.DNI_Conductor = this.panel.dniConductor.trim() || null;
      bus.DNI_Guia = this.panel.dniGuia.trim() || null;
      this.recalcularEstado(bus);
      this.panel.saving = false;

      if (bus.Datos_Completos) {
        if (this.panel.modoCola) this.avanzarCola(true);
        else {
          this.cerrarPanel();
          this.alerts.successToast('Bus listo', `La información del bus ${bus.Orden_Bus} quedó completa.`);
        }
      } else {
        this.alerts.warningToast('Aún hay datos pendientes', 'Revisa el guía o abre las reservas señaladas para completar sus documentos.');
      }
    } catch (error) {
      this.alerts.errorToast('No se pudo guardar', this.errorMessage(error, 'Intenta nuevamente.'));
    } finally {
      this.panel.saving = false;
      this.cdr.markForCheck();
    }
  }

  private avanzarCola(registroExitoso: boolean): void {
    const siguiente = this.panel.indiceCola + 1;
    if (siguiente >= this.panel.cola.length) {
      this.cerrarPanel();
      if (registroExitoso) this.alerts.successToast('Revisión completada', 'Terminaste de revisar los buses pendientes.');
      return;
    }
    this.panel.indiceCola = siguiente;
    this.cargarBusEnPanel(this.panel.cola[siguiente]);
  }

  verReserva(pasajero: SeguroPasajero): void {
    const idReserva = String(pasajero.Id_Reserva || '').trim();
    if (!idReserva) return;
    this.cerrarPanel();
    this.awaitingReservationRefresh = true;
    this.drawer.openReserva(idReserva);
  }

  irAProgramacion(): void {
    this.cerrarPanel();
    void this.router.navigate(['/Programacion/Listado'], {
      queryParams: { fecha: this.fecha },
    });
  }

  irAConfirmacion(): void {
    if (!this.canOpenConfirmation || !this.fecha || !this.idTour) return;
    void this.router.navigate(['/Reservas/Confirmacion'], {
      queryParams: { fechaTour: this.fecha, tour: this.idTour, buscar: 1, origen: 'seguros' },
    });
  }

  descargarExcel(): void {
    if (this.isExporting || this.busesPendientes) return;
    this.isExporting = true;
    this.segurosService.exportarExcel({ Fecha: this.fecha, Id_Tour: this.idTour }).pipe(
      finalize(() => {
        this.isExporting = false;
        this.cdr.markForCheck();
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: blob => {
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `Seguros_${this.fecha}_${this.nombreTourArchivo}.xlsx`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL(url);
        this.alerts.successToast('Archivo generado', 'El archivo incluye una hoja consolidada y una hoja por cada bus.');
      },
      error: error => this.alerts.errorToast('No se pudo descargar', this.errorMessage(error, 'Revisa los datos pendientes e intenta nuevamente.')),
    });
  }

  private recalcularEstado(bus: SeguroBus): void {
    const faltantes = bus.Faltantes.filter(item => item.source === 'reserva');
    if (!bus.Guia) faltantes.push({ code: 'GUIA', label: 'Nombre del guía', source: 'seguros' });
    if (!bus.DNI_Guia) faltantes.push({ code: 'DNI_GUIA', label: 'Documento del guía', source: 'seguros' });
    if (!bus.Conductor) faltantes.push({ code: 'CONDUCTOR', label: 'Nombre del conductor', source: 'seguros' });
    if (!bus.DNI_Conductor) faltantes.push({ code: 'DNI_CONDUCTOR', label: 'Documento del conductor', source: 'seguros' });
    bus.Faltantes = faltantes;
    bus.Datos_Completos = faltantes.length === 0;
  }

  get busesVisibles(): SeguroBus[] {
    if (this.estadoLista === 'pendientes') return this.buses.filter(bus => !bus.Datos_Completos);
    if (this.estadoLista === 'listos') return this.buses.filter(bus => bus.Datos_Completos);
    return this.buses;
  }

  get busesPendientes(): number { return this.buses.filter(bus => !bus.Datos_Completos).length; }
  get busesListos(): number { return this.buses.length - this.busesPendientes; }
  get totalPasajeros(): number { return this.buses.reduce((sum, bus) => sum + bus.pasajeros.length, 0); }
  get totalAsegurados(): number { return this.buses.reduce((sum, bus) => sum + bus.Total_Asegurados, 0); }
  get pasoCola(): string { return `${this.panel.indiceCola + 1} de ${this.panel.cola.length}`; }
  get canOpenConfirmation(): boolean { return this.permisosService.tienePermiso('CONTROL_VIAJE.LEER'); }
  get jornadasPorConfirmar(): JornadaConfirmacion[] {
    if (!this.buses.length) return [];
    return this.estadoConfirmacion?.jornadas?.filter(jornada => jornada.Requiere_Confirmacion) || [];
  }
  get pasajerosSinDocumentoPanel(): SeguroPasajero[] {
    return this.panel.bus?.pasajeros.filter(pasajero => !String(pasajero.DNI || '').trim()) || [];
  }
  get panelError(): string {
    if (!this.panel.touched) return '';
    if (!this.panel.guia.trim()) return 'Ingresa el nombre del guía.';
    if (!this.panel.dniGuia.trim()) return 'Ingresa el documento del guía.';
    if (!this.panel.conductor.trim()) return 'Ingresa el nombre del conductor.';
    if (!this.panel.dniConductor.trim()) return 'Ingresa el documento del conductor.';
    return '';
  }
  get nombreTourSeleccionado(): string {
    return this.tours.find(tour => String(tour.Id_Tour) === this.idTour)?.Nombre_Tour || 'Tour seleccionado';
  }
  get nombreTourArchivo(): string {
    return this.nombreTourSeleccionado.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Tour';
  }

  textoCantidad(cantidad: number, singular: string, plural: string): string {
    return `${cantidad} ${cantidad === 1 ? singular : plural}`;
  }

  etiquetaBus(bus: SeguroBus): string {
    return bus.Tipo_Bus === 'privado' ? `Privado ${bus.Orden_Bus}` : `Bus ${bus.Orden_Bus}`;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.panel.visible) this.cerrarPanel();
  }

  private restoreFiltersFromQuery(): boolean {
    const params = this.route.snapshot.queryParamMap;
    const fecha = String(params.get('fechaTour') || '').trim();
    const tour = Number(params.get('tour'));
    const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(fecha);
    const tourValido = Number.isInteger(tour) && tour > 0;
    if (fechaValida) this.fecha = fecha;
    if (tourValido) this.idTour = String(tour);
    return params.get('buscar') === '1' && fechaValida && tourValido;
  }

  private syncFiltersToUrl(searchApplied: boolean): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        fechaTour: this.fecha || null,
        tour: this.idTour || null,
        buscar: searchApplied ? 1 : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private errorMessage(error: any, fallback: string): string {
    const message = error?.error?.message || error?.message || fallback;
    const conflicts = error?.error?.errorCode === 'DUPLICATE_BUS_ASSIGNMENT' && Array.isArray(error?.error?.details)
      ? error.error.details
          .map((item: any) => `${item?.label || 'Dato'} ${item?.value || ''} ya está en ${item?.bus || 'otro bus'}.`)
          .slice(0, 4)
      : [];
    return conflicts.length ? `${message} ${conflicts.join(' ')}` : message;
  }

  private addDays(date: Date, days: number): Date {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  private isoLocal(date: Date): string {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
  }
}
