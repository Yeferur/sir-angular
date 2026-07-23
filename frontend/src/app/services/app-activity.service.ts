import { Injectable, signal } from '@angular/core';

const SHOW_DELAY_MS = 180;
const MIN_VISIBLE_MS = 360;

/**
 * Actividad de primer plano compartida por navegación y HTTP.
 * Usa conteo de referencias: una petición no puede ocultar la barra mientras
 * otra siga trabajando.
 */
@Injectable({ providedIn: 'root' })
export class AppActivityService {
  private activeOperations = 0;
  private shownAt = 0;
  private showTimer?: ReturnType<typeof setTimeout>;
  private hideTimer?: ReturnType<typeof setTimeout>;

  private readonly _visible = signal(false);
  readonly visible = this._visible.asReadonly();

  private readonly _activeCount = signal(0);
  readonly activeCount = this._activeCount.asReadonly();

  begin(): () => void {
    let finished = false;
    this.activeOperations++;
    this._activeCount.set(this.activeOperations);

    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
    }

    if (!this._visible() && !this.showTimer) {
      this.showTimer = setTimeout(() => {
        this.showTimer = undefined;
        if (this.activeOperations <= 0) return;
        this.shownAt = performance.now();
        this._visible.set(true);
      }, SHOW_DELAY_MS);
    }

    return () => {
      if (finished) return;
      finished = true;
      this.finish();
    };
  }

  private finish(): void {
    this.activeOperations = Math.max(0, this.activeOperations - 1);
    this._activeCount.set(this.activeOperations);
    if (this.activeOperations > 0) return;

    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = undefined;
    }

    if (!this._visible()) return;

    const elapsed = performance.now() - this.shownAt;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = undefined;
      if (this.activeOperations > 0) return;
      this._visible.set(false);
    }, remaining);
  }
}
