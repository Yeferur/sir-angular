import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TourProgramacion } from '../../../interfaces/Programacion/reservas';
import { CountUpDirective } from '../../Inicio/count-up.directive';
import { TransfersProgramacionResponse } from '../../../services/Programacion/programacion';

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
  transfers = input.required<TransfersProgramacionResponse>();
  transfersUnavailable = input(false);

  tourSelected = output<TourProgramacion>();
  privadosSelected = output<void>();
  transfersSelected = output<void>();

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
    const generated = tour.estado === 'Generado' || tour.estado === 'Confirmado';
    if ((!generated && !this.canCreate()) || Number(tour.totalPasajeros || 0) <= 0) return;
    this.tourSelected.emit(tour);
  }

}
