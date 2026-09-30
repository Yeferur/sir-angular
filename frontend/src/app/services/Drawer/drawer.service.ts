import { Injectable, signal } from '@angular/core';

export type DrawerType = 'reserva' | 'transfer' | 'tour' | 'usuario' | 'mapa' | 'duplicar' | 'app-updates' | 'programacion-listado' | 'turnos-vacaciones' | 'turnos-intercambio' | 'mi-actividad';

export interface DrawerMapPoint {
  lat: number;
  lng: number;
  nombre?: string;
}

export interface DrawerMapDestination {
  // Campos planos para mantener compatibilidad con aperturas anteriores.
  lat?: number;
  lng?: number;
  nombre?: string;
  horaSalidaBase?: string | null;
  primeraParadaOperativa?: DrawerMapPoint | null;
  tour?: DrawerMapPoint | null;
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
  private _replacePhase = signal<'exit' | 'enter' | null>(null);
  readonly replacePhase = this._replacePhase.asReadonly();
  private replaceTimer?: ReturnType<typeof setTimeout>;

  readonly isOpen = () => !!this._drawer();

  private open(drawer: DrawerState): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
    this._closing.set(false);
    if (this.replaceTimer) clearTimeout(this.replaceTimer);
    this.replaceTimer = undefined;
    const currentType = this._drawer()?.type;
    const switchingActivity = currentType !== drawer.type
      && (currentType === 'mi-actividad' || currentType === 'app-updates')
      && (drawer.type === 'mi-actividad' || drawer.type === 'app-updates');
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (switchingActivity && !reduceMotion) {
      this._replacePhase.set('exit');
      this.replaceTimer = setTimeout(() => {
        this._drawer.set(drawer);
        this._replacePhase.set('enter');
        this.replaceTimer = setTimeout(() => {
          this._replacePhase.set(null);
          this.replaceTimer = undefined;
        }, 260);
      }, 90);
      return;
    }
    this._replacePhase.set(null);
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

  /** Alias de compatibilidad: todos los avisos usan la bandeja unificada. */
  openNotifications(): void { this.openActivity(); }

  openActivity(props: { tab?: 'pendientes' | 'recordatorios'; focusId?: string } = {}): void {
    this.open({ type: 'mi-actividad', props });
  }

  openTurnosIntercambio(props: Record<string, any>): void { this.open({ type: 'turnos-intercambio', props }); }

  openProgramacionListado(props: Record<string, any>): void {
    this.open({ type: 'programacion-listado', props });
  }

  openTurnosVacaciones(props: Record<string, any>): void {
    this.open({ type: 'turnos-vacaciones', props });
  }

  close(immediate = false): void {
    if (!this._drawer() || this._closing()) return;
    if (this.replaceTimer) clearTimeout(this.replaceTimer);
    this.replaceTimer = undefined;
    this._replacePhase.set(null);

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
