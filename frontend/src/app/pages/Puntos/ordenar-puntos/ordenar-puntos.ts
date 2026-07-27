import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';

import { puntosService, Punto, OrdenPuntoItem, EstadoOperatividadPunto } from '../../../services/Puntos/puntos';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';

@Component({
  selector: 'app-ordenar-puntos',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule, LoadingStateComponent],
  templateUrl: './ordenar-puntos.html',
  styleUrls: ['./ordenar-puntos.css']
})
export class OrdenarPuntosComponent implements OnInit {
  private puntosSvc = inject(puntosService);
  private alerts = inject(SirAlertService);
  private router = inject(Router);

  rutas = signal<string[]>([]);
  puntos = signal<Punto[]>([]);

  rutaSeleccionada = '';
  isLoadingRutas = signal<boolean>(true);
  isLoadingPuntos = signal<boolean>(false);
  isSaving = signal<boolean>(false);
  isValidatingLocations = signal<boolean>(false);
  hasPendingOrderChanges = signal<boolean>(false);
  pendingAssignmentCount = signal<number>(0);
  loadError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.loadRutas();
  }

  private getPuntoId(p: Punto): number {
    return Number((p as any).Id_Punto || (p as any).IdPunto || 0);
  }

  private getNombrePunto(p: Punto): string {
    return String((p as any).NombrePunto || (p as any).Nombre_Punto || 'Punto sin nombre');
  }

  async loadRutas(): Promise<void> {
    this.isLoadingRutas.set(true);
    this.loadError.set(null);
    try {
      const rutas = await firstValueFrom(this.puntosSvc.getRutasPuntos());
      const disponibles = (Array.isArray(rutas) ? rutas : [])
        .filter(ruta => String(ruta).trim().toUpperCase() !== 'PENDIENTE');
      this.rutas.set(disponibles.sort(
        (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' })
      ));
      try {
        const pendientes = await firstValueFrom(this.puntosSvc.getPuntosPorRuta('PENDIENTE'));
        this.pendingAssignmentCount.set(Array.isArray(pendientes) ? pendientes.length : 0);
      } catch {
        this.pendingAssignmentCount.set(0);
      }

      if (!this.rutaSeleccionada && this.rutas().length) {
        this.rutaSeleccionada = this.rutas()[0];
        await this.loadPuntosByRuta(this.rutaSeleccionada);
      } else if (!this.rutas().length) {
        this.puntos.set([]);
      }
    } catch (error) {
      this.loadError.set('No fue posible cargar las rutas y los puntos disponibles.');
      this.rutas.set([]);
      this.puntos.set([]);
    } finally {
      this.isLoadingRutas.set(false);
    }
  }

  asignarRutasPendientes(): void {
    void this.router.navigate(['/Puntos/VerPuntos'], {
      queryParams: { ruta: 'PENDIENTE' }
    });
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
      void this.validarOperatividad(ruta);
    } catch (error) {
      this.alerts.errorToast('Error', 'No fue posible cargar los puntos de la ruta seleccionada.');
      this.puntos.set([]);
    } finally {
      this.isLoadingPuntos.set(false);
    }
  }

  private async validarOperatividad(ruta: string): Promise<void> {
    this.isValidatingLocations.set(true);
    try {
      const estados = await firstValueFrom(this.puntosSvc.getOperatividadPuntosPorRuta(ruta));
      if (this.rutaSeleccionada !== ruta) return;
      const porId = new Map<number, EstadoOperatividadPunto>(
        (estados || []).map(estado => [Number(estado.Id_Punto), estado])
      );
      this.puntos.update(puntos => puntos.map(punto => ({
        ...punto,
        _operatividad: porId.get(this.getPuntoId(punto))
      })));
    } catch {
      if (this.rutaSeleccionada !== ruta) return;
      this.puntos.update(puntos => puntos.map(punto => ({
        ...punto,
        _operatividad: {
          Id_Punto: this.getPuntoId(punto),
          estado: 'NO_VERIFICADO',
          mensaje: 'No fue posible consultar OSRM.'
        }
      })));
    } finally {
      if (this.rutaSeleccionada === ruta) this.isValidatingLocations.set(false);
    }
  }

  drop(event: CdkDragDrop<Punto[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    if (this.rutaSeleccionada === '0' && event.currentIndex === 0) {
      this.alerts.warningToast('Punto protegido', 'Estación Poblado debe permanecer en la primera posición.');
      return;
    }
    const ordered = [...this.puntos()];
    moveItemInArray(ordered, event.previousIndex, event.currentIndex);
    this.puntos.set(ordered);
    this.hasPendingOrderChanges.set(true);
  }

  isProtected(punto: Punto): boolean {
    return Boolean(punto.EsProtegido);
  }

  operatividadLabel(punto: Punto): string {
    const estado = punto._operatividad?.estado;
    if (estado === 'OPERATIVO') return 'Operativo';
    if (estado === 'NO_OPERATIVO') return 'No operativo';
    if (estado === 'SIN_COORDENADAS') return 'Sin coordenadas';
    return 'No verificado';
  }

  totalOperativos(): number {
    return this.puntos().filter(p => p._operatividad?.estado === 'OPERATIVO').length;
  }

  totalConAlertas(): number {
    return this.puntos().filter(p =>
      p._operatividad && p._operatividad.estado !== 'OPERATIVO'
    ).length;
  }

  async guardarOrden(): Promise<void> {
    if (this.isSaving() || !this.hasPendingOrderChanges()) return;
    const ruta = (this.rutaSeleccionada || '').trim();
    const puntos = this.puntos();

    if (!ruta) {
      this.alerts.warningToast('Ruta requerida', 'Selecciona una ruta antes de guardar.');
      return;
    }

    if (!puntos.length) {
      this.alerts.warningToast('Sin puntos', 'No hay puntos para ordenar en esta ruta.');
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
      this.alerts.successToast('Orden guardado', `Se actualizó el orden de ${orden.length} puntos.`);
      await this.loadPuntosByRuta(ruta);
    } catch (error: any) {
      const message = error?.error?.message || 'No fue posible guardar el orden.';
      this.alerts.errorToast('Error', message);
    } finally {
      this.isSaving.set(false);
    }
  }

  private buildRouteChangeMessage(): string {
    return 'Tienes cambios sin guardar en esta ruta. Si cambias de ruta, perderás el orden actual. ¿Deseas continuar?';
  }

  private requestRouteChangeConfirmation(): Promise<boolean> {
    return new Promise((resolve) => {
      this.alerts.confirm(
        'Cambios sin guardar',
        this.buildRouteChangeMessage(),
        () => resolve(true),
        () => resolve(false),
        { confirmText: 'Cambiar ruta', cancelText: 'Cancelar', type: 'warning' }
      );
    });
  }

  private buildSaveConfirmationMessage(ruta: string, cantidad: number): string {
    return `Vas a guardar el nuevo orden de ${cantidad} puntos para la Ruta ${ruta}. ¿Deseas continuar?`;
  }

  private requestSaveOrderConfirmation(ruta: string, cantidad: number): Promise<boolean> {
    return new Promise((resolve) => {
      this.alerts.confirm(
        '¿Guardar orden?',
        this.buildSaveConfirmationMessage(ruta, cantidad),
        () => resolve(true),
        () => resolve(false),
        { confirmText: 'Guardar orden', cancelText: 'Cancelar', type: 'info' }
      );
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
