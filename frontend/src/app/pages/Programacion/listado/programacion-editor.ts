import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Bus, Reserva, Sugerencia } from '../../../interfaces/Programacion/reservas';
import { groupProgramacionStops } from './programacion-editor.utils';
import { ProgramacionViewStop } from './programacion-view.types';

interface BusQualitySummary {
  missingCoordinates: number;
  missingRoute: number;
  total: number;
}

@Component({
  selector: 'app-programacion-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './programacion-editor.html',
  styleUrls: ['./programacion-editor.css', './programacion-editor-responsive.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramacionEditorComponent implements OnDestroy {
  readonly phoneReadOnly = signal(false);
  readonly transferReservation = signal<Reserva | null>(null);
  readonly transferSourceBusIndex = signal<number | null>(null);
  readonly recentDestinationId = signal<string | null>(null);
  private destinationPulseTimer?: ReturnType<typeof setTimeout>;
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
    if (this.destinationPulseTimer) clearTimeout(this.destinationPulseTimer);
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
  availableCapacities = input<number[]>([]);
  canUpdate = input(false);
  canRestore = input(false);
  saving = input(false);

  closeRequested = output<void>();
  restoreRequested = output<void>();
  saveRequested = output<void>();
  exportAllRequested = output<void>();
  busSelected = output<number>();
  previousBusRequested = output<void>();
  nextBusRequested = output<void>();
  busChanged = output<void>();
  mapRequested = output<{ bus: Bus; index: number }>();
  exportBusRequested = output<number>();
  reservationViewRequested = output<string>();
  reservationMoveRequested = output<{
    reservationId: string | number;
    sourceBusIndex: number;
    targetBusIndex: number | null;
  }>();
  stopDropped = output<CdkDragDrop<ProgramacionViewStop[]>>();

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

  get naturalOperationDate(): string {
    const value = String(this.operationDate() || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return value;

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    const parts = new Intl.DateTimeFormat('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value || '';

    return `${part('weekday')} ${part('day')} de ${part('month')}`.trim();
  }

  get transferMode(): boolean {
    return Boolean(this.transferReservation());
  }

  get transferPax(): number {
    return Number(this.transferReservation()?.NumeroPasajeros || 0);
  }

  get canCreateBusForTransfer(): boolean {
    return this.transferMode
      && this.availableCapacities().some((capacity) => capacity >= this.transferPax);
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

  beginTransfer(reservation: Reserva): void {
    if (this.phoneReadOnly() || !this.canUpdate()) return;
    this.transferReservation.set(reservation);
    this.transferSourceBusIndex.set(this.activeBusIndex());
  }

  viewReservation(event: Event, reservation: Reserva): void {
    event.stopPropagation();
    this.cancelTransfer();
    this.reservationViewRequested.emit(String(reservation.Id_Reserva));
  }

  cancelTransfer(): void {
    this.transferReservation.set(null);
    this.transferSourceBusIndex.set(null);
  }

  @HostListener('document:keydown.escape')
  cancelTransferFromKeyboard(): void {
    if (this.transferMode) this.cancelTransfer();
  }

  selectOrMoveToBus(index: number): void {
    if (!this.transferMode) {
      this.busSelected.emit(index);
      return;
    }
    if (!this.canMoveToBus(index)) return;

    const reservation = this.transferReservation();
    const sourceBusIndex = this.transferSourceBusIndex();
    const destination = this.buses[index];
    if (!reservation || sourceBusIndex === null || !destination) return;

    const destinationId = destination.id || `Bus ${index + 1}`;
    this.reservationMoveRequested.emit({
      reservationId: reservation.Id_Reserva,
      sourceBusIndex,
      targetBusIndex: index,
    });
    this.cancelTransfer();
    this.pulseDestination(destinationId);
  }

  moveSelectedToNewBus(): void {
    const reservation = this.transferReservation();
    const sourceBusIndex = this.transferSourceBusIndex();
    if (!reservation || sourceBusIndex === null || !this.canCreateBusForTransfer) return;

    this.reservationMoveRequested.emit({
      reservationId: reservation.Id_Reserva,
      sourceBusIndex,
      targetBusIndex: null,
    });
    this.cancelTransfer();
  }

  projectedLoad(bus: Bus): number {
    return Number(bus.ocupados || 0) + this.transferPax;
  }

  projectedCapacity(bus: Bus): number | null {
    const load = this.projectedLoad(bus);
    if (bus.capacidadManual) return load <= Number(bus.capacidad || 0) ? Number(bus.capacidad) : null;
    return this.availableCapacities().find((capacity) => capacity >= load) ?? null;
  }

  setManualCapacity(bus: Bus, value: number | string | null): void {
    bus.capacidad = Number(value || 0);
    bus.capacidadManual = true;
    this.busChanged.emit();
  }

  restoreAutomaticCapacity(bus: Bus): void {
    const occupied = Number(bus.ocupados || 0);
    const automatic = this.availableCapacities().find((capacity) => capacity >= occupied);
    if (!automatic) return;
    bus.capacidad = automatic;
    bus.capacidadManual = false;
    this.busChanged.emit();
  }

  canMoveToBus(index: number): boolean {
    if (!this.transferMode || index === this.transferSourceBusIndex()) return false;
    const bus = this.buses[index];
    return Boolean(bus && this.projectedCapacity(bus));
  }

  projectedOccupancy(bus: Bus): number {
    const capacity = this.projectedCapacity(bus);
    return capacity ? Math.min(100, Math.round((this.projectedLoad(bus) / capacity) * 100)) : 100;
  }

  isTransferSource(index: number): boolean {
    return this.transferMode && index === this.transferSourceBusIndex();
  }

  private pulseDestination(destinationId: string): void {
    if (this.destinationPulseTimer) clearTimeout(this.destinationPulseTimer);
    this.recentDestinationId.set(destinationId);
    this.destinationPulseTimer = setTimeout(() => this.recentDestinationId.set(null), 900);
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

  busQualitySummary(bus: Bus): BusQualitySummary {
    const stops = groupProgramacionStops(bus.reservas || []);
    const missingCoordinates = stops.filter((stop) => this.stopNeedsCoordinates(stop)).length;
    const missingRoute = stops.filter((stop) => this.stopNeedsRoute(stop)).length;
    const total = stops.filter((stop) => this.stopNeedsAttention(stop)).length;

    return { missingCoordinates, missingRoute, total };
  }

  busQualityLabel(quality: BusQualitySummary): string {
    const details: string[] = [];
    if (quality.missingCoordinates) {
      details.push(`${quality.missingCoordinates} sin coordenadas`);
    }
    if (quality.missingRoute) {
      details.push(`${quality.missingRoute} sin ruta`);
    }
    return details.join(' · ');
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
