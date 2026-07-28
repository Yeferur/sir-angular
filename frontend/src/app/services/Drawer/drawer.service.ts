import { Injectable, signal } from '@angular/core';

export type DrawerType = 'reserva' | 'transfer' | 'tour' | 'usuario' | 'mapa' | 'duplicar' | 'app-updates' | 'programacion-listado';

export interface DrawerMapDestination {
  lat: number;
  lng: number;
  nombre?: string;
  horaSalidaBase?: string | null;
}

export interface DrawerState {
  type: DrawerType;
  // reserva / transfer
  id?: string;
  // mapa
  puntos?: any[];
  destino?: DrawerMapDestination | null;
  // duplicar
  props?: Record<string, any>;
}

@Injectable({ providedIn: 'root' })
export class SirDrawerService {

  private _drawer = signal<DrawerState | null>(null);
  readonly drawer = this._drawer.asReadonly();
  private _closing = signal(false);
  readonly closing = this._closing.asReadonly();
  private closeTimer?: ReturnType<typeof setTimeout>;

  readonly isOpen = () => !!this._drawer();

  private open(drawer: DrawerState): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
    this._closing.set(false);
    this._drawer.set(drawer);
  }

  openReserva(id: string): void {
    this.open({ type: 'reserva', id });
  }

  openTransfer(id: string): void {
    this.open({ type: 'transfer', id });
  }

  openTour(id: string): void {
    this.open({ type: 'tour', id });
  }

  openUsuario(id: string): void {
    this.open({ type: 'usuario', id });
  }

  openMapa(puntos: any[], destino?: DrawerMapDestination | null): void {
    this.open({ type: 'mapa', puntos, destino: destino ?? null });
  }

  openDuplicar(props: Record<string, any>): void {
    this.open({ type: 'duplicar', props });
  }

  openAppUpdates(): void {
    this.open({ type: 'app-updates' });
  }

  openProgramacionListado(props: Record<string, any>): void {
    this.open({ type: 'programacion-listado', props });
  }

  close(immediate = false): void {
    if (!this._drawer() || this._closing()) return;

    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (immediate || reduceMotion) {
      this._drawer.set(null);
      this._closing.set(false);
      return;
    }

    this._closing.set(true);
    this.closeTimer = setTimeout(() => {
      this._drawer.set(null);
      this._closing.set(false);
      this.closeTimer = undefined;
    }, 220);
  }
}
