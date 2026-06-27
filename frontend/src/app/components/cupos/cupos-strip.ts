import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface CuposStripInfo {
  nombreTour?: string;
  Nombre_Tour?: string;
  cupoTotal?: number;
  ocupados?: number;
  cuposDisponibles?: number;
}

type CupoEstado = 'green' | 'yellow' | 'red';

@Component({
  selector: 'app-cupos-strip',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cupos-strip.html',
  styleUrls: ['./cupos-strip.css'],
})
export class CuposStripComponent {
  private _info = signal<CuposStripInfo | null>(null);

  @Input() set cuposInfo(value: CuposStripInfo | null) {
    this._info.set(value);
  }

  vm = computed(() => {
    const d = this._info();
    if (!d) return null;

    const total       = Math.max(0, Number(d.cupoTotal ?? 0));
    const ocupados    = Math.max(0, Number(d.ocupados ?? 0));
    const disponibles = Math.max(0, Number(d.cuposDisponibles ?? (total - ocupados)));
    const pct         = total > 0 ? Math.min(100, (ocupados / total) * 100) : 0;

    let estado: CupoEstado = 'green';
    if (disponibles === 0 || pct >= 100) estado = 'red';
    else if (disponibles <= 4 || pct >= 85) estado = 'yellow';

    return { tour: String(d.nombreTour ?? d.Nombre_Tour ?? 'Tour'), total, ocupados, disponibles, pct, estado };
  });
}