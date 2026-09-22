import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProgramacionNovedad, ProgramacionNovedadCambio } from '../../services/Programacion/programacion';
import { Bus, Reserva } from '../../interfaces/Programacion/reservas';
import { SirDrawerService } from '../../services/Drawer/drawer.service';

export interface ProgramacionNovedadesPanelState {
  items: ProgramacionNovedad[];
  loading: boolean;
  error: string;
  posponerId: string | null;
  posponerHasta: string;
  guardando: boolean;
}

interface ProgramacionListadoPanelProps {
  tourName: string;
  operationDate: string;
  buses: Bus[];
  unassigned?: Reserva[];
  canEdit?: boolean;
  canExport?: boolean;
  onEdit?: () => void;
  onRegenerate?: () => void;
  onExportBus?: (index: number, formato: 'compacto' | 'operativo') => void;
  onExportAll?: (formato: 'compacto' | 'operativo') => void;
  novedades?: Signal<ProgramacionNovedadesPanelState>;
  onRefresh?: () => void;
  onViewReservation?: (id: string) => void;
  onReview?: (item: ProgramacionNovedad) => void;
  onPostpone?: (item: ProgramacionNovedad) => void;
  onPostponeDate?: (date: string) => void;
  onConfirmPostpone?: (item: ProgramacionNovedad) => void;
  onCancelPostpone?: () => void;
}

@Component({
  selector: 'app-programacion-listado-panel',
  standalone: true,
  imports: [DatePipe, TitleCasePipe, FormsModule],
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
  readonly novedades = computed(() => this.props().novedades?.());
  readonly reservasConCambios = computed(() => {
    const groups = new Map<string, { id: string; changes: ProgramacionNovedadCambio[] }>();
    for (const item of this.novedades()?.items || []) {
      for (const reservation of item.datos?.novedades || []) {
        const group = groups.get(reservation.reservationId) || { id: reservation.reservationId, changes: [] };
        for (const change of reservation.changes || []) {
          if (!group.changes.some(existing => existing.campo === change.campo && existing.anterior === change.anterior && existing.actual === change.actual)) {
            group.changes.push(change);
          }
        }
        groups.set(group.id, group);
      }
    }
    return [...groups.values()];
  });

  changeValue(value: unknown): string {
    return value == null || String(value).trim() === '' ? 'Sin dato' : String(value);
  }
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

  exportBus(index: number, formato: 'compacto' | 'operativo', menu: HTMLDetailsElement): void {
    menu.open = false;
    if (!this.props().canExport) return;
    this.props().onExportBus?.(index, formato);
  }

  exportAll(formato: 'compacto' | 'operativo', menu: HTMLDetailsElement): void {
    menu.open = false;
    if (!this.props().canExport) return;
    this.props().onExportAll?.(formato);
  }

  close(): void {
    this.drawer.close();
  }
}
