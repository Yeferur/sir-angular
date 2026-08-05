import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { Bus, Reserva } from '../../interfaces/Programacion/reservas';
import { SirDrawerService } from '../../services/Drawer/drawer.service';

interface ProgramacionListadoPanelProps {
  tourName: string;
  operationDate: string;
  buses: Bus[];
  unassigned?: Reserva[];
  canEdit?: boolean;
  onEdit?: () => void;
  onRegenerate?: () => void;
}

@Component({
  selector: 'app-programacion-listado-panel',
  standalone: true,
  imports: [DatePipe, TitleCasePipe],
  templateUrl: './programacion-listado-panel.html',
  styleUrl: './programacion-listado-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramacionListadoPanelComponent {
  private readonly drawer = inject(SirDrawerService);
  readonly expandedBusIndex = signal<number | null>(null);

  readonly props = computed(() =>
    (this.drawer.drawer()?.props || {}) as ProgramacionListadoPanelProps
  );
  readonly totalPax = computed(() =>
    this.props().buses?.reduce((total, bus) => total + Number(bus.ocupados || 0), 0) || 0
  );
  readonly totalReservations = computed(() =>
    this.props().buses?.reduce((total, bus) => total + (bus.reservas?.length || 0), 0) || 0
  );

  busStops(bus: Bus): number {
    return new Set(
      (bus.reservas || []).map((reservation) =>
        String(reservation.Id_Punto ?? reservation.idPunto ?? reservation.IdPunto ?? reservation.NombrePunto)
      )
    ).size;
  }

  occupancy(bus: Bus): number {
    return bus.capacidad > 0 ? Math.min(100, Math.round((bus.ocupados / bus.capacidad) * 100)) : 0;
  }

  toggleBus(index: number): void {
    this.expandedBusIndex.update((current) => current === index ? null : index);
  }

  edit(): void {
    const action = this.props().onEdit;
    this.drawer.close(true);
    action?.();
  }

  regenerate(): void {
    const action = this.props().onRegenerate;
    this.drawer.close(true);
    action?.();
  }

  close(): void {
    this.drawer.close();
  }
}
