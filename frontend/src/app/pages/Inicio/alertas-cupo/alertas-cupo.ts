import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { Tour } from '../../../services/inicio';

type AlertaCupo = {
  idTour: number;
  nombreTour: string;
  cuposDisponibles: number;
  severidad: 'critico' | 'riesgo';
};

@Component({
  selector: 'app-alertas-cupo',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './alertas-cupo.html',
  styleUrls: ['./alertas-cupo.css'],
})
export class AlertasCupoComponent {
  private toursSignal = signal<Tour[]>([]);

  @Input() set tours(value: Tour[] | null) {
    this.toursSignal.set(Array.isArray(value) ? value : []);
  }

  alertas = computed<AlertaCupo[]>(() => {
    const tours = this.toursSignal();
    const tourRioClaro = tours.find((t) => Number(t.Id_Tour) === 1);
    const tourHacienda = tours.find((t) => Number(t.Id_Tour) === 5);

    const normalizados = tours.filter((t) => Number(t.Id_Tour) !== 1 && Number(t.Id_Tour) !== 5);

    // Regla de negocio: Rio Claro comparte la misma bolsa de cupos de Hacienda Napoles (tour 5).
    if (tourRioClaro && tourHacienda) {
      normalizados.push({
        Id_Tour: 5,
        Nombre_Tour: `${tourRioClaro.Nombre_Tour} Y ${tourHacienda.Nombre_Tour}`,
        cupos: Number(tourHacienda.cupos || 0),
        NumeroPasajeros: Number(tourRioClaro.NumeroPasajeros || 0) + Number(tourHacienda.NumeroPasajeros || 0),
        totalPrivados: Number(tourRioClaro.totalPrivados || 0) + Number(tourHacienda.totalPrivados || 0),
        privados: [],
      });
    }

    return normalizados
      .map((tour) => {
        const disponibles = Number(tour.cupos || 0) - Number(tour.NumeroPasajeros || 0);
        return {
          idTour: tour.Id_Tour,
          nombreTour: tour.Nombre_Tour,
          cuposDisponibles: disponibles,
          severidad: disponibles < 3 ? 'critico' as const : 'riesgo' as const,
        };
      })
      .filter((t) => t.cuposDisponibles < 5)
      .sort((a, b) => a.cuposDisponibles - b.cuposDisponibles);
  });

  totalCriticos = computed(() => this.alertas().filter((a) => a.severidad === 'critico').length);
}
