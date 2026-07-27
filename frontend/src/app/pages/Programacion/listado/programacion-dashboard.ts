import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TourProgramacion } from '../../../interfaces/Programacion/reservas';
import { CountUpDirective } from '../../Inicio/count-up.directive';

@Component({
  selector: 'app-programacion-day-dashboard',
  standalone: true,
  imports: [CommonModule, CountUpDirective],
  templateUrl: './programacion-dashboard.html',
  styleUrl: './programacion-dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramacionDashboardComponent {
  tours = input.required<TourProgramacion[]>();
  updating = input(false);
  canCreate = input(false);
  totalReservasPrivadas = input(0);
  totalBusesPrivados = input(0);
  totalPaxPrivados = input(0);

  tourSelected = output<TourProgramacion>();
  privadosSelected = output<void>();

  get totalPasajeros(): number {
    return this.tours().reduce((total, tour) => total + Number(tour.totalPasajeros || 0), 0)
      + this.totalPaxPrivados();
  }

  get totalReservas(): number {
    return this.tours().reduce((total, tour) => total + Number(tour.totalReservas || 0), 0)
      + this.totalReservasPrivadas();
  }

  get operacionesActivas(): number {
    return this.tours().filter((tour) => Number(tour.totalPasajeros || 0) > 0).length
      + (this.totalReservasPrivadas() > 0 ? 1 : 0);
  }

  get listadosGenerados(): number {
    return this.tours().filter((tour) => tour.estado === 'Generado' || tour.estado === 'Confirmado').length;
  }

  openTour(tour: TourProgramacion): void {
    if (!this.canCreate() || Number(tour.totalPasajeros || 0) <= 0) return;
    this.tourSelected.emit(tour);
  }

  occupancy(tour: TourProgramacion): number {
    const value = Number(tour.ocupacionPromedio || 0);
    return value > 1 ? Math.min(100, value) : Math.min(100, value * 100);
  }
}
