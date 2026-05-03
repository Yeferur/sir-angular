import { ChangeDetectorRef, Component, inject, OnInit, signal, computed, ViewChild } from '@angular/core';
import { FlatpickrInputDirective } from '../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';

import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
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
  imports: [FormsModule, FlatpickrInputDirective],
  templateUrl: './duplicar-panel.html',
  styleUrls: ['./duplicar-panel.css'],
})
export class DuplicarPanelComponent implements OnInit {
  private api = inject(Reservas);
  private navbar = inject(DynamicIslandGlobalService);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('fechaFp') fechaFp?: FlatpickrInputDirective;

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

  // Validación
  isValid = computed(() => !!this.Id_Tour() && !!this.Fecha_Tour());

  fpOptionsFecha: Partial<FlatpickrOptions> = {
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'd/m/Y',
    allowInput: false,
    disableMobile: true,
    monthSelectorType: 'dropdown' as FlatpickrOptions['monthSelectorType'],

    altInputClass: 'form-input flatpickr-input flatpickr-alt',

    onReady: (_sel, _str, inst: any) => {
      // SSR guard antes de tocar el DOM.
      if (typeof window === 'undefined' || typeof document === 'undefined') return;

      const cal: HTMLElement = inst?.calendarContainer;
      if (!cal) return;

      cal.classList.add('sir-flatpickr');

      const clampDay = (y: number, m: number, d: number) => {
        const last = new Date(y, m + 1, 0).getDate();
        return Math.min(Math.max(d, 1), last);
      };

      let yearSelect: HTMLSelectElement | null = null;

      const ensureYearSelect = () => {
        const monthWrap = cal.querySelector('.flatpickr-month') as HTMLElement | null;
        if (!monthWrap) return null;

        const numWrap = monthWrap.querySelector('.numInputWrapper') as HTMLElement | null;
        if (numWrap) { try { numWrap.remove(); } catch (e) { /* ignore */ } }

        const curMonth = monthWrap.querySelector('.flatpickr-current-month') as HTMLElement | null;
        const container = curMonth ?? monthWrap;

        yearSelect = container.querySelector('.sir-year-select') as HTMLSelectElement | null;
        if (yearSelect) return yearSelect;

        const oldDiv = monthWrap.querySelector('.sir-year-div') as HTMLElement | null;
        if (oldDiv) { try { oldDiv.remove(); } catch { /* ignore */ } }

        yearSelect = document.createElement('select');
        yearSelect.className = 'sir-year-select';
        yearSelect.setAttribute('aria-label', 'Seleccionar año');

        try { container.appendChild(yearSelect); } catch { monthWrap.appendChild(yearSelect); }
        return yearSelect;
      };

      const buildYears = (centerYear: number) => {
        const sel = ensureYearSelect();
        if (!sel) return;

        const start = centerYear - 20;
        const end = centerYear + 20;

        sel.innerHTML = '';
        for (let y = end; y >= start; y--) {
          const opt = document.createElement('option');
          opt.value = String(y);
          opt.textContent = String(y);
          sel.appendChild(opt);
        }
        sel.value = String(centerYear);
      };

      const syncSelectValue = () => {
        const sel = ensureYearSelect();
        if (!sel) return;

        const y = inst.currentYear ?? new Date().getFullYear();
        const exists = !!sel.querySelector(`option[value="${y}"]`);
        if (!exists) buildYears(y);
        sel.value = String(y);
      };

      const getSafeDay = () => {
        const d: Date | undefined = inst.selectedDates?.[0];
        return d ? d.getDate() : 1;
      };

      const onChange = () => {
        const sel = ensureYearSelect();
        if (!sel) return;

        const y = Number(sel.value);
        const m = typeof inst.currentMonth === 'number' ? inst.currentMonth : new Date().getMonth();
        const day = clampDay(y, m, getSafeDay());

        const newDate = new Date(y, m, day);

        if (typeof inst.jumpToDate === 'function') inst.jumpToDate(newDate);

        if (inst.selectedDates?.length) {
          inst.setDate(newDate, true);
        }
      };

      buildYears(inst.currentYear ?? new Date().getFullYear());
      syncSelectValue();

      const sel0 = ensureYearSelect();
      sel0?.addEventListener('change', onChange);

      const wrap = (key: 'onMonthChange' | 'onYearChange', fn: any) => {
        const prev = inst.config[key];
        const arr = Array.isArray(prev) ? prev : prev ? [prev] : [];
        inst.config[key] = [...arr, fn];
      };

      wrap('onMonthChange', () => syncSelectValue());
      wrap('onYearChange', () => syncSelectValue());

      const prevOnDestroy = inst.config.onDestroy;
      const destroyArr = Array.isArray(prevOnDestroy) ? prevOnDestroy : prevOnDestroy ? [prevOnDestroy] : [];
      inst.config.onDestroy = [
        ...destroyArr,
        () => sel0?.removeEventListener('change', onChange)
      ];
    }
  };

  async ngOnInit(): Promise<void> {
    const p = this.navbar.panel();
    this.props = (p?.props || {}) as DuplicarPanelProps;

    this.tours = this.props.tours ?? [];

    this.Id_Tour.set(null);
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
  private async cargarDisponibilidadTour(idTour: number | null): Promise<void> {
    this.isLoadingDisponibilidad.set(true);

    if (!idTour) {
      this.disponibilidadActual = null;
      this.applyDisponibilidadToDatepicker();
      this.isLoadingDisponibilidad.set(false);
      return;
    }

    try {
      const dispo = await firstValueFrom(this.api.getDisponibilidadTour(idTour));
      this.disponibilidadActual = dispo || null;
    } catch {
      this.disponibilidadActual = null;
    } finally {
      this.applyDisponibilidadToDatepicker();
      this.isLoadingDisponibilidad.set(false);
    }
  }

  private applyDisponibilidadToDatepicker(): void {
    const dispo = this.disponibilidadActual;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const onlyDate = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());

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

    let disable: ((date: Date) => boolean)[] = [];

    if (dispo) {
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
          inicio: t.Fecha_Inicio ? new Date(t.Fecha_Inicio) : null,
          fin: t.Fecha_Fin ? new Date(t.Fecha_Fin) : null,
          dias: (t.Dias || [])
            .map((d: string) => normalizeDiaToWeekday(d))
            .filter((x: any) => x !== null) as number[],
        }))
        : [];

      const isAllowed = (date: Date) => {
        const d = onlyDate(date);
        const wk = d.getDay();
        if (d < today) return false;

        for (const t of temporadas) {
          if (!t.inicio || !t.fin) continue;

          const ini = onlyDate(t.inicio);
          const fin = onlyDate(t.fin);

          if (d >= ini && d <= fin) {
            if (!t.dias || t.dias.length === 0) return true;
            return t.dias.includes(wk);
          }
        }

        if (modoNorm === 'SOLO_TEMPORADAS') return false;
        if (diasBaseSet.size > 0) return diasBaseSet.has(wk);
        return false;
      };

      disable = [(date: Date) => !isAllowed(date)];
    }

    this.fpOptionsFecha = {
      ...this.fpOptionsFecha,
      minDate: today,
      disable,
    };

    const fp = this.fechaFp?.instance;
    if (fp) {
      fp.set('minDate', today);
      fp.set('disable', disable);
      fp.redraw();
    }

    const cur = this.Fecha_Tour();
    const disableFn = disable[0];
    if (cur) {
      const curDate = fp?.parseDate ? fp.parseDate(cur, 'Y-m-d') : new Date(cur);
      if (curDate && (onlyDate(curDate) < today || disableFn?.(curDate))) {
        this.Fecha_Tour.set(null);
        fp?.clear();
      }
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
