import { Component, OnInit } from '@angular/core';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { ChangeDetectorRef } from '@angular/core';
import { Tours } from '../../../services/Tours/tours';
import { Reservas } from '../../../services/Reservas/reservas';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

/* =========================================================
 * TYPES
 * ========================================================= */
type TipoPasajero = 'ADULTO' | 'NINO' | 'INFANTE';

type DiaSemana =
  | 'lunes'
  | 'martes'
  | 'miercoles'
  | 'jueves'
  | 'viernes'
  | 'sabado'
  | 'domingo';

type MonedaVM = {
  Id_Moneda: number;
  Codigo: string;
  Nombre_Moneda: string;
};

type PlanPayload = {
  Nombre_Plan: string;
  AllowNino: boolean;
  AllowInfante: boolean;
  Monedas: Array<{
    Id_Moneda: number;
    Codigo: string;
    Precios: { ADULTO: number; NINO: number; INFANTE: number };
  }>;
};

type TemporadaPayload = {
  Nombre_Temporada: string;
  Fecha_Inicio: string;
  Fecha_Fin: string;
  Dias: DiaSemana[];
};

type DisponibilidadPayload = {
  Modo: 'TODO_EL_ANO' | 'SOLO_TEMPORADAS';
  Dias_Base: DiaSemana[];
  Temporadas: TemporadaPayload[];
};

type EditarTourFullPayload = {
  Nombre_Tour: string;
  Abreviacion: string;
  Comision_Hotel: number;
  Comision_Agencia: number;
  Comision_Freelance: number;
  Cupo_Base: number;
  Latitud: number;
  Longitud: number;
  Id_Tour_Origen: number | null;
  Planes: PlanPayload[];
  Disponibilidad: DisponibilidadPayload;
};

@Component({
  selector: 'app-editar-tour',
  templateUrl: './editar-tour.html',
  styleUrls: ['./editar-tour.css'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FlatpickrInputDirective],
})
export class EditarTourComponent implements OnInit {
  isLoading = false;
  loadingData = true;

  tourId = 0;

  monedas: MonedaVM[] = [];
  toursExistentes: any[] = [];

  diasSemana: Array<{ key: DiaSemana; label: string }> = [
    { key: 'lunes', label: 'Lunes' },
    { key: 'martes', label: 'Martes' },
    { key: 'miercoles', label: 'Miércoles' },
    { key: 'jueves', label: 'Jueves' },
    { key: 'viernes', label: 'Viernes' },
    { key: 'sabado', label: 'Sábado' },
    { key: 'domingo', label: 'Domingo' },
  ];

  form: FormGroup;
fpOptionsFecha: Partial<FlatpickrOptions> = {
  dateFormat: 'Y-m-d',
  altInput: true,
  altFormat: 'd/m/Y',
  allowInput: false,
  disableMobile: true,
  monthSelectorType: 'dropdown' as FlatpickrOptions['monthSelectorType'],
  
  altInputClass: 'form-input flatpickr-input flatpickr-alt',

  onReady: (_sel, _str, inst: any) => {
    // ✅ SSR guard ANTES DE TODO
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const cal: HTMLElement = inst?.calendarContainer;
    if (!cal) return;

    cal.classList.add('sir-flatpickr');

    // util: clamp día al máximo del mes
    const clampDay = (y: number, m: number, d: number) => {
      const last = new Date(y, m + 1, 0).getDate(); // último día del mes
      return Math.min(Math.max(d, 1), last);
    };

    // --- Inyectar select en el header estable (flatpickr-month) ---
    let yearDiv: HTMLDivElement | null = null;
    let yearSelect: HTMLSelectElement | null = null;

    const ensureYearSelect = () => {
      // contenedor header
      const monthWrap = cal.querySelector('.flatpickr-month') as HTMLElement | null;
      if (!monthWrap) return null;

      // elimina el input numérico (cuando exista)
      const numWrap = monthWrap.querySelector('.numInputWrapper') as HTMLElement | null;
      if (numWrap) { try { numWrap.remove(); } catch (e) { /* ignore */ } }

      // preferimos insertar dentro del pill .flatpickr-current-month
      const curMonth = monthWrap.querySelector('.flatpickr-current-month') as HTMLElement | null;
      const container = curMonth ?? monthWrap;

      // evita duplicados
      yearSelect = container.querySelector('.sir-year-select') as HTMLSelectElement | null;
      if (yearSelect) return yearSelect;

      // elimina cualquier wrapper previo para mantener DOM limpio
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

      // siempre mueve la vista
      if (typeof inst.jumpToDate === 'function') inst.jumpToDate(newDate);

      // solo setea si ya había selección
      if (inst.selectedDates?.length) {
        inst.setDate(newDate, true); // true => triggerChange para reactive forms
      }
    };

    // init
    buildYears(inst.currentYear ?? new Date().getFullYear());
    syncSelectValue();

    // listeners
    const sel0 = ensureYearSelect();
    sel0?.addEventListener('change', onChange);

    // hook sin pisar otros callbacks
    const wrap = (key: 'onMonthChange' | 'onYearChange', fn: any) => {
      const prev = inst.config[key];
      const arr = Array.isArray(prev) ? prev : prev ? [prev] : [];
      inst.config[key] = [...arr, fn];
    };

    // ✅ cuando cambias mes/año, flatpickr puede re-renderizar header → reinyecta/sincroniza
    wrap('onMonthChange', () => syncSelectValue());
    wrap('onYearChange', () => syncSelectValue());

    // cleanup
    const prevOnDestroy = inst.config.onDestroy;
    const destroyArr = Array.isArray(prevOnDestroy) ? prevOnDestroy : prevOnDestroy ? [prevOnDestroy] : [];
    inst.config.onDestroy = [
      ...destroyArr,
      () => sel0?.removeEventListener('change', onChange)
    ];
  }
};

  constructor(
    private fb: FormBuilder,
    private tours: Tours,
    private reservas: Reservas,
    private router: Router,
    private route: ActivatedRoute,
    private navbar: DynamicIslandGlobalService,
    private cd: ChangeDetectorRef
  ) {
    this.form = this.fb.group({
      Nombre_Tour: ['', [Validators.required, Validators.maxLength(255)]],
      Abreviacion: ['', [Validators.required, Validators.maxLength(50)]],
      Comision_Hotel: [0, [Validators.min(0)]],
      Comision_Agencia: [0, [Validators.min(0)]],
      Comision_Freelance: [0, [Validators.min(0)]],
      Cupo_Base: [null, [Validators.required, Validators.min(0)]],
      Latitud: [null, [Validators.required, Validators.min(-90), Validators.max(90)]],
      Longitud: [null, [Validators.required, Validators.min(-180), Validators.max(180)]],
      Id_Tour_Origen: [null],

      // compat simple pricing (no lo usamos si hay planes)
      Id_Moneda: [null],
      Tiene_Plan: [false],
      Nombre_Plan: [''],
      precios: this.fb.group({ ADULTO: [0], NINO: [0], INFANTE: [0] }),

      // planes / disponibilidad
      planes: this.fb.array([]),
      Modo_Disponibilidad: ['TODO_EL_ANO', [Validators.required]],
      dias_base: this.fb.group({
        lunes: [true],
        martes: [true],
        miercoles: [true],
        jueves: [true],
        viernes: [true],
        sabado: [true],
        domingo: [true],
      }),
      temporadas: this.fb.array([], [this.temporadasValidator()]),
    });
    this.fpOptionsFecha = {
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'd/m/Y',
      disableMobile: true,
      altInputClass: 'form-input flatpickr-input flatpickr-alt'
    };
  }

  /* =========================================================
   * GETTERS
   * ========================================================= */
  get plans(): FormArray {
    return this.form.get('planes') as FormArray;
  }
  get temporadasFA(): FormArray {
    return this.form.get('temporadas') as FormArray;
  }
  get diasBaseFG(): FormGroup {
    return this.form.get('dias_base') as FormGroup;
  }
  getPlanCurrencies(planIndex: number): FormArray {
    return (this.plans.at(planIndex) as FormGroup).get('monedas') as FormArray;
  }

  ngOnInit(): void {
    this.route.params.subscribe((params) => {
      this.tourId = Number(params['id']) || 0;

      if (!this.tourId) {
        this.navbar.alert?.set?.({
          type: 'error',
          title: 'Error',
          message: 'ID de tour inválido',
          autoClose: false,
          buttons: [
            {
              text: 'Volver',
              style: 'primary',
              onClick: () => {
                this.navbar.alert?.set?.(null);
                this.router.navigate(['/Tours/VerTours']);
              },
            },
          ],
        });
        return;
      }

      this.loadExistingTours();

      // 1) Monedas -> init base plan
      // 2) Cargar tour -> rearmar planes con data real
      this.loadCurrenciesAndInitPlans(() => {
        this.listenModoDisponibilidad();

        const defaultMon = this.monedas?.length ? this.monedas[0].Id_Moneda : null;
        if (defaultMon != null) {
          this.form.get('Id_Moneda')?.setValue(defaultMon, { emitEvent: false });
          this.loadSimplePrecios(defaultMon);
        }

        this.form.get('Id_Moneda')?.valueChanges.subscribe((mid) => {
          if (mid) this.loadSimplePrecios(Number(mid));
        });

        this.cargarTour();
      });
    });
  }

  /* =========================================================
   * CARGA INICIAL
   * ========================================================= */
  private loadExistingTours(): void {
    this.tours.getTours().subscribe({
      next: (t) => (this.toursExistentes = t || []),
      error: () => (this.toursExistentes = []),
    });
  }

  private loadCurrenciesAndInitPlans(done?: () => void): void {
    this.reservas.getMonedas().subscribe({
      next: (m) => {
        this.monedas = (m || []).map((x: any) => ({
          Id_Moneda: Number(x.Id_Moneda),
          Codigo: String(x.Codigo),
          Nombre_Moneda: String(x.Nombre_Moneda || ''),
        }));
        this.initBasePlan();
        done?.();
      },
      error: () => {
        this.monedas = [{ Id_Moneda: 1, Codigo: 'COP', Nombre_Moneda: 'Peso colombiano' }];
        this.initBasePlan();
        done?.();
      },
    });
  }

  /* =========================================================
   * BUILDERS PLAN / MONEDA
   * ========================================================= */
  private createCurrencyGroup(moneda: MonedaVM): FormGroup {
    return this.fb.group({
      Id_Moneda: [moneda.Id_Moneda, Validators.required],
      Codigo: [moneda.Codigo],
      Nombre_Moneda: [moneda.Nombre_Moneda],
      ADULTO: [0, [Validators.min(0)]],
      NINO: [0, [Validators.min(0)]],
      INFANTE: [0, [Validators.min(0)]],
    });
  }

  // ✅ IMPORTANTE: incluir Id_Plan en el form
  private createPlanGroup(planName: string, isBase: boolean, idPlan: number | null = null): FormGroup {
    const currenciesFA = this.fb.array((this.monedas || []).map((m) => this.createCurrencyGroup(m)));

    return this.fb.group({
      Id_Plan: [idPlan],
      Nombre_Plan: [{ value: planName, disabled: isBase }, [Validators.required, Validators.maxLength(255)]],
      AllowNino: [true],
      AllowInfante: [true],
      monedas: currenciesFA,
    });
  }

  private initBasePlan(): void {
    if (this.plans.length > 0) return;

    this.plans.push(this.createPlanGroup('Plan básico', false, null));

    this.applyPassengerRules(0, 'NINO');
    this.applyPassengerRules(0, 'INFANTE');
    this.applyAdultRulesAcrossPlans();
  }

  /* =========================================================
   * ACCIONES UI: PLANES
   * ========================================================= */
  addNewPlan(): void {
    this.plans.push(this.createPlanGroup('Nuevo plan', false, null));
    const idx = this.plans.length - 1;

    this.applyPassengerRules(idx, 'NINO');
    this.applyPassengerRules(idx, 'INFANTE');
    this.applyAdultRulesAcrossPlans();
  }

  deletePlan(index: number): void {
    if (index === 0) return;
    this.plans.removeAt(index);
  }

  togglePassengerType(planIndex: number, tipo: Exclude<TipoPasajero, 'ADULTO'>): void {
    this.applyPassengerRules(planIndex, tipo);
    this.applyAdultRulesAcrossPlans();
  }

  private applyPassengerRules(planIndex: number, tipo: Exclude<TipoPasajero, 'ADULTO'>): void {
    const plan = this.plans.at(planIndex) as FormGroup;
    const allowKey = tipo === 'NINO' ? 'AllowNino' : 'AllowInfante';
    const allowed = !!plan.get(allowKey)?.value;

    const currencies = this.getPlanCurrencies(planIndex);

    for (let i = 0; i < currencies.length; i++) {
      const cg = currencies.at(i) as FormGroup;
      const ctrl = cg.get(tipo);
      if (!ctrl) continue;

      if (!allowed) {
        ctrl.setValue(0, { emitEvent: false });
        ctrl.disable({ emitEvent: false });
        ctrl.setValidators([Validators.min(0)]);
      } else {
        ctrl.enable({ emitEvent: false });
        if (i === 0) ctrl.setValidators([Validators.required, Validators.min(1)]);
        else ctrl.setValidators([Validators.min(0)]);
      }

      ctrl.updateValueAndValidity({ emitEvent: false });
    }
  }

  private applyAdultRulesAcrossPlans(): void {
    for (let p = 0; p < this.plans.length; p++) {
      const currencies = this.getPlanCurrencies(p);

      for (let i = 0; i < currencies.length; i++) {
        const cg = currencies.at(i) as FormGroup;
        const code = String(cg.get('Codigo')?.value || '');
        const adulto = cg.get('ADULTO');
        if (!adulto) continue;

        if (p === 0 && code === 'COP') adulto.setValidators([Validators.required, Validators.min(1)]);
        else if (i === 0) adulto.setValidators([Validators.required, Validators.min(1)]);
        else adulto.setValidators([Validators.min(0)]);

        adulto.updateValueAndValidity({ emitEvent: false });
      }
    }
  }

  private adjustControlsAfterPopulate() {
    try {
      for (let p = 0; p < this.plans.length; p++) {
        const plan = this.plans.at(p) as FormGroup;
        const allowNino = !!plan.get('AllowNino')?.value;
        const allowInf = !!plan.get('AllowInfante')?.value;

        const monedasFA = plan.get('monedas') as FormArray;
        for (let i = 0; i < monedasFA.length; i++) {
          const mg = monedasFA.at(i) as FormGroup;

          const adulto = mg.get('ADULTO');
          const nino = mg.get('NINO');
          const inf = mg.get('INFANTE');

          adulto?.enable({ emitEvent: false });
          adulto?.updateValueAndValidity({ emitEvent: false });

          if (nino) {
            if (allowNino) nino.enable({ emitEvent: false });
            else {
              nino.setValue(0, { emitEvent: false });
              nino.disable({ emitEvent: false });
            }
            nino.updateValueAndValidity({ emitEvent: false });
          }

          if (inf) {
            if (allowInf) inf.enable({ emitEvent: false });
            else {
              inf.setValue(0, { emitEvent: false });
              inf.disable({ emitEvent: false });
            }
            inf.updateValueAndValidity({ emitEvent: false });
          }
        }
      }
      this.cd.detectChanges();
    } catch {
      // ignore
    }
  }

  /* =========================================================
   * PRECIOS SIMPLE (compat)
   * ========================================================= */
  private loadSimplePrecios(Id_Moneda: number) {
    if (!Id_Moneda || !this.tourId) return;
    this.reservas.getPrecios({ Id_Tour: this.tourId, Id_Moneda }).subscribe({
      next: (map: any) => {
        const g = this.form.get('precios') as FormGroup;
        if (!g) return;

        g.get('ADULTO')?.setValue(Number(map?.ADULTO ?? 0), { emitEvent: false });
        g.get('NINO')?.setValue(Number(map?.NINO ?? 0), { emitEvent: false });
        g.get('INFANTE')?.setValue(Number(map?.INFANTE ?? 0), { emitEvent: false });

        const anyPrice = !!(map && (map.ADULTO || map.NINO || map.INFANTE));
        this.form.get('Tiene_Plan')?.setValue(Boolean(anyPrice), { emitEvent: false });

        try { this.cd.detectChanges(); } catch {}
      },
      error: () => {},
    });
  }

  /* =========================================================
   * DISPONIBILIDAD
   * ========================================================= */
  private listenModoDisponibilidad(): void {
    this.form.get('Modo_Disponibilidad')?.valueChanges.subscribe((modo) => {
      const isTodo = modo === 'TODO_EL_ANO';
      const base = this.diasBaseFG;

      if (!isTodo) {
        Object.keys(base.controls).forEach((k) => {
          base.get(k)?.setValue(false, { emitEvent: false });
          base.get(k)?.disable({ emitEvent: false });
        });
      } else {
        Object.keys(base.controls).forEach((k) => base.get(k)?.enable({ emitEvent: false }));

        const anyTrue = Object.keys(base.controls).some((k) => !!base.get(k)?.value);
        if (!anyTrue) Object.keys(base.controls).forEach((k) => base.get(k)?.setValue(true, { emitEvent: false }));
      }

      this.temporadasFA.updateValueAndValidity({ emitEvent: false });
    });

    const modo = this.form.get('Modo_Disponibilidad')?.value;
    if (modo) this.form.get('Modo_Disponibilidad')?.setValue(modo, { emitEvent: true });
  }

  addTemporada(): void {
    this.temporadasFA.push(this.createTemporadaGroup());
    this.temporadasFA.updateValueAndValidity({ emitEvent: false });
  }

  deleteTemporada(index: number): void {
    this.temporadasFA.removeAt(index);
    this.temporadasFA.updateValueAndValidity({ emitEvent: false });
  }

  isSoloTemporadas(): boolean {
    return this.form.get('Modo_Disponibilidad')?.value === 'SOLO_TEMPORADAS';
  }

  toggleAllBaseDays(value: boolean): void {
    Object.keys(this.diasBaseFG.controls).forEach((k) => {
      const ctrl = this.diasBaseFG.get(k);
      if (ctrl?.disabled) return;
      ctrl?.setValue(value);
    });
  }

  // Toggle behaviour: single button toggles between select-all and clear-all
  areAllBaseDaysSelected(): boolean {
    const base = this.diasBaseFG;
    const keys = Object.keys(base.controls).filter((k) => !base.get(k)?.disabled);
    if (keys.length === 0) return false;
    return keys.every((k) => !!base.get(k)?.value);
  }

  toggleAllBaseDaysToggle(): void {
    const all = this.areAllBaseDaysSelected();
    this.toggleAllBaseDays(!all);
  }

  toggleAllSeasonDays(tempIndex: number, value: boolean): void {
    const t = this.temporadasFA.at(tempIndex) as FormGroup;
    const dias = t.get('dias') as FormGroup;
    Object.keys(dias.controls).forEach((k) => dias.get(k)?.setValue(value));
  }

  areAllSeasonDaysSelected(tempIndex: number): boolean {
    const t = this.temporadasFA.at(tempIndex) as FormGroup;
    const dias = t.get('dias') as FormGroup;
    const keys = Object.keys(dias.controls);
    if (keys.length === 0) return false;
    return keys.every((k) => !!dias.get(k)?.value);
  }

  toggleAllSeasonDaysToggle(tempIndex: number): void {
    const all = this.areAllSeasonDaysSelected(tempIndex);
    this.toggleAllSeasonDays(tempIndex, !all);
  }

  private createTemporadaGroup(): FormGroup {
    const diasFG = this.fb.group({
      lunes: [false],
      martes: [false],
      miercoles: [false],
      jueves: [false],
      viernes: [false],
      sabado: [false],
      domingo: [false],
    });

    return this.fb.group(
      {
        Nombre_Temporada: ['Temporada', [Validators.required, Validators.maxLength(255)]],
        Fecha_Inicio: [null, [Validators.required]],
        Fecha_Fin: [null, [Validators.required]],
        dias: diasFG,
      },
      { validators: [this.rangoFechasValidator(), this.alMenosUnDiaValidator()] }
    );
  }

  private rangoFechasValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const ini = control.get('Fecha_Inicio')?.value;
      const fin = control.get('Fecha_Fin')?.value;
      if (!ini || !fin) return null;
      if (String(fin) < String(ini)) return { rangoInvalido: true };
      return null;
    };
  }

  private alMenosUnDiaValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const dias = control.get('dias') as FormGroup;
      if (!dias) return null;
      const any = Object.keys(dias.controls).some((k) => !!dias.get(k)?.value);
      return any ? null : { sinDias: true };
    };
  }

  private temporadasValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const modo = this.form?.get('Modo_Disponibilidad')?.value;
      const arr = control as FormArray;
      if (modo === 'SOLO_TEMPORADAS') {
        if (!arr || arr.length === 0) return { requiereTemporada: true };
      }
      return null;
    };
  }

  private buildDisponibilidadPayload(): DisponibilidadPayload {
    const modo: 'TODO_EL_ANO' | 'SOLO_TEMPORADAS' = this.form.get('Modo_Disponibilidad')?.value;

    const diasBase: DiaSemana[] =
      modo === 'TODO_EL_ANO'
        ? (Object.keys(this.diasBaseFG.controls).filter((k) => !!this.diasBaseFG.get(k)?.value) as DiaSemana[])
        : [];

    const temporadas: TemporadaPayload[] = this.temporadasFA.controls.map((c) => {
      const g = c as FormGroup;
      const diasFG = g.get('dias') as FormGroup;

      const dias = Object.keys(diasFG.controls).filter((k) => !!diasFG.get(k)?.value) as DiaSemana[];

      return {
        Nombre_Temporada: String(g.get('Nombre_Temporada')?.value || '').trim(),
        Fecha_Inicio: String(g.get('Fecha_Inicio')?.value || ''),
        Fecha_Fin: String(g.get('Fecha_Fin')?.value || ''),
        Dias: dias,
      };
    });

    return { Modo: modo, Dias_Base: diasBase, Temporadas: temporadas };
  }

  /* =========================================================
   * CARGAR TOUR + MAPEO PLANES
   * ========================================================= */
  cargarTour(): void {
    this.loadingData = true;

    this.tours.getTourById(this.tourId).subscribe({
      next: (tour: any) => {
        try {
          // básicos
          this.form.patchValue(
            {
              Nombre_Tour: tour.Nombre_Tour,
              Abreviacion: tour.Abreviacion,
              Comision_Hotel: tour.Comision_Hotel || 0,
              Comision_Agencia: tour.Comision_Agencia || 0,
              Comision_Freelance: tour.Comision_Freelance || 0,
              Cupo_Base: tour.Cupo_Base,
              Latitud: tour.Latitud,
              Longitud: tour.Longitud,
              Id_Tour_Origen: tour.Id_Tour_Origen ?? null,
            },
            { emitEvent: false }
          );

          // disponibilidad
          if (tour?.Disponibilidad) {
            const d = tour.Disponibilidad;
            const modo = String(d.Modo || 'TODO_EL_ANO').toUpperCase();

            this.form.get('Modo_Disponibilidad')?.setValue(
              modo === 'SOLO_TEMPORADAS' ? 'SOLO_TEMPORADAS' : 'TODO_EL_ANO',
              { emitEvent: false }
            );

            const base = this.diasBaseFG;
            const baseMap: Record<DiaSemana, boolean> = {
              lunes: false,
              martes: false,
              miercoles: false,
              jueves: false,
              viernes: false,
              sabado: false,
              domingo: false,
            };

            if (Array.isArray(d.Dias_Base)) {
              for (const dd of d.Dias_Base) {
                const k = String(dd).toLowerCase() as DiaSemana;
                if (k in baseMap) baseMap[k] = true;
              }
            }
            Object.keys(baseMap).forEach((k) => base.get(k)?.setValue(baseMap[k as DiaSemana], { emitEvent: false }));

            while (this.temporadasFA.length) this.temporadasFA.removeAt(0);

            if (Array.isArray(d.Temporadas)) {
              for (const t of d.Temporadas) {
                const tg = this.createTemporadaGroup();
                tg.patchValue(
                  {
                    Nombre_Temporada: t.Nombre_Temporada || 'Temporada',
                    Fecha_Inicio: t.Fecha_Inicio || null,
                    Fecha_Fin: t.Fecha_Fin || null,
                  },
                  { emitEvent: false }
                );

                const diasFG = tg.get('dias') as FormGroup;
                const diasMap: Record<DiaSemana, boolean> = {
                  lunes: false,
                  martes: false,
                  miercoles: false,
                  jueves: false,
                  viernes: false,
                  sabado: false,
                  domingo: false,
                };

                if (Array.isArray(t.Dias)) {
                  for (const dd of t.Dias) {
                    const k = String(dd).toLowerCase() as DiaSemana;
                    if (k in diasMap) diasMap[k] = true;
                  }
                }
                Object.keys(diasMap).forEach((k) => diasFG.get(k)?.setValue(diasMap[k as DiaSemana], { emitEvent: false }));

                this.temporadasFA.push(tg);
              }
            }

            this.temporadasFA.updateValueAndValidity({ emitEvent: false });
          }

          // ✅ Planes + precios desde backend
          const hasPlanes = Array.isArray(tour?.Planes) && tour.Planes.length > 0;

          if (hasPlanes) {
            while (this.plans.length) this.plans.removeAt(0);

            for (let i = 0; i < tour.Planes.length; i++) {
              const p = tour.Planes[i];
              const isBase = i === 0;

              const pg = this.createPlanGroup(
                p.Nombre_Plan || 'Plan',
                isBase,
                (p.Id_Plan != null ? Number(p.Id_Plan) : null)
              );

              pg.get('AllowNino')?.setValue(!!p.AllowNino, { emitEvent: false });
              pg.get('AllowInfante')?.setValue(!!p.AllowInfante, { emitEvent: false });

              const monedasFA = pg.get('monedas') as FormArray;

              if (Array.isArray(p.Monedas)) {
                for (const m of p.Monedas) {
                  const idx = this.monedas.findIndex((mm) => Number(mm.Id_Moneda) === Number(m.Id_Moneda));
                  if (idx >= 0) {
                    const mg = monedasFA.at(idx) as FormGroup;
                    mg.get('ADULTO')?.setValue(Number(m.Precios?.ADULTO || 0), { emitEvent: false });
                    mg.get('NINO')?.setValue(Number(m.Precios?.NINO || 0), { emitEvent: false });
                    mg.get('INFANTE')?.setValue(Number(m.Precios?.INFANTE || 0), { emitEvent: false });
                  }
                }
              }

              this.plans.push(pg);

              this.applyPassengerRules(i, 'NINO');
              this.applyPassengerRules(i, 'INFANTE');
            }

            this.applyAdultRulesAcrossPlans();

            // ocultar UI simple si hay planes
            this.form.get('Tiene_Plan')?.setValue(false, { emitEvent: false });

            this.loadingData = false;
            this.adjustControlsAfterPopulate();
            try { this.cd.detectChanges(); } catch {}

            return;
          }

          // si no hay planes, deja base vacío
          this.loadingData = false;
        } catch (e) {
          console.error('Error mapping tour:', e);
          this.loadingData = false;
        }
      },
      error: (err) => {
        this.loadingData = false;
        this.navbar.alert?.set?.({
          type: 'error',
          title: 'Error al cargar tour',
          message: err?.error?.error || 'No se pudo cargar la información del tour',
          autoClose: false,
          buttons: [
            {
              text: 'Volver',
              style: 'primary',
              onClick: () => {
                this.navbar.alert?.set?.(null);
                this.router.navigate(['/Tours/VerTours']);
              },
            },
          ],
        });
      },
    });
  }

  /* =========================================================
   * PAYLOAD UPDATE
   * ========================================================= */
  private buildUpdateTourPayload(): EditarTourFullPayload {
    const raw = this.form.getRawValue();

    const planes: PlanPayload[] = (raw.planes || []).map((p: any) => {
      const allowNino = !!p.AllowNino;
      const allowInf = !!p.AllowInfante;

      const monedas = (p.monedas || []).map((m: any) => ({
        Id_Moneda: Number(m.Id_Moneda),
        Codigo: String(m.Codigo || ''),
        Precios: {
          ADULTO: Number(m.ADULTO || 0),
          NINO: allowNino ? Number(m.NINO || 0) : 0,
          INFANTE: allowInf ? Number(m.INFANTE || 0) : 0,
        },
      }));

      return {
        Nombre_Plan: String(p.Nombre_Plan || '').trim(),
        AllowNino: allowNino,
        AllowInfante: allowInf,
        Monedas: monedas,
      };
    });

    const disponibilidad = this.buildDisponibilidadPayload();

    return {
      Nombre_Tour: String(raw.Nombre_Tour || '').trim(),
      Abreviacion: String(raw.Abreviacion || '').trim(),
      Comision_Hotel: Number(raw.Comision_Hotel || 0),
      Comision_Agencia: Number(raw.Comision_Agencia || 0),
      Comision_Freelance: Number(raw.Comision_Freelance || 0),
      Cupo_Base: Number(raw.Cupo_Base || 0),
      Latitud: Number(raw.Latitud),
      Longitud: Number(raw.Longitud),
      Id_Tour_Origen: raw.Id_Tour_Origen ?? null,
      Planes: planes,
      Disponibilidad: disponibilidad,
    };
  }

  /* =========================================================
   * SUBMIT
   * ========================================================= */
  onSubmitEditarTour(): void {
    if (this.isLoading) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.navbar.alert?.set?.({
        type: 'error',
        title: 'Campos inválidos',
        message: 'Revisa los campos del formulario.',
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) }],
      });
      return;
    }

    this.navbar.alert?.set?.({
      type: 'info',
      title: '¿Actualizar tour?',
      message: '¿Deseas guardar los cambios realizados?',
      autoClose: false,
      buttons: [
        { text: 'Cancelar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) },
        { text: 'Guardar', style: 'primary', onClick: () => { this.navbar.alert?.set?.(null); this.editarTourConfirmado(); } },
      ],
    });
  }

  private editarTourConfirmado(): void {
    if (this.isLoading || this.form.invalid) return;

    this.isLoading = true;

    const payload = this.buildUpdateTourPayload();

    this.tours.updateTour(this.tourId, payload as any).subscribe({
      next: () => {
        this.navbar.alert?.set?.({
          type: 'success',
          title: 'Tour actualizado',
          message: 'El tour ha sido actualizado exitosamente.',
          autoClose: true,
        });
        setTimeout(() => this.router.navigate(['/Tours/VerTours']), 900);
      },
      error: (err) => {
        console.error('Error al actualizar tour:', err);
        this.navbar.alert?.set?.({
          type: 'error',
          title: 'Error',
          message: err?.error?.error || err?.error?.message || 'Error al actualizar el tour',
          autoClose: false,
          buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) }],
        });
      },
      complete: () => (this.isLoading = false),
    });
  }
}
