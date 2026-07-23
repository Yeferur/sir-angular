import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { puntosService, Punto } from '../../../services/Puntos/puntos';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';

import { BehaviorSubject, Subject, combineLatest, of } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  startWith,
  switchMap
} from 'rxjs/operators';

type VM = {
  puntos: Punto[];
  total: number;
  page: number;
  totalPages: number;
  hasLoadedOnce: boolean;
};

@Component({
  selector: 'app-ver-puntos',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingStateComponent],
  templateUrl: './ver-puntos.html',
  styleUrls: ['./ver-puntos.css']
})
export class VerPuntos implements OnInit {

  private puntosSvc = inject(puntosService);
  private router = inject(Router);
  private permisosService = inject(PermisosService);
  private alerts = inject(SirAlertService);

  // ui
  searchTerm = '';
  page = 1;
  limit = 10;
  // streams
  private search$ = new Subject<string>();
  private page$ = new BehaviorSubject<number>(1);

  vm$ = combineLatest([
    this.page$,
    this.search$.pipe(
      map(v => (v ?? '').trim()),
      debounceTime(300),
      distinctUntilChanged(),
      startWith('')
    )
  ]).pipe(
    switchMap(([page, q]) =>
      this.puntosSvc.getPuntos(page, this.limit, q).pipe(
        catchError(err => {
          console.error('Error cargando puntos', err);
          return of({ data: [], total: 0 });
        }),
        map(res => {
          const total = Number(res?.total || 0);
          const puntos = (res?.data || []) as Punto[];
          const totalPages = Math.max(1, Math.ceil(total / this.limit));
          return {
            puntos,
            total,
            page,
            totalPages,
            hasLoadedOnce: true
          } as VM;
        })
      )
    ),
    startWith({
      puntos: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasLoadedOnce: false
    } as VM)
  );

  ngOnInit(): void { }

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

  /* ===============================
     NAV
     =============================== */
  crearPunto() {
    if (!this.canCreatePunto) {
      this.alerts.errorToast('Acceso denegado', 'No tienes permiso para crear puntos.');
      return;
    }
    this.router.navigate(['/Puntos/NuevoPunto']);
  }

  irAOrdenarPuntos() {
    if (!this.canSortPuntos) {
      this.alerts.errorToast('Acceso denegado', 'No tienes permiso para ordenar puntos.');
      return;
    }
    this.router.navigate(['/Puntos/OrdenarPuntos']);
  }

  editarPunto(p: Punto) {
    const id = Number((p as any).Id_Punto || (p as any).IdPunto);
    if (!isNaN(id)) {
      this.router.navigate(['/Puntos/Editar', id]);
    }
  }

  /* ===============================
     ELIMINAR
     =============================== */
  confirmEliminarPunto(p: Punto) {
    const id = Number((p as any).Id_Punto || (p as any).IdPunto);
    if (isNaN(id)) return;

    this.alerts.confirm(
      'Eliminar punto',
      '¿Deseas eliminar este punto? Esta acción no se puede deshacer.',
      () => this.deletePunto(p),
      undefined,
      { confirmText: 'Eliminar', cancelText: 'Cancelar', type: 'warning' }
    );
  }

  private deletePunto(p: Punto) {
    const id = Number((p as any).Id_Punto || (p as any).IdPunto);
    if (isNaN(id)) return;

    this.puntosSvc.deletePunto(id).subscribe({
      next: () => {
        // animación opcional
        try { (p as any)._deleting = true; } catch { }

        setTimeout(() => {
          // recargar lista
          this.page$.next(this.page);
          this.alerts.showAlert({
            type: 'success',
            title: 'Eliminado',
            message: 'Punto eliminado correctamente',
            autoClose: true
          });
        }, 350);
      },
      error: err => {
        console.error('Error eliminando punto', err);
        this.alerts.showAlert({
          type: 'error',
          title: 'Error',
          message: 'No se pudo eliminar el punto',
          autoClose: false
        });
      }
    });
  }

  /* ===============================
     SEARCH
     =============================== */
  onSearchInput(v: string) {
    this.searchTerm = v;
    this.page = 1;
    this.page$.next(1);
    this.search$.next(v);
  }

  clearSearch() {
    this.searchTerm = '';
    this.page = 1;
    this.page$.next(1);
    this.search$.next('');
  }

  /* ===============================
     PAGINATION
     =============================== */
  prevPage() {
    if (this.page <= 1) return;
    this.page--;
    this.page$.next(this.page);
  }

  nextPage(totalPages: number) {
    if (this.page >= totalPages) return;
    this.page++;
    this.page$.next(this.page);
  }

  /* ===============================
     EXCEL EXPORT
     =============================== */
  descargandoExcel = false;

  descargarExcel() {
    if (!this.canExportPuntos) {
      this.alerts.errorToast('Acceso denegado', 'No tienes permiso para exportar puntos.');
      return;
    }

    this.descargandoExcel = true;
    this.puntosSvc.exportarExcel(this.searchTerm).subscribe({
      next: (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'Puntos_Encuentro.xlsx';
        link.click();
        URL.revokeObjectURL(url);
        this.descargandoExcel = false;
      },
      error: (err: any) => {
        console.error('Error al exportar puntos al Excel', err);
        this.alerts.showAlert({
          type: 'error',
          title: 'Error',
          message: 'No se pudieron exportar los puntos desde el servidor.',
          autoClose: false
        });
        this.descargandoExcel = false;
      }
    });
  }

  trackById(_: number, item: Punto) {
    return Number((item as any).Id_Punto || (item as any).IdPunto);
  }
}
