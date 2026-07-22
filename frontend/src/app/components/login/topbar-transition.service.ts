import { Injectable, signal } from '@angular/core';

export interface IslandRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

@Injectable({ providedIn: 'root' })
export class TopbarTransitionService {
  readonly phase = signal<'login' | 'app' | 'expanding' | 'collapsing'>('login');

  requestExpandToFullscreen(): void { this.phase.set('expanding'); }
  markLoginReady(): void { this.phase.set('login'); }
  requestCollapseToApp(): void { this.phase.set('collapsing'); }
  markAppReady(): void { this.phase.set('app'); }
}
