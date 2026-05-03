import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { firstValueFrom } from 'rxjs';

import { puntosService, Punto, OrdenPuntoItem } from '../../../services/Puntos/puntos';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

@Component({
  selector: 'app-ordenar-puntos',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './ordenar-puntos.html',
  styleUrls: ['./ordenar-puntos.css']
})
export class OrdenarPuntosComponent implements OnInit {
  private puntosSvc = inject(puntosService);
  private navbar = inject(DynamicIslandGlobalService);

  rutas = signal<string[]>([]);
  puntos = signal<Punto[]>([]);

  rutaSeleccionada = '';
  previousRutaSeleccionada = '';
  isLoadingRutas = signal<boolean>(true);
  isLoadingPuntos = signal<boolean>(false);
  isSaving = signal<boolean>(false);
  hasPendingOrderChanges = signal<boolean>(false);
  skeletonRows = [0, 1, 2, 3, 4, 5];

  async ngOnInit(): Promise<void> {
    await this.loadRutas();
  }

  private getPuntoId(p: Punto): number {
    return Number((p as any).Id_Punto || (p as any).IdPunto || 0);
  }

  private getNombrePunto(p: Punto): string {
    return String((p as any).NombrePunto || (p as any).Nombre_Punto || 'Punto sin nombre');
  }

  private async loadRutas(): Promise<void> {
    this.isLoadingRutas.set(true);
    try {
      const rutas = await firstValueFrom(this.puntosSvc.getRutasPuntos());
      this.rutas.set(Array.isArray(rutas) ? rutas : []);

      if (!this.rutaSeleccionada && this.rutas().length) {
        this.rutaSeleccionada = this.rutas()[0];
        this.previousRutaSeleccionada = this.rutaSeleccionada;
        await this.loadPuntosByRuta(this.rutaSeleccionada);
      } else if (!this.rutas().length) {
        this.puntos.set([]);
      }
    } catch (error) {
      this.navbar.errorToast('Error', 'No fue posible cargar las rutas.');
      this.rutas.set([]);
    } finally {
      this.isLoadingRutas.set(false);
    }
  }

  async onRutaChangeRequest(nextRuta: string): Promise<void> {
    const nuevaRuta = String(nextRuta || '').trim();
    const rutaActual = String(this.rutaSeleccionada || '').trim();

    if (nuevaRuta === rutaActual) {
      return;
    }

    if (this.hasPendingOrderChanges()) {
      const confirmed = await this.requestRouteChangeConfirmation();
      if (!confirmed) {
        return;
      }
    }

    this.previousRutaSeleccionada = rutaActual;
    this.rutaSeleccionada = nuevaRuta;
    this.hasPendingOrderChanges.set(false);
    await this.loadPuntosByRuta(nuevaRuta);
  }

  private async loadPuntosByRuta(rutaInput?: string): Promise<void> {
    const ruta = (rutaInput ?? this.rutaSeleccionada ?? '').trim();
    if (!ruta) {
      this.puntos.set([]);
      return;
    }

    this.isLoadingPuntos.set(true);
    try {
      const puntos = await firstValueFrom(this.puntosSvc.getPuntosPorRuta(ruta));
      const list = Array.isArray(puntos) ? [...puntos] : [];
      list.sort((a: Punto, b: Punto) => Number(a.posicion || 0) - Number(b.posicion || 0));
      this.puntos.set(list);
    } catch (error) {
      this.navbar.errorToast('Error', 'No fue posible cargar los puntos de la ruta seleccionada.');
      this.puntos.set([]);
    } finally {
      this.isLoadingPuntos.set(false);
    }
  }

  drop(event: CdkDragDrop<Punto[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const ordered = [...this.puntos()];
    moveItemInArray(ordered, event.previousIndex, event.currentIndex);
    this.puntos.set(ordered);
    this.hasPendingOrderChanges.set(true);
  }

  async guardarOrden(): Promise<void> {
    if (this.isSaving() || !this.hasPendingOrderChanges()) return;
    const ruta = (this.rutaSeleccionada || '').trim();
    const puntos = this.puntos();

    if (!ruta) {
      this.navbar.warningToast('Ruta requerida', 'Selecciona una ruta antes de guardar.');
      return;
    }

    if (!puntos.length) {
      this.navbar.warningToast('Sin puntos', 'No hay puntos para ordenar en esta ruta.');
      return;
    }

    const confirmed = await this.requestSaveOrderConfirmation(ruta, puntos.length);
    if (!confirmed) return;

    this.isSaving.set(true);

    const orden: OrdenPuntoItem[] = puntos.map((p, index) => ({
      id_punto: this.getPuntoId(p),
      posicion: index + 1,
    }));

    try {
      await firstValueFrom(this.puntosSvc.updateOrdenPuntosPorRuta(ruta, orden));
      this.hasPendingOrderChanges.set(false);
      this.navbar.successToast('Orden guardado', `Se actualizó el orden de ${orden.length} puntos.`);
      await this.loadPuntosByRuta(ruta);
    } catch (error: any) {
      const message = error?.error?.message || 'No fue posible guardar el orden.';
      this.navbar.errorToast('Error', message);
    } finally {
      this.isSaving.set(false);
    }
  }

  private buildRouteChangeMessage(): string {
    return 'Tienes cambios sin guardar en esta ruta. Si cambias de ruta, perderás el orden actual. ¿Deseas continuar?';
  }

  private requestRouteChangeConfirmation(): Promise<boolean> {
    return new Promise((resolve) => {
      this.navbar.alert?.set?.({
        type: 'warning',
        title: 'Cambios sin guardar',
        message: this.buildRouteChangeMessage(),
        autoClose: false,
        buttons: [
          {
            text: 'Cancelar',
            style: 'secondary',
            onClick: () => {
              this.navbar.alert?.set?.(null);
              resolve(false);
            }
          },
          {
            text: 'Cambiar ruta',
            style: 'primary',
            onClick: () => {
              this.navbar.alert?.set?.(null);
              resolve(true);
            }
          }
        ]
      });
    });
  }

  private buildSaveConfirmationMessage(ruta: string, cantidad: number): string {
    return `Vas a guardar el nuevo orden de ${cantidad} puntos para la Ruta ${ruta}. ¿Deseas continuar?`;
  }

  private requestSaveOrderConfirmation(ruta: string, cantidad: number): Promise<boolean> {
    return new Promise((resolve) => {
      this.navbar.alert?.set?.({
        type: 'info',
        title: '¿Guardar orden?',
        message: this.buildSaveConfirmationMessage(ruta, cantidad),
        autoClose: false,
        buttons: [
          {
            text: 'Cancelar',
            style: 'secondary',
            onClick: () => {
              this.navbar.alert?.set?.(null);
              resolve(false);
            }
          },
          {
            text: 'Guardar Orden',
            style: 'primary',
            onClick: () => {
              this.navbar.alert?.set?.(null);
              resolve(true);
            }
          }
        ]
      });
    });
  }

  trackByPuntoId(_: number, p: Punto): number {
    return this.getPuntoId(p);
  }

  nombrePunto(p: Punto): string {
    return this.getNombrePunto(p);
  }

  formatPosition(index: number): string {
    return String(index).padStart(2, '0');
  }

  hasUnsavedChanges(): boolean {
    return this.hasPendingOrderChanges() && !this.isSaving();
  }
}
