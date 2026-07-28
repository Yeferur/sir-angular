import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Bus, Reserva, Sugerencia } from '../../../interfaces/Programacion/reservas';
import { ProgramacionViewStop } from './programacion-view.types';

@Component({
  selector: 'app-programacion-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './programacion-editor.html',
  styleUrl: './programacion-editor.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramacionEditorComponent implements OnDestroy {
  readonly newBusDropData: Reserva[] = [];
  readonly canEnterActiveList = () => this.activeBusIndex() !== -1;
  readonly phoneReadOnly = signal(false);
  readonly routeCollapsed = signal(true);
  private readonly phoneMediaQuery = typeof window !== 'undefined'
    ? window.matchMedia('(max-width: 660px)')
    : null;
  private readonly phoneMediaListener = (event: MediaQueryListEvent) => this.phoneReadOnly.set(event.matches);

  constructor() {
    this.phoneReadOnly.set(Boolean(this.phoneMediaQuery?.matches));
    this.phoneMediaQuery?.addEventListener('change', this.phoneMediaListener);
  }

  ngOnDestroy(): void {
    this.phoneMediaQuery?.removeEventListener('change', this.phoneMediaListener);
  }

  tourName = input('');
  operationDate = input('');
  statusText = input('');
  persisted = input(false);
  dirty = input(false);
  newDraft = input(false);
  plan = input.required<Sugerencia>();
  activeBusIndex = input(0);
  activeBus = input<Bus | null>(null);
  activeStops = input.required<ProgramacionViewStop[]>();
  unassigned = input.required<Reserva[]>();
  totalPaxUnassigned = input(0);
  connectedDropLists = input.required<string[]>();
  canUpdate = input(false);
  canUpdatePoints = input(false);
  dragging = input(false);
  saving = input(false);

  closeRequested = output<void>();
  saveRequested = output<void>();
  exportAllRequested = output<void>();
  busSelected = output<number>();
  previousBusRequested = output<void>();
  nextBusRequested = output<void>();
  busChanged = output<void>();
  mapRequested = output<{ bus: Bus; index: number }>();
  exportBusRequested = output<number>();
  pointEditRequested = output<ProgramacionViewStop>();
  stopDropped = output<CdkDragDrop<ProgramacionViewStop[]>>();
  reservationDropped = output<CdkDragDrop<Reserva[]>>();
  dragStarted = output<void>();
  dragEnded = output<void>();

  get buses(): Bus[] {
    return this.plan()?.buses || [];
  }

  get totalPassengers(): number {
    return this.buses.reduce((total, bus) => total + Number(bus.ocupados || 0), 0)
      + this.totalPaxUnassigned();
  }

  get totalReservations(): number {
    return this.buses.reduce((total, bus) => total + (bus.reservas?.length || 0), 0)
      + this.unassigned().length;
  }

  occupancy(bus: Bus | null): number {
    if (!bus?.capacidad) return 0;
    return Math.min(100, Math.round((Number(bus.ocupados || 0) / bus.capacidad) * 100));
  }

  occupancyState(bus: Bus): 'low' | 'balanced' | 'high' | 'full' {
    const value = this.occupancy(bus);
    if (value >= 100) return 'full';
    if (value >= 90) return 'high';
    if (value >= 55) return 'balanced';
    return 'low';
  }

  reservationPax(reserva: Reserva & { __paxEnEstePunto?: number }): number {
    return reserva.__paxEnEstePunto ?? reserva.NumeroPasajeros;
  }

  toggleRoutePanel(): void {
    this.routeCollapsed.update((collapsed) => !collapsed);
  }

  stopNeedsCoordinates(stop: ProgramacionViewStop): boolean {
    const lat = Number(stop.Latitud);
    const lng = Number(stop.Longitud);
    return !Number.isFinite(lat)
      || !Number.isFinite(lng)
      || Math.abs(lat) < 0.0001
      || Math.abs(lng) < 0.0001;
  }

  stopNeedsRoute(stop: ProgramacionViewStop): boolean {
    const route = String(stop.ruta || '').trim().toUpperCase();
    return !route || route === 'PENDIENTE';
  }

  stopNeedsAttention(stop: ProgramacionViewStop): boolean {
    return this.stopNeedsCoordinates(stop) || this.stopNeedsRoute(stop);
  }

  get activeIssueCount(): number {
    return this.activeStops().filter((stop) => this.stopNeedsAttention(stop)).length;
  }

  isEnglish(reserva: Reserva): boolean {
    const language = String(reserva.Idioma_Reserva || reserva.IdiomaReserva || '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return language.includes('INGLES') || language.includes('ENGLISH');
  }

  isMultipoint(reserva: Reserva & { __paxEnEstePunto?: number }): boolean {
    return reserva.NumeroPasajeros > this.reservationPax(reserva);
  }
}
