import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  Subject,
  Subscription,
  debounceTime,
  distinctUntilChanged,
  finalize,
  forkJoin,
  map
} from 'rxjs';

import { puntosService, Punto } from '../../../services/Puntos/puntos';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { toUserErrorMessage } from '../../../shared/errors/user-error-message';

type PuntoHorario = NonNullable<Punto['horarios']>[number];

@Component({
  selector: 'app-ver-puntos',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingStateComponent],
  templateUrl: './ver-puntos.html',
  styleUrls: ['../../listado-reservas-transfers.css', './ver-puntos.css']
})
export class VerPuntos implements OnInit, OnDestroy {
  private puntosSvc = inject(puntosService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private permisosService = inject(PermisosService);
  private alerts = inject(SirAlertService);

  readonly limit = 10;
  readonly puntos = signal<Punto[]>([]);
  readonly rutas = signal<string[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly totalPages = signal(1);
  readonly isLoading = signal(true);
  readonly isSearching = signal(false);
  readonly loadError = signal('');
  readonly searchError = signal('');
  readonly hasLoadedOnce = signal(false);
  readonly deletingIds = signal<Set<number>>(new Set());

  searchTerm = '';
  selectedRoute = '';
  descargandoExcel = false;

  private readonly searchInput$ = new Subject<string>();
  private inputSubscription?: Subscription;
  private searchRequest?: Subscription;
  private deleteRequests = new Subscription();

  ngOnInit(): void {
    this.selectedRoute = String(this.route.snapshot.queryParamMap.get('ruta') || '').trim();
    this.inputSubscription = this.searchInput$.pipe(
      map((value) => String(value || '').trim()),
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(() => this.buscarPuntos(true));

    this.loadInitialData();
  }

  ngOnDestroy(): void {
    this.inputSubscription?.unsubscribe();
    this.searchRequest?.unsubscribe();
    this.deleteRequests.unsubscribe();
  }

  get canDeletePunto(): boolean {
    return this.permisosService.tienePermiso('PUNTOS.ELIMINAR');
  }

  get canCreatePunto(): boolean {
    return this.permisosService.tienePermiso('PUNTOS.CREAR');
  }

  get canSortPuntos(): boolean {
    return this.permisosService.tienePermiso('PUNTOS.ORDENAR');
  }

  get canExportPuntos(): boolean {
    return this.permisosService.tienePermiso('PUNTOS.EXPORTAR');
  }

  get canUpdatePunto(): boolean {
    return this.permisosService.tienePermiso('PUNTOS.ACTUALIZAR');
  }

  loadInitialData(): void {
    this.searchRequest?.unsubscribe();
    this.isLoading.set(true);
    this.loadError.set('');

    this.searchRequest = forkJoin({
      rutas: this.puntosSvc.getRutasPuntos(),
      result: this.puntosSvc.getPuntos(1, this.limit, '', this.selectedRoute)
    }).pipe(
      finalize(() => this.isLoading.set(false))
    ).subscribe({
      next: ({ rutas, result }) => {
        this.rutas.set(this.sortRoutes(Array.isArray(rutas) ? rutas : []));
        this.applyResult(result);
        this.hasLoadedOnce.set(true);
      },
      error: (error) => {
        this.loadError.set(toUserErrorMessage(error, 'Revisa tu conexión e inténtalo nuevamente.'));
      }
    });
  }

  buscarPuntos(resetPage = true): void {
    this.searchRequest?.unsubscribe();
    if (resetPage) this.page.set(1);

    this.isSearching.set(true);
    this.searchError.set('');

    this.searchRequest = this.puntosSvc.getPuntos(
      this.page(),
      this.limit,
      this.searchTerm,
      this.selectedRoute
    ).pipe(
      finalize(() => this.isSearching.set(false))
    ).subscribe({
      next: (result) => {
        this.applyResult(result);
        this.hasLoadedOnce.set(true);
      },
      error: (error) => {
        this.searchError.set(toUserErrorMessage(error, 'No fue posible consultar los puntos de encuentro.'));
      }
    });
  }

  private applyResult(result: { data: Punto[]; total: number; page?: number }): void {
    const total = Number(result?.total || 0);
    const normalizedPage = Math.max(1, Number(result?.page || this.page()) || 1);
    this.puntos.set(Array.isArray(result?.data) ? result.data : []);
    this.total.set(total);
    this.page.set(normalizedPage);
    this.totalPages.set(Math.max(1, Math.ceil(total / this.limit)));
  }

  onSearchInput(value: string): void {
    this.searchTerm = value;
    this.searchInput$.next(value);
  }

  clearSearch(): void {
    if (!this.searchTerm) return;
    this.searchTerm = '';
    this.searchInput$.next('');
  }

  submitSearch(): void {
    this.buscarPuntos(true);
  }

  onRouteChange(route: string): void {
    this.selectedRoute = String(route || '').trim();
    this.buscarPuntos(true);
  }

  crearPunto(): void {
    if (!this.canCreatePunto) {
      this.alerts.errorToast('Acceso denegado', 'No tienes permiso para crear puntos.');
      return;
    }
    this.router.navigate(['/Puntos/NuevoPunto']);
  }

  irAOrdenarPuntos(): void {
    if (!this.canSortPuntos) {
      this.alerts.errorToast('Acceso denegado', 'No tienes permiso para ordenar puntos.');
      return;
    }
    this.router.navigate(['/Puntos/OrdenarPuntos']);
  }

  editarPunto(punto: Punto): void {
    if (!this.canUpdatePunto) return;
    const id = this.getPuntoId(punto);
    if (id) this.router.navigate(['/Puntos/Editar', id]);
  }

  confirmEliminarPunto(punto: Punto): void {
    const id = this.getPuntoId(punto);
    if (!id || punto.EsProtegido || !this.canDeletePunto || this.isDeleting(id)) return;

    const nombre = this.getPuntoName(punto);
    this.alerts.confirmDelete(
      'Eliminar punto de encuentro',
      `Se eliminará “${nombre}”. Si tiene reservas asociadas, el sistema conservará su histórico y lo desactivará automáticamente.`,
      () => this.deletePunto(punto),
      undefined,
      { confirmText: 'Eliminar punto', cancelText: 'Conservar' }
    );
  }

  private deletePunto(punto: Punto): void {
    const id = this.getPuntoId(punto);
    if (!id || this.isDeleting(id)) return;

    this.setDeleting(id, true);
    const request = this.puntosSvc.deletePunto(id).pipe(
      finalize(() => this.setDeleting(id, false))
    ).subscribe({
      next: (result: any) => {
        this.puntos.update((items) => items.filter((item) => this.getPuntoId(item) !== id));
        this.total.update((value) => Math.max(0, value - 1));

        if (this.puntos().length === 0 && this.page() > 1) {
          this.page.update((value) => value - 1);
        }
        this.buscarPuntos(false);
        this.alerts.successToast(
          result?.accion === 'DESACTIVADO' ? 'Punto retirado' : 'Punto eliminado',
          result?.accion === 'DESACTIVADO'
            ? 'Tenía reservas asociadas; su histórico se conservó.'
            : 'El punto y sus horarios se eliminaron definitivamente.'
        );
      },
      error: (error) => {
        this.alerts.showAlert({
          type: 'error',
          title: 'No se pudo eliminar',
          message: toUserErrorMessage(error, 'No fue posible eliminar el punto de encuentro.'),
          autoClose: false
        });
      }
    });
    this.deleteRequests.add(request);
  }

  isDeleting(id: number): boolean {
    return this.deletingIds().has(id);
  }

  private setDeleting(id: number, deleting: boolean): void {
    this.deletingIds.update((current) => {
      const next = new Set(current);
      if (deleting) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  prevPage(): void {
    if (this.page() <= 1 || this.isSearching()) return;
    this.page.update((value) => value - 1);
    this.buscarPuntos(false);
  }

  nextPage(): void {
    if (this.page() >= this.totalPages() || this.isSearching()) return;
    this.page.update((value) => value + 1);
    this.buscarPuntos(false);
  }

  descargarExcel(): void {
    if (!this.canExportPuntos || this.descargandoExcel) return;

    this.descargandoExcel = true;
    this.puntosSvc.exportarExcel(this.searchTerm, this.selectedRoute).pipe(
      finalize(() => this.descargandoExcel = false)
    ).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'Puntos_Encuentro.xlsx';
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (error) => {
        this.alerts.showAlert({
          type: 'error',
          title: 'No se pudo exportar',
          message: toUserErrorMessage(error, 'No fue posible generar el archivo de puntos.'),
          autoClose: false
        });
      }
    });
  }

  configuredSchedules(punto: Punto): PuntoHorario[] {
    return (punto.horarios || []).filter((horario) => !this.isPendingSchedule(horario));
  }

  pendingSchedules(punto: Punto): PuntoHorario[] {
    return (punto.horarios || []).filter((horario) => this.isPendingSchedule(horario));
  }

  isPendingSchedule(horario: PuntoHorario): boolean {
    const value = String(horario?.HoraSalida || '').trim().toLowerCase();
    return !value || value === 'pendiente';
  }

  scheduleTourName(horario: PuntoHorario): string {
    return String(horario?.NombreTour || `Tour ${horario?.Id_Tour || '—'}`);
  }

  getPuntoId(punto: Punto): number {
    return Number(punto?.Id_Punto || punto?.IdPunto || 0);
  }

  getPuntoName(punto: Punto): string {
    return String(punto?.NombrePunto || punto?.Nombre_Punto || 'Punto sin nombre');
  }

  routeLabel(route: string | undefined): string {
    const value = String(route || '').trim();
    return value.toUpperCase() === 'PENDIENTE' ? 'Ruta pendiente' : `Ruta ${value}`;
  }

  private sortRoutes(routes: string[]): string[] {
    return [...routes].sort((a, b) => {
      const routeA = String(a || '').trim();
      const routeB = String(b || '').trim();
      const pendingA = routeA.toUpperCase() === 'PENDIENTE';
      const pendingB = routeB.toUpperCase() === 'PENDIENTE';
      if (pendingA !== pendingB) return pendingA ? 1 : -1;
      return routeA.localeCompare(routeB, 'es', { numeric: true, sensitivity: 'base' });
    });
  }

  trackById(_: number, item: Punto): number {
    return this.getPuntoId(item);
  }
}
