import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core';
import { sanitizeUserErrorMessage } from '../errors/user-error-message';

export type LoadingStateMode = 'loading' | 'error' | 'empty';

@Component({
  selector: 'app-loading-state',
  standalone: true,
  templateUrl: './loading-state.html',
  styleUrls: ['./loading-state.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadingStateComponent implements OnChanges, OnDestroy {
  @Input() mode: LoadingStateMode = 'loading';
  @Input() label = 'Cargando información…';
  @Input() detail = '';
  @Input() actionLabel = 'Reintentar';
  @Output() action = new EventEmitter<void>();

  readonly slow = signal(false);
  private slowTimer?: ReturnType<typeof setTimeout>;

  get visibleDetail(): string {
    return this.mode === 'error'
      ? sanitizeUserErrorMessage(this.detail, 'Intenta nuevamente.')
      : this.detail;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['mode'] && !changes['label']) return;
    this.resetSlowState();
  }

  ngOnDestroy(): void {
    if (this.slowTimer) clearTimeout(this.slowTimer);
  }

  private resetSlowState(): void {
    if (this.slowTimer) clearTimeout(this.slowTimer);
    this.slowTimer = undefined;
    this.slow.set(false);

    if (this.mode === 'loading') {
      this.slowTimer = setTimeout(() => this.slow.set(true), 4500);
    }
  }
}
