import { Injectable, signal } from '@angular/core';

export interface UiBaseStateOptions {
  cupos?: boolean;
  reserva?: boolean;
  transfer?: boolean;
}

@Injectable({ providedIn: 'root' })
export class UiStateService {
  readonly needsRefresh = signal<string>('');
  readonly reservaId = signal<string | null>(null);
  readonly transferId = signal<string | null>(null);
  readonly cuposInfo = signal<any>(null);

  clearBaseState(options: UiBaseStateOptions = {}): void {
    const {
      cupos = true,
      reserva = true,
      transfer = true,
    } = options;

    if (cupos) this.cuposInfo.set(null);
    if (reserva) this.reservaId.set(null);
    if (transfer) this.transferId.set(null);
  }

  resetSessionUi(): void {
    this.needsRefresh.set('');
    this.clearBaseState({
      cupos: true,
      reserva: true,
      transfer: true,
    });
  }
}
