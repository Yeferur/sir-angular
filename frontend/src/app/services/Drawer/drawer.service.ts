import { Injectable, signal } from '@angular/core';

export type DrawerType = 'reserva' | 'transfer' | 'mapa' | 'duplicar' | 'app-updates';

export interface DrawerMapDestination {
  lat: number;
  lng: number;
  nombre?: string;
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

  readonly isOpen = () => !!this._drawer();

  openReserva(id: string): void {
    this._drawer.set({ type: 'reserva', id });
  }

  openTransfer(id: string): void {
    this._drawer.set({ type: 'transfer', id });
  }

  openMapa(puntos: any[], destino?: DrawerMapDestination | null): void {
    this._drawer.set({ type: 'mapa', puntos, destino: destino ?? null });
  }

  openDuplicar(props: Record<string, any>): void {
    this._drawer.set({ type: 'duplicar', props });
  }

  openAppUpdates(): void {
    this._drawer.set({ type: 'app-updates' });
  }

  close(): void {
    this._drawer.set(null);
  }
}
