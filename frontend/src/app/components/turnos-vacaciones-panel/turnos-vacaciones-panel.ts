import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SirDrawerService } from '../../services/Drawer/drawer.service';
import { VacacionTurno } from '../../services/Turnos/turnos.service';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';

interface TurnosVacacionesProps {
  advisorName: string;
  vacation: VacacionTurno;
  hasVacation: boolean;
  suggest: (start: string, idVacacion: string | null) => VacacionTurno;
  onApply: (vacation: VacacionTurno) => void;
  onRemove: () => void;
}

@Component({
  selector: 'app-turnos-vacaciones-panel',
  standalone: true,
  imports: [FormsModule, DatepickerComponent],
  templateUrl: './turnos-vacaciones-panel.html',
  styleUrl: './turnos-vacaciones-panel.css',
})
export class TurnosVacacionesPanelComponent implements OnInit {
  private readonly drawer = inject(SirDrawerService);
  props!: TurnosVacacionesProps;
  readonly draft = signal<VacacionTurno | null>(null);
  readonly error = signal('');

  ngOnInit(): void {
    this.props = (this.drawer.drawer()?.props || {}) as unknown as TurnosVacacionesProps;
    this.draft.set(this.props.vacation ? { ...this.props.vacation } : null);
  }

  close(): void { this.drawer.close(); }

  updateStart(value: string): void {
    const current = this.draft();
    if (!current || !value) return;
    this.draft.set(this.props.suggest(value, current.idVacacion));
  }

  update(field: 'fechaFin' | 'fechaRegreso' | 'observaciones', value: string): void {
    const current = this.draft();
    if (current) this.draft.set({ ...current, [field]: value });
  }

  apply(): void {
    const value = this.draft();
    if (!value || !value.fechaInicio || !value.fechaFin || !value.fechaRegreso
      || value.fechaInicio > value.fechaFin || value.fechaRegreso <= value.fechaFin) {
      this.error.set('El regreso debe ser posterior al último día de vacaciones.');
      return;
    }
    this.props.onApply({ ...value });
    this.drawer.close();
  }

  remove(): void {
    this.props.onRemove();
    this.drawer.close();
  }
}
