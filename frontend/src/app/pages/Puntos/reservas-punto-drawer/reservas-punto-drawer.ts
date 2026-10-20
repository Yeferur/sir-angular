import { CommonModule, DatePipe } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, finalize } from 'rxjs';
import { SirDateRange, SirDateRangePickerComponent } from '../../../shared/date-range-picker/date-range-picker';
import { SirSelectComponent, SirSelectOption } from '../../../shared/select/select';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { QueryEmptyStateComponent } from '../../../shared/query-empty-state/query-empty-state';
import { DrawerCloseButtonComponent } from '../../../shared/drawer-close-button/drawer-close-button';
import { toUserErrorMessage } from '../../../shared/errors/user-error-message';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { puntosService, ReservasPuntoFilters, ReservasPuntoPage } from '../../../services/Puntos/puntos';

function todayBogota(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

@Component({
  selector: 'app-reservas-punto-drawer',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, SirDateRangePickerComponent,
    SirSelectComponent, LoadingStateComponent, QueryEmptyStateComponent, DrawerCloseButtonComponent],
  templateUrl: './reservas-punto-drawer.html',
  styleUrls: ['../../listado-reservas-transfers.css', './reservas-punto-drawer.css'],
})
export class ReservasPuntoDrawerComponent implements OnInit, OnDestroy {
  @Input({ required: true }) puntoId = '';
  @Input() puntoNombre = '';
  @Output() closed = new EventEmitter<void>();

  private readonly api = inject(puntosService);
  private readonly permisos = inject(PermisosService);
  private readonly subscriptions = new Subscription();
  private request?: Subscription;
  private exportRequest?: Subscription;
  readonly pageSize = 25;
  readonly draftRange = signal<SirDateRange>({ start: todayBogota(), end: todayBogota() });
  readonly draftEstado = signal('');
  readonly applied = signal<ReservasPuntoFilters | null>(null);
  readonly result = signal<ReservasPuntoPage | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly exporting = signal(false);
  readonly estadoOptions = signal<SirSelectOption[]>([{ value: '', label: 'Todos los estados' }]);

  get canExport(): boolean {
    return this.permisos.tienePermiso('PUNTOS.RESERVAS.EXPORTAR');
  }

  get rangeError(): string {
    const { start, end } = this.draftRange();
    if (!start || !end) return 'Selecciona un período completo.';
    if (start > end) return 'La fecha inicial debe ser anterior a la final.';
    if ((Date.parse(end) - Date.parse(start)) / 86400000 > 365) return 'El período máximo es de 366 días.';
    return '';
  }

  ngOnInit(): void {
    this.subscriptions.add(this.api.getEstadosReservasPuntos().subscribe({
      next: states => this.estadoOptions.set([{ value: '', label: 'Todos los estados' },
        ...(states || []).map(state => ({ value: state, label: state }))]),
    }));
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
    this.exportRequest?.unsubscribe();
    this.subscriptions.unsubscribe();
  }

  setRange(range: SirDateRange): void {
    this.draftRange.set({ ...range });
  }

  buscar(page = 1): void {
    if (this.loading()) return;
    if (page === 1 && this.rangeError) return;
    const previous = this.applied();
    const filters = page === 1
      ? { desde: this.draftRange().start!, hasta: this.draftRange().end!, estado: this.draftEstado() }
      : previous;
    if (!filters) return;
    if (page === 1) this.applied.set(filters);
    this.error.set('');
    this.loading.set(true);
    this.request = this.api.getReservasPunto(Number(this.puntoId), filters, page, this.pageSize).pipe(
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: result => this.result.set(result),
      error: error => {
        if (page === 1) this.applied.set(previous);
        this.error.set(toUserErrorMessage(error, 'No fue posible consultar las reservas asociadas.'));
      },
    });
  }

  exportar(): void {
    const filters = this.applied();
    if (!this.canExport || !filters || !this.result()?.total || this.loading() || this.exporting()) return;
    this.exporting.set(true);
    this.exportRequest = this.api.exportarReservasPunto(Number(this.puntoId), filters).pipe(
      finalize(() => this.exporting.set(false))
    ).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Reservas_Punto_${this.puntoId}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: error => this.error.set(toUserErrorMessage(error, 'No fue posible exportar las reservas.')),
    });
  }
}
