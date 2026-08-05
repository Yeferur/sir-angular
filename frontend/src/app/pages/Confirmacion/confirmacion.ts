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
import { finalize, firstValueFrom, forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Tours } from '../../services/Tours/tours';
import { ConfirmacionService, PasajeroControlViaje } from '../../services/confirmacion.service';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';

type FiltroEstado = 'TODOS' | 'VIAJARON' | 'NO_VIAJARON' | 'CAMBIOS';
type ModuloOrigen = 'comisiones' | 'seguros';

interface ReservaControlViaje {
  id: string;
  reportante: string | null;
  canal: string | null;
  pasajeros: PasajeroControlViaje[];
}

@Component({
  selector: 'app-confirmacion',
  standalone: true,
  imports: [CommonModule, FormsModule, DatepickerComponent, LoadingStateComponent],
  templateUrl: './confirmacion.html',
  styleUrl: './confirmacion.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmacionComponent implements OnInit {
  private readonly permisosService = inject(PermisosService);
  private readonly toursService = inject(Tours);
  private readonly confirmacionService = inject(ConfirmacionService);
  private readonly alerts = inject(SirAlertService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  toursList: any[] = [];
  pasajeros: PasajeroControlViaje[] = [];
  filters = { Id_Tour: '', Fecha: this.isoLocal(this.addDays(new Date(), -1)) };
  fechaMaxima = this.isoLocal(new Date());
  busqueda = '';
  filtroEstado: FiltroEstado = 'TODOS';

  catalogLoading = true;
  catalogError = '';
  hasSearched = false;
  isLoading = false;
  isSubmitting = false;
  loadError = '';
  jornadaConfirmada = false;

  private savedConfirmaciones = new Map<number, 0 | 1>();
  private loadedTourId: number | null = null;
  private loadedFecha = '';
  private restoreSearchFromUrl = false;
  private moduloOrigen: ModuloOrigen | null = null;
  private origenCanal = '';
  private origenEstado = '';
  private origenReportante = '';

  ngOnInit(): void {
    this.restoreWorkflowContext();
    this.restoreSearchFromUrl = this.restoreFiltersFromQuery();
    this.loadTours();
  }

  get canUpdateAsistencia(): boolean {
    return this.permisosService.tienePermiso('CONTROL_VIAJE.ACTUALIZAR_ASISTENCIA');
  }

  get totalConfirmados(): number {
    return this.pasajeros.filter((pasajero) => pasajero.Confirmacion === 1).length;
  }

  get totalNoViajaron(): number {
    return this.pasajeros.length - this.totalConfirmados;
  }

  get totalReservas(): number {
    return new Set(this.pasajeros.map((pasajero) => pasajero.Id_Reserva)).size;
  }

  get totalCambios(): number {
    return this.pasajeros.filter((pasajero) => this.isChanged(pasajero)).length;
  }

  get pasajerosFiltrados(): PasajeroControlViaje[] {
    const term = this.normalizar(this.busqueda);
    return this.pasajeros.filter((pasajero) => {
      if (this.filtroEstado === 'VIAJARON' && pasajero.Confirmacion !== 1) return false;
      if (this.filtroEstado === 'NO_VIAJARON' && pasajero.Confirmacion === 1) return false;
      if (this.filtroEstado === 'CAMBIOS' && !this.isChanged(pasajero)) return false;
      if (!term) return true;
      return this.normalizar([
        pasajero.Nombre_Pasajero,
        pasajero.DNI,
        pasajero.Id_Reserva,
        pasajero.Nombre_Reportante,
        pasajero.Nombre_Canal,
      ].join(' ')).includes(term);
    });
  }

  get reservasAgrupadas(): ReservaControlViaje[] {
    const reservas = new Map<string, ReservaControlViaje>();
    for (const pasajero of this.pasajerosFiltrados) {
      const id = String(pasajero.Id_Reserva);
      const reserva = reservas.get(id);
      if (reserva) {
        reserva.pasajeros.push(pasajero);
        continue;
      }
      reservas.set(id, {
        id,
        reportante: pasajero.Nombre_Reportante,
        canal: pasajero.Nombre_Canal,
        pasajeros: [pasajero],
      });
    }
    return [...reservas.values()];
  }

  get todosVisiblesViajaron(): boolean {
    const visibles = this.pasajerosFiltrados;
    return visibles.length > 0 && visibles.every((pasajero) => pasajero.Confirmacion === 1);
  }

  get nombreTourCargado(): string {
    const tour = this.toursList.find((item) => Number(item.Id_Tour) === this.loadedTourId);
    return tour?.Nombre_Tour || 'el tour seleccionado';
  }

  loadTours(): void {
    this.catalogLoading = true;
    this.catalogError = '';
    this.toursService.getTours().pipe(
      finalize(() => {
        this.catalogLoading = false;
        this.cdr.markForCheck();
        this.runRestoredSearch();
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (data) => {
        this.toursList = data || [];
        this.cdr.markForCheck();
      },
      error: () => {
        this.catalogError = 'No pudimos cargar los tours disponibles.';
        this.cdr.markForCheck();
      },
    });
  }

  updateSearchFilter(key: 'Fecha' | 'Id_Tour', value: string | number | null): void {
    this.filters[key] = value == null ? '' : String(value);
    this.syncFiltersToUrl();
  }

  async search(): Promise<void> {
    if (!this.filters.Id_Tour || !this.filters.Fecha) {
      this.alerts.warningToast('Faltan datos', 'Selecciona la fecha y el tour que deseas controlar.');
      return;
    }
    if (this.isLoading || this.isSubmitting) return;
    if (this.hasUnsavedChanges()) {
      const discard = await this.alerts.confirmDecision(
        'Descartar cambios sin guardar',
        `Hay ${this.totalCambios} cambio(s) en la jornada actual. Si consultas otra vez, se perderán.`,
        { confirmText: 'Descartar y consultar', cancelText: 'Volver', destructive: true },
      );
      if (!discard) return;
    }
    this.performSearch();
  }

  private performSearch(): void {
    const idTour = Number(this.filters.Id_Tour);
    const fecha = this.filters.Fecha;
    this.hasSearched = true;
    this.isLoading = true;
    this.loadError = '';
    this.busqueda = '';
    this.filtroEstado = 'TODOS';
    this.syncFiltersToUrl(true);
    forkJoin({
      pasajeros: this.confirmacionService.getPasajeros(idTour, fecha),
      estado: this.confirmacionService.getEstado(fecha, idTour),
    }).pipe(
      finalize(() => {
        this.isLoading = false;
        this.cdr.markForCheck();
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: ({ pasajeros, estado }) => {
        this.pasajeros = this.normalizePasajeros(pasajeros);
        this.jornadaConfirmada = Boolean(estado?.jornadas?.[0]?.Confirmada);
        this.loadedTourId = idTour;
        this.loadedFecha = fecha;
        this.syncSavedConfirmaciones();
        if (!this.pasajeros.length) {
          this.alerts.infoToast('Sin pasajeros', 'No hay pasajeros activos para este tour y fecha.');
        }
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.loadError = error?.error?.message || 'No pudimos cargar los pasajeros.';
        this.cdr.markForCheck();
      },
    });
  }

  togglePasajero(pasajero: PasajeroControlViaje): void {
    if (!this.canUpdateAsistencia || this.isSubmitting) return;
    pasajero.Confirmacion = pasajero.Confirmacion === 1 ? 0 : 1;
    this.cdr.markForCheck();
  }

  toggleTodosVisibles(): void {
    if (!this.canUpdateAsistencia || this.isSubmitting) return;
    const visibles = this.pasajerosFiltrados;
    const confirmacion: 0 | 1 = visibles.length > 0 && visibles.every((pasajero) => pasajero.Confirmacion === 1) ? 0 : 1;
    for (const pasajero of visibles) pasajero.Confirmacion = confirmacion;
    this.cdr.markForCheck();
  }

  setFiltroEstado(filtro: FiltroEstado): void {
    this.filtroEstado = filtro;
    this.cdr.markForCheck();
  }

  restaurarCambios(): void {
    for (const pasajero of this.pasajeros) {
      pasajero.Confirmacion = this.savedConfirmaciones.get(pasajero.Id_Pasajero) ?? 0;
    }
    this.cdr.markForCheck();
  }

  async save(): Promise<void> {
    if (!this.canUpdateAsistencia) {
      this.alerts.errorToast('Acceso denegado', 'No tienes permiso para actualizar la asistencia.');
      return;
    }
    if (this.isSubmitting || !this.loadedTourId || !this.loadedFecha) return;
    if (!this.totalCambios && this.jornadaConfirmada) return;

    const accepted = await this.alerts.confirmDecision(
      'Guardar confirmación de pasajeros',
      `${this.nombreTourCargado}: ${this.totalConfirmados} viajaron y ${this.totalNoViajaron} no viajaron.`,
      { confirmText: 'Guardar confirmación', cancelText: 'Revisar' },
    );
    if (!accepted) return;

    const confirmaciones = this.pasajeros
      .map((pasajero) => ({
        Id_Pasajero: pasajero.Id_Pasajero,
        Confirmacion: pasajero.Confirmacion,
      }));
    this.isSubmitting = true;
    this.cdr.markForCheck();
    try {
      await firstValueFrom(this.confirmacionService.saveConfirmacion({
        Id_Tour: this.loadedTourId,
        Fecha: this.loadedFecha,
        pasajeros: confirmaciones,
      }));
      this.syncSavedConfirmaciones();
      this.jornadaConfirmada = true;
      this.offerNextStep();
    } catch (error: any) {
      this.alerts.errorToast('No pudimos guardar', error?.error?.message || 'Actualiza la jornada e inténtalo nuevamente.');
    } finally {
      this.isSubmitting = false;
      this.cdr.markForCheck();
    }
  }

  isChanged(pasajero: PasajeroControlViaje): boolean {
    return (this.savedConfirmaciones.get(pasajero.Id_Pasajero) ?? 0) !== pasajero.Confirmacion;
  }

  hasUnsavedChanges(): boolean {
    return !this.isSubmitting && this.totalCambios > 0;
  }

  tipoPasajeroLabel(tipo: string): string {
    if (tipo === 'NINO') return 'Niño';
    if (tipo === 'INFANTE') return 'Infante';
    return 'Adulto';
  }

  trackByPasajero(_: number, item: PasajeroControlViaje): number {
    return item.Id_Pasajero;
  }

  trackByReserva(_: number, item: ReservaControlViaje): string {
    return item.id;
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  private normalizePasajeros(data: PasajeroControlViaje[]): PasajeroControlViaje[] {
    return [...(data || [])].map((pasajero) => ({
      ...pasajero,
      Id_Pasajero: Number(pasajero.Id_Pasajero),
      Confirmacion: Number(pasajero.Confirmacion) === 1 ? 1 : 0,
    }));
  }

  private syncSavedConfirmaciones(): void {
    this.savedConfirmaciones = new Map(
      this.pasajeros.map((pasajero) => [pasajero.Id_Pasajero, pasajero.Confirmacion]),
    );
  }

  private restoreFiltersFromQuery(): boolean {
    const params = this.route.snapshot.queryParamMap;
    const fecha = String(params.get('fechaTour') || '').trim();
    const tour = Number(params.get('tour') || params.get('tours'));
    const hasValidFecha = /^\d{4}-\d{2}-\d{2}$/.test(fecha);
    const hasValidTour = Number.isFinite(tour) && tour > 0;

    if (hasValidFecha) this.filters.Fecha = fecha;
    if (hasValidTour) this.filters.Id_Tour = String(tour);

    return params.get('buscar') === '1' && hasValidFecha && hasValidTour;
  }

  private restoreWorkflowContext(): void {
    const params = this.route.snapshot.queryParamMap;
    const origen = String(params.get('origen') || '').toLowerCase();
    this.moduloOrigen = origen === 'comisiones' || origen === 'seguros' ? origen : null;
    this.origenCanal = String(params.get('origenCanal') || '').trim();
    this.origenEstado = String(params.get('origenEstado') || '').trim();
    this.origenReportante = String(params.get('origenReportante') || '').trim();
  }

  private buildFilterQueryParams(searchApplied: boolean): Record<string, string | number | null> {
    return {
      fechaTour: this.filters.Fecha || null,
      tour: this.filters.Id_Tour || null,
      tours: null,
      buscar: searchApplied ? 1 : null,
    };
  }

  private syncFiltersToUrl(searchApplied = this.hasSearched): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.buildFilterQueryParams(searchApplied),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private runRestoredSearch(): void {
    if (!this.restoreSearchFromUrl || this.catalogError) return;
    this.restoreSearchFromUrl = false;
    this.performSearch();
  }

  private offerNextStep(): void {
    const destinations = this.nextDestinations();
    const message = 'La confirmación de viaje quedó registrada.';
    if (!destinations.length) {
      this.alerts.successToast('Confirmación guardada', message);
      return;
    }

    this.alerts.showConfirm(
      'Confirmación guardada',
      `${message} Elige cómo deseas continuar.`,
      [
        {
          text: 'Quedarme aquí',
          style: 'secondary',
          onClick: () => this.alerts.closeModal(),
        },
        ...destinations.map((destination) => ({
          text: destination.label,
          style: 'primary' as const,
          onClick: () => {
            this.alerts.closeModal();
            void this.router.navigate([destination.route], { queryParams: destination.queryParams });
          },
        })),
      ],
      { type: 'success' },
    );
  }

  private nextDestinations(): Array<{
    label: string;
    route: '/Comisiones' | '/Seguros';
    queryParams: Record<string, string | number | null>;
  }> {
    const canComisiones = this.permisosService.tienePermiso('COMISIONES.LEER');
    const canSeguros = this.permisosService.tienePermiso('SEGUROS.LEER');
    const base = {
      fechaTour: this.loadedFecha,
      tour: this.loadedTourId,
      buscar: 1,
    };
    const comisiones = {
      label: this.moduloOrigen === 'comisiones' ? 'Volver a comisiones' : 'Ir a comisiones',
      route: '/Comisiones' as const,
      queryParams: {
        ...base,
        canal: this.origenCanal || null,
        estado: this.origenEstado || null,
        reportante: this.origenReportante || null,
      },
    };
    const seguros = {
      label: this.moduloOrigen === 'seguros' ? 'Volver a seguros' : 'Ir a seguros',
      route: '/Seguros' as const,
      queryParams: base,
    };

    const available = [canComisiones ? comisiones : null, canSeguros ? seguros : null].filter(
      (destination): destination is typeof comisiones | typeof seguros => Boolean(destination),
    );
    if (this.moduloOrigen === 'comisiones') {
      return available.sort((destination) => destination.route === '/Comisiones' ? -1 : 1);
    }
    if (this.moduloOrigen === 'seguros') {
      return available.sort((destination) => destination.route === '/Seguros' ? -1 : 1);
    }
    return available;
  }

  private normalizar(value: string): string {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
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
