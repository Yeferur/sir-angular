import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface CuposInfo {
  nombreTour?: string;
  Nombre_Tour?: string;
  cupoTotal?: number;
  ocupados?: number;
  cuposDisponibles?: number;
  disponiblesDespues?: number;
}

type CupoState = 'green' | 'blue' | 'yellow' | 'red';

interface CuposViewModel {
  nombreTour: string;
  cupoTotal: number;
  ocupados: number;
  cuposDisponibles: number;
  disponiblesDespues: number;
  ocupacionPorcentaje: number;
  estado: CupoState;
}

@Component({
  selector: 'app-cupos-widget',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cupos.html',
  styleUrls: ['./cupos.css']
})
export class CuposWidgetComponent {
  public cuposInfoSignal = signal<CuposInfo | null>(null);

  @Input() set cuposInfo(value: CuposInfo | null) {
    this.cuposInfoSignal.set(value);
  }

  viewModel = computed<CuposViewModel | null>(() => {
    const cupos = this.cuposInfoSignal();
    if (!cupos) return null;

    const cupoTotal = Math.max(0, Number(cupos.cupoTotal ?? 0));
    const ocupados = Math.max(0, Number(cupos.ocupados ?? 0));
    const cuposDisponibles = Math.max(
      0,
      Number(
        cupos.cuposDisponibles ??
        (cupoTotal > 0 ? cupoTotal - ocupados : 0)
      )
    );
    const disponiblesDespues = Math.max(0, Number(cupos.disponiblesDespues ?? cuposDisponibles));
    const ocupacionPorcentaje = cupoTotal > 0 ? Math.min(100, (ocupados / cupoTotal) * 100) : 0;

    return {
      nombreTour: String(cupos.nombreTour ?? cupos.Nombre_Tour ?? 'Tour sin nombre'),
      cupoTotal,
      ocupados,
      cuposDisponibles,
      disponiblesDespues,
      ocupacionPorcentaje,
      estado: this.getStateClass(ocupacionPorcentaje),
    };
  });

  getStateClass(ocupacionPorcentaje: number): CupoState {
    if (ocupacionPorcentaje >= 90) return 'red';
    if (ocupacionPorcentaje >= 60) return 'yellow';
    if (ocupacionPorcentaje >= 30) return 'blue';
    return 'green';
  }
}
