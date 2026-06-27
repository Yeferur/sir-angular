import { ChangeDetectorRef, Component, inject, OnInit, signal, computed } from '@angular/core';
import { isTourDateAvailable, toDateOnly } from '../../shared/utils/calendar-date';

import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Reservas } from '../../services/Reservas/reservas';
import { SirDrawerService } from '../../services/Drawer/drawer.service';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';

type TourLite = {
  Id_Tour: number;
  Nombre_Tour?: string;
  NombreTour?: string;
};

type DuplicarConfirmPayload = {
  Id_Tour: number;
  Fecha_Tour: string;         // 'YYYY-MM-DD'
  Observaciones?: string | null;
};

type DuplicarPanelProps = {
  tours?: TourLite[];
  Id_Tour?: number | string | null;
  Fecha_Tour?: string | null; // puede venir ISO, o 'YYYY-MM-DD'
  Observaciones?: string | null;
  onConfirm?: (payload: DuplicarConfirmPayload) => void | Promise<void>;
  // opcional: si quieres que el panel haga la API aquí mismo
  // onConfirm puede devolver Promise y acá manejamos loading
};

@Component({
  selector: 'app-duplicar-panel',
  standalone: true,
  imports: [FormsModule, DatepickerComponent],
  templateUrl: './duplicar-panel.html',
  styleUrls: ['./duplicar-panel.css'],
})
export class DuplicarPanelComponent implements OnInit {
  private api = inject(Reservas);
  private drawer = inject(SirDrawerService);
  private cdr = inject(ChangeDetectorRef);

  // Props
  props: DuplicarPanelProps = {};

  tours: TourLite[] = [];

  // Form state
  Id_Tour = signal<number | null>(null);
  Fecha_Tour = signal<string | null>(null);
  Observaciones = signal<string | null>(null);

  // UX state
  isSubmitting = signal(false);
  isLoadingDisponibilidad = signal(false);
  errorMsg = signal<string | null>(null);

  private disponibilidadActual: any = null;
  minFecha = toDateOnly(new Date()) || '';

  // Validación
  isValid = computed(() => !!this.Id_Tour() && !!this.Fecha_Tour());

  async ngOnInit(): Promise<void> {
    const currentDrawer = this.drawer.drawer();
    this.props = (currentDrawer?.props || {}) as DuplicarPanelProps;

    this.tours = this.props.tours ?? [];

    this.Id_Tour.set(this.toNumberOrNull(this.props.Id_Tour));
    this.Fecha_Tour.set(this.normalizeDate(this.props.Fecha_Tour));
    this.Observaciones.set(this.props.Observaciones ?? null);

    // Si no hay tours, deja mensaje claro
    if (!this.tours?.length) {
      this.errorMsg.set('No hay tours disponibles para duplicar.');
    }

    await this.cargarDisponibilidadTour(this.Id_Tour());
  }

  async onTourChange(value: number | string | null): Promise<void> {
    const idTour = this.toNumberOrNull(value);
    this.Id_Tour.set(idTour);
    await this.cargarDisponibilidadTour(idTour);
  }

  cancelar(): void {
    if (this.isSubmitting()) return;
    this.drawer.close();
  }

  async confirmar(): Promise<void> {
    this.errorMsg.set(null);

    if (!this.tours?.length) {
      this.errorMsg.set('No hay tours disponibles.');
      return;
    }

    if (!this.isValid()) {
      this.errorMsg.set('Selecciona un tour y una fecha válida.');
      return;
    }

    // Evitar doble submit
    if (this.isSubmitting()) return;

    const payload: DuplicarConfirmPayload = {
      Id_Tour: Number(this.Id_Tour()!),
      Fecha_Tour: this.Fecha_Tour()!, // ya validado
      Observaciones: (this.Observaciones() ?? '').trim() || null,
    };

    // Llamar callback (si existe) con loading y error UI
    const cb = this.props.onConfirm;

    this.isSubmitting.set(true);

    try {
      if (typeof cb === 'function') {
        await cb(payload); // soporta sync o async
      } else {
        // Si NO hay callback, puedes decidir:
        // 1) cerrar igual, o
        // 2) llamar API acá (si tienes endpoint)
        // Te dejo ejemplo (comentado) por si quieres que el panel sea autónomo:
        //
        // await this.api.duplicarReserva(payload).toPromise();
      }

      this.drawer.close();
    } catch (err: any) {
      console.error(err);
      this.errorMsg.set(
        err?.error?.message ||
        err?.message ||
        'No se pudo duplicar. Intenta de nuevo.'
      );
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // Helpers
  private async cargarDisponibilidadTour(idTour: number | null): Promise<void> {
    this.isLoadingDisponibilidad.set(true);

    if (!idTour) {
      this.disponibilidadActual = null;
      this.clearInvalidSelectedDate();
      this.isLoadingDisponibilidad.set(false);
      return;
    }

    try {
      const dispo = await firstValueFrom(this.api.getDisponibilidadTour(idTour));
      this.disponibilidadActual = dispo || null;
    } catch {
      this.disponibilidadActual = null;
    } finally {
      this.clearInvalidSelectedDate();
      this.isLoadingDisponibilidad.set(false);
    }
  }

  isDateSelectable = (date: Date): boolean => {
    const ymd = toDateOnly(date);
    if (!ymd || ymd < this.minFecha) return false;

    const dispo = this.disponibilidadActual;
    if (!dispo) return true;

    const normalizeDiaToWeekday = (d: string) => {
      if (!d) return null;
      const s = String(d).trim().toLowerCase();
      switch (s) {
        case 'lunes': return 1;
        case 'martes': return 2;
        case 'miercoles':
        case 'miércoles': return 3;
        case 'jueves': return 4;
        case 'viernes': return 5;
        case 'sabado':
        case 'sábado': return 6;
        case 'domingo': return 0;
        default: return null;
      }
    };

    const modoRaw = (dispo.Modo || 'TODO_EL_AÑO').toString().toUpperCase();
    const modoNorm = modoRaw
      .replace(/Ñ/g, 'N')
      .replace(/Á/g, 'A')
      .replace(/É/g, 'E')
      .replace(/Í/g, 'I')
      .replace(/Ó/g, 'O')
      .replace(/Ú/g, 'U');

    const diasBaseSet = new Set<number>(
      (dispo.Dias_Base || [])
        .map((d: string) => normalizeDiaToWeekday(d))
        .filter((x: any) => x !== null)
    );

    const temporadas = Array.isArray(dispo.Temporadas)
      ? dispo.Temporadas.map((t: any) => ({
        inicio: toDateOnly(t.Fecha_Inicio),
        fin: toDateOnly(t.Fecha_Fin),
        dias: (t.Dias || [])
          .map((d: string) => normalizeDiaToWeekday(d))
          .filter((x: any) => x !== null) as number[],
      }))
      : [];

    const tour = {
      Modo: modoNorm,
      Dias_Base: Array.from(diasBaseSet),
      Temporadas: temporadas,
    };

    return isTourDateAvailable(ymd, tour);
  };

  private clearInvalidSelectedDate(): void {
    const cur = this.Fecha_Tour();
    if (!cur) {
      this.cdr.markForCheck();
      return;
    }

    const curDate = new Date(`${cur}T00:00:00`);
    if (!this.isDateSelectable(curDate)) {
      this.Fecha_Tour.set(null);
    }

    this.cdr.markForCheck();
  }

  private toNumberOrNull(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** Normaliza a 'YYYY-MM-DD' o null */
  private normalizeDate(input?: string | null): string | null {
    if (!input) return null;

    // Si ya viene tipo 'YYYY-MM-DD'
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;

    // Si viene ISO 'YYYY-MM-DDTHH:mm:ss...'
    const m = input.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m?.[1]) return m[1];

    // Último intento: parse Date
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return null;

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}
