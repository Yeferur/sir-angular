import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { SirDrawerService } from '../../../services/Drawer/drawer.service';
import { ProgramacionDashboardService } from '../../../services/Programacion/programacion';

interface PrivateBus {
  id: string;
  guia: string;
  capacidad: number;
  ocupados: number;
  indice: number;
  totalBuses: number;
  Id_Reserva_Privada: string;
  Id_Reserva?: string;
  Id_Tour?: number;
  Nombre_Tour?: string;
  Nombre_Reportante?: string;
  Idioma_Reserva?: string;
  persistido?: boolean;
  nuevo?: boolean;
}

interface PrivateGroup {
  Id_Reserva: string;
  Nombre_Tour: string;
  Idioma_Reserva: string;
  totalPax: number;
  buses: PrivateBus[];
  pendingGuides: number;
}

@Component({
  selector: 'app-programacion-privados',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './programacion-privados.html',
  styleUrls: ['./programacion-privados.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramacionPrivadosComponent implements OnChanges, OnDestroy {
  private readonly programacionService = inject(ProgramacionDashboardService);
  private readonly alerts = inject(SirAlertService);
  private readonly drawer = inject(SirDrawerService);
  private readonly cdr = inject(ChangeDetectorRef);

  @Input() operationDate = '';
  @Input() buses: PrivateBus[] = [];
  @Input() canUpdate = false;

  @Output() closeRequested = new EventEmitter<void>();
  @Output() busesChange = new EventEmitter<PrivateBus[]>();
  @Output() dirtyChange = new EventEmitter<boolean>();

  editableBuses: PrivateBus[] = [];
  private baselineBuses: PrivateBus[] = [];
  selectedReservationId = '';
  dirty = false;
  saving = false;
  exportingAll = false;
  exportingReservationId = '';
  phoneReadOnly = false;

  private readonly phoneMediaQuery = typeof window !== 'undefined'
    ? window.matchMedia('(max-width: 660px)')
    : null;
  private readonly phoneMediaListener = (event: MediaQueryListEvent) => {
    this.phoneReadOnly = event.matches;
    this.cdr.markForCheck();
  };

  constructor() {
    this.phoneReadOnly = Boolean(this.phoneMediaQuery?.matches);
    this.phoneMediaQuery?.addEventListener('change', this.phoneMediaListener);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['buses'] && !this.dirty) {
      this.replaceBuses(this.buses || []);
    }
  }

  ngOnDestroy(): void {
    this.phoneMediaQuery?.removeEventListener('change', this.phoneMediaListener);
  }

  get groups(): PrivateGroup[] {
    const groups = new Map<string, PrivateGroup>();
    for (const bus of this.editableBuses) {
      const reservationId = String(bus.Id_Reserva_Privada || bus.Id_Reserva || '').trim();
      if (!reservationId) continue;

      if (!groups.has(reservationId)) {
        groups.set(reservationId, {
          Id_Reserva: reservationId,
          Nombre_Tour: bus.Nombre_Tour || 'Tour sin nombre',
          Idioma_Reserva: bus.Idioma_Reserva || '',
          totalPax: 0,
          buses: [],
          pendingGuides: 0,
        });
      }

      const group = groups.get(reservationId)!;
      group.totalPax += Number(bus.ocupados || 0);
      group.buses.push(bus);
      if (!String(bus.guia || '').trim()) group.pendingGuides += 1;
    }

    return Array.from(groups.values()).map((group) => ({
      ...group,
      buses: group.buses.sort((a, b) => Number(a.indice || 0) - Number(b.indice || 0)),
    }));
  }

  get selectedGroup(): PrivateGroup | null {
    return this.groups.find((group) => group.Id_Reserva === this.selectedReservationId)
      || this.groups[0]
      || null;
  }

  get totalPassengers(): number {
    return this.editableBuses.reduce((sum, bus) => sum + Number(bus.ocupados || 0), 0);
  }

  get totalPendingGuides(): number {
    return this.editableBuses.filter((bus) => !String(bus.guia || '').trim()).length;
  }

  get canSave(): boolean {
    if (!this.groups.length) return false;
    return this.dirty || this.editableBuses.some((bus) => !bus.persistido);
  }

  get naturalOperationDate(): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(this.operationDate || '').trim());
    if (!match) return this.operationDate;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return new Intl.DateTimeFormat('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(date);
  }

  selectGroup(reservationId: string): void {
    this.selectedReservationId = reservationId;
  }

  selectAdjacentGroup(direction: -1 | 1): void {
    const available = this.groups;
    if (available.length < 2) return;

    const currentIndex = available.findIndex((group) => group.Id_Reserva === this.selectedGroup?.Id_Reserva);
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + direction + available.length) % available.length;
    this.selectedReservationId = available[nextIndex].Id_Reserva;
  }

  isEnglish(language: string): boolean {
    const value = this.normalizeSearch(language);
    return value === 'ingles' || value === 'english' || value === 'en';
  }

  vehicleTitle(group: PrivateGroup, index: number): string {
    return group.buses.length === 1 ? 'Vehículo' : `Vehículo ${index + 1} de ${group.buses.length}`;
  }

  guideSummary(group: PrivateGroup): string {
    const guides = group.buses
      .map((bus) => String(bus.guia || '').trim())
      .filter(Boolean);
    if (!guides.length) return '';
    if (guides.length === 1) return guides[0];
    return `${guides.length} guías asignadas`;
  }

  onFieldChanged(): void {
    if (this.phoneReadOnly || !this.canUpdate) return;
    this.setDirty(true);
    this.busesChange.emit(this.cloneBuses(this.editableBuses));
  }

  viewReservation(reservationId: string): void {
    this.drawer.openReserva(String(reservationId));
  }

  async requestClose(): Promise<void> {
    if (!this.dirty) {
      this.closeRequested.emit();
      return;
    }

    const discard = await this.alerts.confirmDecision(
      'Cambios sin guardar',
      'Los vehículos y guías modificados todavía no se han guardado.',
      {
        type: 'warning',
        confirmText: 'Salir sin guardar',
        cancelText: 'Continuar editando',
        destructive: true,
      }
    );

    if (!discard) return;
    this.editableBuses = this.cloneBuses(this.baselineBuses);
    this.ensureSelection();
    this.setDirty(false);
    this.busesChange.emit(this.cloneBuses(this.editableBuses));
    this.closeRequested.emit();
  }

  discardChanges(): void {
    this.editableBuses = this.cloneBuses(this.baselineBuses);
    this.ensureSelection();
    this.setDirty(false);
    this.busesChange.emit(this.cloneBuses(this.editableBuses));
    this.alerts.infoToast('Cambios descartados', 'Se restauraron las asignaciones guardadas.');
  }

  async save(): Promise<void> {
    if (this.phoneReadOnly || !this.canUpdate || this.saving || !this.canSave) return;
    if (!this.validateGuides(this.groups)) return;

    const replacing = this.editableBuses.some((bus) => Boolean(bus.persistido));
    const confirmed = await this.alerts.confirmDecision(
      '¿Guardar la programación privada?',
      `Se guardarán ${this.groups.length} reservas privadas, ${this.editableBuses.length} vehículos y ${this.totalPassengers} pasajeros para ${this.naturalOperationDate}. ${replacing ? 'Esto reemplazará la programación privada guardada actualmente.' : 'Esta será la programación privada disponible para consulta.'}`,
      {
        type: 'info',
        confirmText: 'Guardar programación',
        cancelText: 'Seguir revisando',
      }
    );
    if (!confirmed || this.phoneReadOnly || !this.canUpdate || this.saving || !this.canSave) return;

    this.saving = true;
    this.programacionService.guardarProgramacionPrivada({
      fecha: this.operationDate,
      buses: this.normalizedBuses(this.editableBuses),
    }).pipe(
      finalize(() => {
        this.saving = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: (response) => {
        this.replaceBuses(response?.privados || this.editableBuses);
        this.busesChange.emit(this.cloneBuses(this.editableBuses));
        this.alerts.successToast(
          'Programación privada guardada',
          `${this.groups.length} reserva${this.groups.length === 1 ? '' : 's'} quedaron preparadas.`
        );
      },
      error: (error) => this.showRequestError(
        'No pudimos guardar la programación privada',
        error,
        'Revisa las asignaciones e inténtalo nuevamente.'
      ),
    });
  }

  exportSelected(group: PrivateGroup): void {
    if (this.exportingReservationId || !this.validateGuides([group])) return;
    this.exportingReservationId = group.Id_Reserva;

    this.programacionService.exportarReservaPrivada({
      fecha: this.operationDate,
      idReserva: group.Id_Reserva,
      idTour: group.buses[0]?.Id_Tour,
      nombreTour: group.Nombre_Tour,
      buses: this.normalizedBuses(group.buses),
    }).pipe(
      finalize(() => {
        this.exportingReservationId = '';
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: (blob) => {
        const reservation = this.safeFileName(group.Id_Reserva, 'Reserva');
        const tour = this.safeFileName(group.Nombre_Tour, 'Privado');
        this.downloadBlob(blob, `${this.operationDate}_${tour}_${reservation}.xlsx`);
      },
      error: (error) => this.showRequestError(
        'No pudimos exportar la reserva',
        error,
        'La información permanece disponible para volver a intentarlo.'
      ),
    });
  }

  exportAll(): void {
    if (this.exportingAll || !this.groups.length || !this.validateGuides(this.groups)) return;
    this.exportingAll = true;

    this.programacionService.exportarPrivadosZip({
      fecha: this.operationDate,
      buses: this.normalizedBuses(this.editableBuses),
    }).pipe(
      finalize(() => {
        this.exportingAll = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: (blob) => this.downloadBlob(blob, `${this.operationDate}_programacion_privada.zip`),
      error: (error) => this.showRequestError(
        'No pudimos exportar los servicios privados',
        error,
        'Las exportaciones individuales siguen disponibles.'
      ),
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.drawer.isOpen()) void this.requestClose();
  }

  private replaceBuses(buses: PrivateBus[]): void {
    this.editableBuses = this.cloneBuses(buses);
    this.baselineBuses = this.cloneBuses(buses);
    this.ensureSelection();
    this.setDirty(false);
  }

  private ensureSelection(): void {
    if (!this.groups.some((group) => group.Id_Reserva === this.selectedReservationId)) {
      this.selectedReservationId = this.groups[0]?.Id_Reserva || '';
    }
  }

  private validateGuides(groups: PrivateGroup[]): boolean {
    const pending = groups.filter((group) => group.pendingGuides > 0);
    if (!pending.length) return true;

    this.selectedReservationId = pending[0].Id_Reserva;
    const codes = pending.slice(0, 6).map((group) => group.Id_Reserva).join(', ');
    const remaining = Math.max(0, pending.length - 6);
    this.alerts.showAlert({
      type: 'warning',
      title: `Faltan guías en ${pending.length} reserva${pending.length === 1 ? '' : 's'}`,
      message: `${codes}${remaining ? ` y ${remaining} más` : ''}. Asigna las guías antes de continuar.`,
    });
    return false;
  }

  private normalizedBuses(buses: PrivateBus[]): PrivateBus[] {
    return buses.map((bus, index) => {
      const baseline = this.baselineBuses.find((candidate) => this.busKey(candidate) === this.busKey(bus));
      return {
        ...bus,
        id: String(bus.id || '').trim() || String(baseline?.id || '').trim() || `Bus ${index + 1}`,
        guia: String(bus.guia || '').trim(),
      };
    });
  }

  private busKey(bus: PrivateBus): string {
    return `${String(bus.Id_Reserva_Privada || bus.Id_Reserva || '')}:${Number(bus.indice || 1)}`;
  }

  private showRequestError(title: string, error: any, fallback: string): void {
    const message = error?.error?.message || error?.message || fallback;
    const details = error?.error?.details;
    const detailText = Array.isArray(details) && details.length ? ` ${details.slice(0, 4).join(' ')}` : '';
    this.alerts.showAlert({ type: 'error', title, message: `${message}${detailText}`.trim() });
  }

  private setDirty(value: boolean): void {
    this.dirty = value;
    this.dirtyChange.emit(value);
    this.cdr.markForCheck();
  }

  private cloneBuses(buses: PrivateBus[]): PrivateBus[] {
    return JSON.parse(JSON.stringify(buses || []));
  }

  private normalizeSearch(value: unknown): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private safeFileName(value: unknown, fallback: string): string {
    return String(value || fallback).replace(/[^a-zA-Z0-9_-]+/g, '_') || fallback;
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }
}
