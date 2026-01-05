import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

// Define una interfaz para mayor claridad en los datos de entrada
export interface CuposInfo {
  nombreTour: string;
  cupoTotal: number;
  ocupados: number;
  cuposDisponibles: number;
  disponiblesDespues: number;
}

@Component({
  selector: 'app-cupos-widget', // Nuevo selector
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

  ocupacionPorcentaje = computed(() => {
    const cupos = this.cuposInfoSignal();
    if (!cupos || cupos.cupoTotal === 0) return 0;
    return (cupos.ocupados / cupos.cupoTotal) * 100;
  });

  colorClass = computed(() => {
    const porcentaje = this.ocupacionPorcentaje();
    if (porcentaje >= 90) return 'red';
    if (porcentaje >= 60) return 'yellow';
    if (porcentaje >= 30) return 'blue';
    return 'green';
  });
}
