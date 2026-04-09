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
  isLoadingRutas = signal<boolean>(false);
  isLoadingPuntos = signal<boolean>(false);
  isSaving = signal<boolean>(false);
  hasPendingOrderChanges = signal<boolean>(false);

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
        await this.loadPuntosByRuta();
      }
    } catch (error) {
      console.error('Error cargando rutas de puntos:', error);
      this.navbar.errorToast('Error', 'No fue posible cargar las rutas.');
      this.rutas.set([]);
    } finally {
      this.isLoadingRutas.set(false);
    }
  }

  async onRutaChange(): Promise<void> {
    this.hasPendingOrderChanges.set(false);
    await this.loadPuntosByRuta();
  }

  private async loadPuntosByRuta(): Promise<void> {
    const ruta = (this.rutaSeleccionada || '').trim();
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
      console.error('Error cargando puntos por ruta:', error);
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
    if (this.isSaving()) return;
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

    this.isSaving.set(true);

    const orden: OrdenPuntoItem[] = puntos.map((p, index) => ({
      id_punto: this.getPuntoId(p),
      posicion: index + 1,
    }));

    try {
      await firstValueFrom(this.puntosSvc.updateOrdenPuntosPorRuta(ruta, orden));
      this.hasPendingOrderChanges.set(false);
      this.navbar.successToast('Orden guardado', `Se actualizó el orden de ${orden.length} puntos.`);
      await this.loadPuntosByRuta();
    } catch (error: any) {
      console.error('Error guardando orden de puntos:', error);
      const message = error?.error?.message || 'No fue posible guardar el orden.';
      this.navbar.errorToast('Error', message);
    } finally {
      this.isSaving.set(false);
    }
  }

  trackByPuntoId(_: number, p: Punto): number {
    return this.getPuntoId(p);
  }

  nombrePunto(p: Punto): string {
    return this.getNombrePunto(p);
  }
}
