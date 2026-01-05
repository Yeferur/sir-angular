import { Component, inject, OnInit, signal, computed } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Reservas } from '../../services/Reservas/reservas';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';

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
  imports: [FormsModule],
  templateUrl: './duplicar-panel.html',
  styleUrls: ['./duplicar-panel.css'],
})
export class DuplicarPanelComponent implements OnInit {
  private api = inject(Reservas);
  private navbar = inject(DynamicIslandGlobalService);

  // Props
  props: DuplicarPanelProps = {};

  tours: TourLite[] = [];

  // Form state
  Id_Tour = signal<number | null>(null);
  Fecha_Tour = signal<string | null>(null);
  Observaciones = signal<string | null>(null);

  // UX state
  isSubmitting = signal(false);
  errorMsg = signal<string | null>(null);

  // Validación
  isValid = computed(() => !!this.Id_Tour() && !!this.Fecha_Tour());

  ngOnInit(): void {
    const p = this.navbar.panel();
    this.props = (p?.props || {}) as DuplicarPanelProps;

    this.tours = this.props.tours ?? [];

    const defaultTour = this.tours?.[0]?.Id_Tour ?? null;

    this.Id_Tour.set(this.toNumberOrNull(this.props.Id_Tour) ?? defaultTour);
    this.Fecha_Tour.set(this.normalizeDate(this.props.Fecha_Tour));
    this.Observaciones.set(this.props.Observaciones ?? null);

    // Si no hay tours, deja mensaje claro
    if (!this.tours?.length) {
      this.errorMsg.set('No hay tours disponibles para duplicar.');
    }
  }

  cancelar(): void {
    if (this.isSubmitting()) return;
    this.navbar.closePanel();
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

      this.navbar.closePanel();
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
