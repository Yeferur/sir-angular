import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-bottom-pagination',
  standalone: true,
  templateUrl: './bottom-pagination.html',
  styleUrl: './bottom-pagination.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BottomPaginationComponent {
  @Input() page = 1;
  @Input() pageSize = 25;
  @Input() total = 0;
  @Input() totalPages = 1;
  @Input() singularLabel = 'registro';
  @Input() pluralLabel = 'registros';
  @Input() disabled = false;
  @Output() pageChange = new EventEmitter<number>();

  get firstItem(): number {
    return this.total > 0 ? (Math.max(1, this.page) - 1) * Math.max(1, this.pageSize) + 1 : 0;
  }

  get lastItem(): number {
    return this.total > 0 ? Math.min(Math.max(1, this.page) * Math.max(1, this.pageSize), this.total) : 0;
  }

  get summary(): string {
    const label = this.total === 1 ? this.singularLabel : this.pluralLabel;
    const pages = Math.max(1, this.totalPages);
    return `${this.format(this.firstItem)}–${this.format(this.lastItem)} de ${this.format(this.total)} ${label} · Página ${this.format(this.page)} de ${this.format(pages)}`;
  }

  goTo(page: number): void {
    if (this.disabled || page < 1 || page > this.totalPages || page === this.page) return;
    this.pageChange.emit(page);
  }

  private format(value: number): string {
    return value.toLocaleString('es-CO');
  }
}
