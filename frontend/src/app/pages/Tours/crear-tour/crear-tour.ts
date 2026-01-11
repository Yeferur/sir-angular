import { Component, OnInit } from '@angular/core';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Tours, Tour } from '../../../services/Tours/tours';
import { Reservas } from '../../../services/Reservas/reservas';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

type TipoPasajero = 'ADULTO' | 'NINO' | 'INFANTE';

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

type CrearTourFullPayload = {
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
  Disponibilidad?: any;
};

type DiaSemana =
  | 'lunes'
  | 'martes'
  | 'miercoles'
  | 'jueves'
  | 'viernes'
  | 'sabado'
  | 'domingo';

type TemporadaPayload = {
  Nombre_Temporada: string;
  Fecha_Inicio: string; // YYYY-MM-DD
  Fecha_Fin: string;    // YYYY-MM-DD
  Dias: DiaSemana[];
};

type DisponibilidadPayload = {
  Modo: 'TODO_EL_ANO' | 'SOLO_TEMPORADAS';
  Dias_Base: DiaSemana[];          // vacío si SOLO_TEMPORADAS
  Temporadas: TemporadaPayload[];    // puede ser [] si TODO_EL_ANO
};

@Component({
  selector: 'app-crear-tour',
  templateUrl: './crear-tour.html',
  styleUrls: ['./crear-tour.css'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FlatpickrInputDirective],
})
export class CrearTourComponent implements OnInit {
  isLoading = false;

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

  toursExistentes: Tour[] = [];
  monedas: MonedaVM[] = [];

  form: FormGroup;

  diasSemana: Array<{ key: DiaSemana; label: string }> = [
    { key: 'lunes', label: 'Lunes' },
    { key: 'martes', label: 'Martes' },
    { key: 'miercoles', label: 'Miércoles' },
    { key: 'jueves', label: 'Jueves' },
    { key: 'viernes', label: 'Viernes' },
    { key: 'sabado', label: 'Sábado' },
    { key: 'domingo', label: 'Domingo' },
  ];


  constructor(
    private fb: FormBuilder,
    private tours: Tours,
    private reservas: Reservas,
    private router: Router,
    private navbar: DynamicIslandGlobalService
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
  }

  ngOnInit(): void {
    this.loadExistingTours();
    this.loadCurrenciesAndInitPlans();
    this.listenModoDisponibilidad();
  }

  // Getter
  get temporadasFA(): FormArray {
    return this.form.get('temporadas') as FormArray;
  }

  // Helper para base days
  get diasBaseFG(): FormGroup {
    return this.form.get('dias_base') as FormGroup;
  }
  /* ---------------------------
   * Getters útiles
   * --------------------------- */
  get plans(): FormArray {
    return this.form.get('planes') as FormArray;
  }

  getPlanCurrencies(planIndex: number): FormArray {
    return (this.plans.at(planIndex) as FormGroup).get('monedas') as FormArray;
  }

  /* ---------------------------
   * Carga inicial
   * --------------------------- */
  private loadExistingTours(): void {
    this.tours.getTours().subscribe({
      next: (t) => (this.toursExistentes = t || []),
      error: () => (this.toursExistentes = []),
    });
  }

  private loadCurrenciesAndInitPlans(): void {
    this.reservas.getMonedas().subscribe({
      next: (m) => {
        this.monedas = (m || []).map((x: any) => ({
          Id_Moneda: Number(x.Id_Moneda),
          Codigo: String(x.Codigo),
          Nombre_Moneda: String(x.Nombre_Moneda || ''),
        }));
        this.initBasePlan();
      },
      error: () => {
        // fallback mínimo
        this.monedas = [{ Id_Moneda: 1, Codigo: 'COP', Nombre_Moneda: 'Peso colombiano' }];
        this.initBasePlan();
      },
    });
  }

  private initBasePlan(): void {
    if (this.plans.length > 0) return;

    this.plans.push(this.createPlanGroup('Plan básico', false));

    // Aplica reglas de validación desde el inicio
    this.applyPassengerRules(0, 'NINO');
    this.applyPassengerRules(0, 'INFANTE');
    this.applyAdultRulesAcrossPlans();
  }

  /* ---------------------------
   * Construcción de FormGroups
   * --------------------------- */
  private createPlanGroup(planName: string, isBase: boolean): FormGroup {
    const currenciesFA = this.fb.array((this.monedas || []).map((m) => this.createCurrencyGroup(m)));

    return this.fb.group({
      Nombre_Plan: [{ value: planName, disabled: isBase }, [Validators.required, Validators.maxLength(255)]],
      AllowNino: [true],
      AllowInfante: [true],
      monedas: currenciesFA,
    });
  }

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

  /* ---------------------------
   * Acciones UI: Planes
   * --------------------------- */
  addNewPlan(): void {
    this.plans.push(this.createPlanGroup('Nuevo plan', false));
    const idx = this.plans.length - 1;

    this.applyPassengerRules(idx, 'NINO');
    this.applyPassengerRules(idx, 'INFANTE');
    this.applyAdultRulesAcrossPlans();
  }

  deletePlan(index: number): void {
    if (index === 0) return; // no borrar plan básico
    this.plans.removeAt(index);
  }

  /* ---------------------------
   * Acciones UI: Toggle pasajeros
   * --------------------------- */
  togglePassengerType(planIndex: number, tipo: Exclude<TipoPasajero, 'ADULTO'>): void {
    this.applyPassengerRules(planIndex, tipo);
    this.applyAdultRulesAcrossPlans();
  }

  /**
   * Reglas:
   * - Si NO permite Niño/Infante => se deshabilita, se pone 0.
   * - Si permite => en la PRIMERA moneda del plan exigimos min 1 (para que no quede vacío “permitido” pero sin precio base).
   * - En otras monedas queda min 0.
   */
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

        // 1) Plan básico + COP (regla histórica)
        if (p === 0 && code === 'COP') {
          adulto.setValidators([Validators.required, Validators.min(1)]);
        }
        // 2) Cualquier plan: primera moneda del plan debe tener Adulto > 0 (precio base del plan)
        else if (i === 0) {
          adulto.setValidators([Validators.required, Validators.min(1)]);
        }
        // 3) Resto de monedas: opcional
        else {
          adulto.setValidators([Validators.min(0)]);
        }

        adulto.updateValueAndValidity({ emitEvent: false });
      }
    }
  }

  /* ---------------------------
   * Helpers UI (HTML)
   * --------------------------- */
  isBaseCop(planIndex: number, currencyIndex: number): boolean {
    return planIndex === 0 && this.getCurrencyCode(planIndex, currencyIndex) === 'COP';
  }

  isAdultRequired(planIndex: number, currencyIndex: number): boolean {
    // Adulto requerido en: Plan básico + COP, y en la primera moneda de cualquier plan
    return this.isBaseCop(planIndex, currencyIndex) || currencyIndex === 0;
  }


  private getCurrencyCode(planIndex: number, currencyIndex: number): string {
    const cg = this.getPlanCurrencies(planIndex).at(currencyIndex) as FormGroup;
    return String(cg.get('Codigo')?.value || '');
  }

  // Mensajes “bonitos” y consistentes
  getAdultErrorMessage(planIndex: number, currencyIndex: number): string {
    if (this.isBaseCop(planIndex, currencyIndex)) {
      return 'Ingresa un precio válido.';
    }
    return 'Ingresa un precio válido para Adulto.';
  }

  getChildErrorMessage(planIndex: number, currencyIndex: number): string {
    // Por regla, el requerido es en la primera moneda del plan cuando AllowNino=true
    if (currencyIndex === 0) return 'Ingresa un precio válido.';
    return 'Ingresa un precio válido para Niño.';
  }

  getInfantErrorMessage(planIndex: number, currencyIndex: number): string {
    if (currencyIndex === 0) return 'Ingresa un precio válido.';
    return 'Ingresa un precio válido para Infante.';
  }

  /* ---------------------------
   * Validación global antes de enviar
   * --------------------------- */
  private isPricingValid(): boolean {
    // 1) Adulto COP del plan básico > 0
    const baseCurrencies = this.getPlanCurrencies(0);
    const copGroup = baseCurrencies.controls.find((c) => String(c.get('Codigo')?.value || '') === 'COP') as FormGroup | undefined;
    const copAdult = Number(copGroup?.get('ADULTO')?.value || 0);
    if (!copGroup || copAdult <= 0) return false;

    // 2) Si AllowNino/AllowInfante está ON, primera moneda del plan debe ser > 0 para ese tipo
    for (let p = 0; p < this.plans.length; p++) {
      const plan = this.plans.at(p) as FormGroup;
      const allowNino = !!plan.get('AllowNino')?.value;
      const allowInf = !!plan.get('AllowInfante')?.value;

      const firstCurrency = (this.getPlanCurrencies(p).at(0) as FormGroup) || null;
      if (!firstCurrency) continue;

      if (allowNino && Number(firstCurrency.get('NINO')?.value || 0) <= 0) return false;
      if (allowInf && Number(firstCurrency.get('INFANTE')?.value || 0) <= 0) return false;
    }

    return true;
  }

  private touchAllPricingControls(): void {
    // marca tocados para que salgan mensajes en Adulto/Niño/Infante
    this.plans.controls.forEach((plan) => {
      (plan.get('Nombre_Plan') as any)?.markAsTouched?.();

      const currencies = plan.get('monedas') as FormArray;
      currencies.controls.forEach((c) => {
        c.get('ADULTO')?.markAsTouched();
        c.get('NINO')?.markAsTouched();
        c.get('INFANTE')?.markAsTouched();
      });
    });
  }


  private listenModoDisponibilidad(): void {
  this.form.get('Modo_Disponibilidad')?.valueChanges.subscribe((modo) => {
    const isTodo = modo === 'TODO_EL_ANO';

    // Días base: si SOLO_TEMPORADAS => deshabilita y apaga todos (para evitar enviar basura)
    const base = this.diasBaseFG;
    if (!isTodo) {
      Object.keys(base.controls).forEach((k) => {
        base.get(k)?.setValue(false, { emitEvent: false });
        base.get(k)?.disable({ emitEvent: false });
      });
    } else {
      Object.keys(base.controls).forEach((k) => {
        base.get(k)?.enable({ emitEvent: false });
      });
      // por defecto: si todos están false, prende todos para no quedar vacío
      const anyTrue = Object.keys(base.controls).some((k) => !!base.get(k)?.value);
      if (!anyTrue) {
        Object.keys(base.controls).forEach((k) => base.get(k)?.setValue(true, { emitEvent: false }));
      }
    }

    // Revalida temporadas con el validador global
    this.temporadasFA.updateValueAndValidity({ emitEvent: false });
  });

  // dispara una vez al inicio
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

  const g = this.fb.group(
    {
      Nombre_Temporada: ['Temporada', [Validators.required, Validators.maxLength(255)]],
      Fecha_Inicio: [null, [Validators.required]],
      Fecha_Fin: [null, [Validators.required]],
      dias: diasFG,
    },
    { validators: [this.rangoFechasValidator(), this.alMenosUnDiaValidator()] }
  );

  return g;
}

private rangoFechasValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const ini = control.get('Fecha_Inicio')?.value;
    const fin = control.get('Fecha_Fin')?.value;
    if (!ini || !fin) return null;

    // compara YYYY-MM-DD como string (funciona por formato)
    if (String(fin) < String(ini)) {
      return { rangoInvalido: true };
    }
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
    if (!arr) return null;

    if (modo === 'SOLO_TEMPORADAS') {
      if (arr.length === 0) return { requiereTemporada: true };
    }
    return null;
  };
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

  // Toggle: if all selected -> clear all, otherwise set all
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

getTemporadaDiasKeys(tempIndex: number): DiaSemana[] {
  const t = this.temporadasFA.at(tempIndex) as FormGroup;
  const dias = t.get('dias') as FormGroup;
  return Object.keys(dias.controls)
    .filter((k) => !!dias.get(k)?.value) as DiaSemana[];
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
  /* ---------------------------
   * Payload (todo al backend)
   * --------------------------- */
  private buildCreateTourPayload(): CrearTourFullPayload {
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


  /* ---------------------------
   * Submit
   * --------------------------- */
  submitCreateTour(): void {
    if (this.isLoading) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();

      // recoge controles inválidos en el nivel superior
      const invalid = Object.keys(this.form.controls).filter((k) => this.form.get(k)?.invalid);

      // revisar planes/prices anidados
      let pricingInvalid = false;
      try {
        for (let p = 0; p < this.plans.length; p++) {
          const plan = this.plans.at(p) as FormGroup;
          if (plan.get('Nombre_Plan')?.invalid) { pricingInvalid = true; break; }
          const currencies = plan.get('monedas') as FormArray;
          for (let i = 0; i < currencies.length; i++) {
            const cg = currencies.at(i) as FormGroup;
            if (cg.get('ADULTO')?.invalid || cg.get('NINO')?.invalid || cg.get('INFANTE')?.invalid) { pricingInvalid = true; break; }
          }
          if (pricingInvalid) break;
        }
      } catch (e) { /* ignore */ }

      if (pricingInvalid && invalid.indexOf('planes') === -1) invalid.push('planes');

      const friendly: Record<string, string> = {
        Nombre_Tour: 'Nombre del Tour',
        Abreviacion: 'Abreviación',
        Cupo_Base: 'Cupo Base',
        Latitud: 'Latitud',
        Longitud: 'Longitud',
        planes: 'Planes y precios',
        Id_Tour_Origen: 'Copiar horarios (origen)'
      };

      const fields = invalid.map((f) => friendly[f] || f);
      const msg = fields.length ? `Revisa los siguientes campos: ${fields.join(', ')}` : 'Hay campos inválidos en el formulario.';

      this.navbar.alert?.set?.({
        type: 'error',
        title: 'Campos inválidos',
        message: msg,
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) }],
      });
      return;
    }

    // fuerza a mostrar mensajes de precios (incluye Adulto)
    this.touchAllPricingControls();

    if (!this.isPricingValid()) {
      this.navbar.alert?.set?.({
        type: 'error',
        title: 'Faltan precios',
        message:
          'En el Plan básico, el precio de Adulto en COP es obligatorio. Si Niño/Infante están habilitados, deben tener precio base en la primera moneda del plan.',
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) }],
      });
      return;
    }

    this.navbar.alert?.set?.({
      type: 'info',
      title: '¿Crear tour?',
      message: 'Se creará el tour con sus planes y precios (0 si no aplica).',
      autoClose: false,
      buttons: [
        { text: 'Cancelar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) },
        {
          text: 'Crear',
          style: 'primary',
          onClick: () => {
            this.navbar.alert?.set?.(null);
            this.confirmCreateTour();
          },
        },
      ],
    });
  }

  private confirmCreateTour(): void {
    if (this.isLoading) return;
    this.isLoading = true;

    const payload = this.buildCreateTourPayload();

    this.tours.crearTour(payload as any).subscribe({
      next: (resp: any) => {
        this.navbar.alert?.set?.({
          type: 'success',
          title: 'Tour creado',
          message: `Tour creado correctamente. ID: ${resp?.Id_Tour ?? 'N/A'}`,
          autoClose: true,
        });
        setTimeout(() => this.router.navigate(['/Tours/VerTours']), 800);
      },
      error: (err) => {
        console.error('Error al crear tour:', err);
        this.navbar.alert?.set?.({
          type: 'error',
          title: 'Error',
          message: err?.error?.error || err?.error?.message || 'Error al crear el tour',
          autoClose: false,
          buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) }],
        });
      },
      complete: () => (this.isLoading = false),
    });
  }
}
