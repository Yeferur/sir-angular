import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { puntosService, Punto } from '../../../services/Puntos/puntos';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

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
  imports: [CommonModule, FormsModule],
  templateUrl: './ver-puntos.html',
  styleUrls: ['./ver-puntos.css']
})
export class VerPuntos implements OnInit {

  private puntosSvc = inject(puntosService);
  private navbar = inject(DynamicIslandGlobalService);
  private router = inject(Router);

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

  ngOnInit(): void {}

  /* ===============================
     NAV
     =============================== */
  crearPunto() {
    this.router.navigate(['/Puntos/NuevoPunto']);
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

    this.navbar.alert.set({
      type: 'warning',
      title: 'Eliminar punto',
      message: '¿Deseas eliminar este punto? Esta acción no se puede deshacer.',
      autoClose: false,
      buttons: [
        {
          text: 'Eliminar',
          style: 'delete',
          onClick: () => {
            this.navbar.alert.set(null);
            this.deletePunto(p);
          }
        },
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.navbar.alert.set(null)
        }
      ]
    });
  }

  private deletePunto(p: Punto) {
    const id = Number((p as any).Id_Punto || (p as any).IdPunto);
    if (isNaN(id)) return;

    this.puntosSvc.deletePunto(id).subscribe({
      next: () => {
        // animación opcional
        try { (p as any)._deleting = true; } catch {}

        setTimeout(() => {
          // recargar lista
          this.page$.next(this.page);
          this.navbar.alert.set({
            type: 'success',
            title: 'Eliminado',
            message: 'Punto eliminado correctamente',
            autoClose: true
          });
        }, 350);
      },
      error: err => {
        console.error('Error eliminando punto', err);
        this.navbar.alert.set({
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

  trackById(_: number, item: Punto) {
    return Number((item as any).Id_Punto || (item as any).IdPunto);
  }
}
