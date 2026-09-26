import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ReminderInput } from '../../services/Pendientes/pendientes.service';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { TimepickerComponent } from '../../shared/timepicker/timepicker';
import { isFutureSirDateTime, nextSirMinute, sirToday } from '../../shared/utils/sir-datetime';

@Component({
  selector: 'app-reminder-form',
  standalone: true,
  imports: [CommonModule, FormsModule, DatepickerComponent, TimepickerComponent],
  templateUrl: './reminder-form.html',
  styleUrl: './reminder-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReminderFormComponent implements OnChanges {
  @Input({ required: true }) value!: ReminderInput;
  @Input() saving = false;
  @Input() compact = false;
  @Input() registeredEmail = '';
  @Output() valueChange = new EventEmitter<ReminderInput>();
  @Output() save = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  readonly minDate = sirToday();
  submitted = false;
  selectedDate = '';
  selectedTime = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['value']) return;
    const [date = '', time = ''] = String(this.value?.fecha || '').split('T');
    this.selectedDate = date;
    this.selectedTime = time.slice(0, 5);
  }

  get minTime(): string | null {
    const [nextDate, nextTime] = nextSirMinute().split('T');
    return this.selectedDate === nextDate ? nextTime : null;
  }

  get titleInvalid(): boolean {
    return this.submitted && !String(this.value?.titulo || '').trim();
  }

  get dateInvalid(): boolean {
    return this.submitted && !this.selectedDate;
  }

  get timeInvalid(): boolean {
    return this.submitted && (!this.selectedTime || !isFutureSirDateTime(this.composeDateTime()));
  }

  get timeErrorMessage(): string {
    if (!this.selectedTime) return 'Selecciona una hora válida.';
    if (!this.selectedDate) return 'Selecciona primero una fecha.';
    return 'La fecha y hora seleccionadas ya pasaron.';
  }

  get hasValidEmail(): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.registeredEmail);
  }

  update(field: 'titulo' | 'descripcion' | 'enviarCorreo', fieldValue: string | boolean): void {
    this.valueChange.emit({ ...this.value, [field]: fieldValue });
  }

  updateDate(date: string | null): void {
    this.selectedDate = date || '';
    this.emitDateTime();
  }

  updateTime(time: string | null): void {
    this.selectedTime = time || '';
    this.emitDateTime();
  }

  submit(): void {
    this.submitted = true;
    if (this.saving || this.titleInvalid || this.dateInvalid || this.timeInvalid) {
      queueMicrotask(() => this.focusFirstInvalid());
      return;
    }
    this.save.emit();
  }

  cancelForm(): void {
    if (this.saving) return;
    this.submitted = false;
    this.cancel.emit();
  }

  private emitDateTime(): void {
    this.valueChange.emit({ ...this.value, fecha: this.composeDateTime() });
  }

  private composeDateTime(): string {
    return this.selectedDate || this.selectedTime
      ? `${this.selectedDate}T${this.selectedTime}`
      : '';
  }

  private focusFirstInvalid(): void {
    document.querySelector<HTMLElement>('app-reminder-form .is-invalid, app-reminder-form [aria-invalid="true"]')?.focus();
  }
}
