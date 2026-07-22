import { Component, OnInit, inject, signal } from '@angular/core';
import { DatepickerComponent } from '../../../shared/datepicker/datepicker';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormArray, FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Tours, Tour, CanalComision } from '../../../services/Tours/tours';
import { Reservas } from '../../../services/Reservas/reservas';
import { AlertButton, SirAlertService } from '../../../services/Alertas/alert.service';
import { UiStateService } from '../../../services/ui-state.service';

type TipoPasajero = 'ADULTO' | 'NINO' | 'INFANTE';

type MonedaVM = {
  Id_Moneda: number;
  Codigo: string;
  Nombre_Moneda: string;
};

type CanalComisionVM = {
  Id_Canal: number;
  Nombre_Canal: string;
  activo: boolean;
  valor: number;
};

type PlanPayload = {
  Nombre_Plan: string;
  Fecha_Inicio: string | null;
  Fecha_Fin: string | null;
  AllowNino: boolean;
  AllowInfante: boolean;
  Monedas: Array<{
    Id_Moneda: number;
    Codigo: string;
    Precios: { ADULTO: number; NINO: number; INFANTE: number };
  }>;
};

type ComisionPayload = {
  Id_Canal: number;
  Valor: number;
};

type CrearTourFullPayload = {
  Nombre_Tour: string;
  Abreviacion: string;
  Comisiones: ComisionPayload[];
  Cupo_Base: number;
  Latitud: number | null;
  Longitud: number | null;
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
  styleUrls: ['../tour-shared.css'],
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, DatepickerComponent],
})
export class CrearTourComponent implements OnInit {
  private alerts = inject(SirAlertService);
  private uiState = inject(UiStateService);
  isLoading = signal<boolean>(true);
  isSubmitting = signal(false);
  private toursLoaded = false;
  private currenciesLoaded = false;
  private canalesLoaded = false;
  private readonly dayKeys: DiaSemana[] = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

  // Canales disponibles con comisión
  canalesComisiones: CanalComisionVM[] = [];


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


  private get navbar() {
    return {
      alert: {
        set: (alert: Parameters<SirAlertService['showModal']>[0] | null) => {
          if (alert) this.alerts.showModal(alert);
          else this.alerts.closeModal();
        }
      },
      successToast: (title: string, message = '') => this.alerts.successToast(title, message),
      errorToast: (title: string, message = '') => this.alerts.errorToast(title, message),
      needsRefresh: this.uiState.needsRefresh,
    };
  }

  constructor(
    private fb: FormBuilder,
    private tours: Tours,
    private reservas: Reservas,
    private router: Router
  ) {
    this.form = this.fb.group({
      Nombre_Tour: ['', [Validators.required, Validators.maxLength(255)]],
      Abreviacion: ['', [Validators.required, Validators.maxLength(50)]],
      Cupo_Base: [null, [Validators.required, Validators.min(0)]],
      Coordenadas: ['', [this.coordenadasValidator()]],
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
    this.loadCanales();
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
      error: () => {
        this.toursExistentes = [];
        this.markInitialLoadStep('tours');
      },
      complete: () => this.markInitialLoadStep('tours'),
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
        this.markInitialLoadStep('currencies');
      },
      complete: () => this.markInitialLoadStep('currencies'),
    });
  }

  // Canales con comisión: por ahora mock local hasta que el back esté listo
  // TODO: reemplazar por this.tours.getCanales().subscribe(...)
  private loadCanales(): void {
    this.tours.getCanalesComision().subscribe({
      next: (canales) => {
        this.canalesComisiones = canales.map((c) => ({
          Id_Canal: c.Id_Canal,
          Nombre_Canal: c.Nombre_Canal,
          activo: false,
          valor: 0,
        }));
        this.markInitialLoadStep('canales');
      },
      error: () => {
        this.canalesComisiones = [];
        this.markInitialLoadStep('canales');
      },
    });
  }

  toggleCanal(idx: number): void {
    const canal = this.canalesComisiones[idx];
    canal.activo = !canal.activo;
    if (!canal.activo) canal.valor = 0;
  }

  private markInitialLoadStep(step: 'tours' | 'currencies' | 'canales'): void {
    if (step === 'tours') this.toursLoaded = true;
    if (step === 'currencies') this.currenciesLoaded = true;
    if (step === 'canales') this.canalesLoaded = true;

    if (this.toursLoaded && this.currenciesLoaded && this.canalesLoaded) {
      this.isLoading.set(false);
    }
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
      esPermanente: [true],
      Fecha_Inicio: [null],
      Fecha_Fin: [null],
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

  const triggerAutoDays = () => this.aplicarDiasAutomaticosTemporada(g);
  g.get('Fecha_Inicio')?.valueChanges.subscribe(triggerAutoDays);
  g.get('Fecha_Fin')?.valueChanges.subscribe(triggerAutoDays);

  return g;
}

private parseYmdLocal(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return null;
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

private toYmdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

private getDiasEnRango(inicio: string, fin: string): DiaSemana[] {
  if (!inicio || !fin || String(fin) < String(inicio)) return [];

  const start = this.parseYmdLocal(inicio);
  const end = this.parseYmdLocal(fin);
  if (!start || !end) return [];

  const dias = new Set<DiaSemana>();
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());

  while (this.toYmdLocal(cursor) <= fin) {
    dias.add(this.dayKeys[cursor.getDay()]);
    cursor.setDate(cursor.getDate() + 1);
    if (dias.size === 7) break;
  }

  const order: DiaSemana[] = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
  return order.filter((dia) => dias.has(dia));
}

private aplicarDiasAutomaticosTemporada(tempGroup: FormGroup): void {
  const inicio = String(tempGroup.get('Fecha_Inicio')?.value || '');
  const fin = String(tempGroup.get('Fecha_Fin')?.value || '');
  const diasFG = tempGroup.get('dias') as FormGroup | null;

  if (!inicio || !fin || !diasFG || String(fin) < String(inicio)) return;

  const dias = this.getDiasEnRango(inicio, fin);
  if (!dias.length) return;

  Object.keys(diasFG.controls).forEach((k) => {
    diasFG.get(k)?.setValue(dias.includes(k as DiaSemana), { emitEvent: false });
  });

  tempGroup.updateValueAndValidity({ emitEvent: false });
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
      const esPermanente = p.esPermanente !== false;

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
        Fecha_Inicio: esPermanente ? null : (p.Fecha_Inicio || null),
        Fecha_Fin: esPermanente ? null : (p.Fecha_Fin || null),
        AllowNino: allowNino,
        AllowInfante: allowInf,
        Monedas: monedas,
      };
    });

    const comisiones: ComisionPayload[] = this.canalesComisiones
      .filter((c) => c.activo && c.valor > 0)
      .map((c) => ({ Id_Canal: c.Id_Canal, Valor: c.valor }));

    const disponibilidad = this.buildDisponibilidadPayload();

    const coords = this.parseCoordenadas(raw.Coordenadas || '');

    return {
      Nombre_Tour: String(raw.Nombre_Tour || '').trim(),
      Abreviacion: String(raw.Abreviacion || '').trim(),
      Comisiones: comisiones,
      Cupo_Base: Number(raw.Cupo_Base || 0),
      Latitud: coords?.lat ?? null,
      Longitud: coords?.lng ?? null,
      Id_Tour_Origen: raw.Id_Tour_Origen ?? null,
      Planes: planes,
      Disponibilidad: disponibilidad,
    };
  }


  /* ---------------------------
   * Submit
   * --------------------------- */
  async submitCreateTour(): Promise<void> {
    if (this.isSubmitting()) return;

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
        planes: 'Planes y precios',
        Id_Tour_Origen: 'Usar puntos de encuentro de (origen)'
      };

      const fields = invalid.map((f) => friendly[f] || f);
      const msg = fields.length ? `Revisa los siguientes campos: ${fields.join(', ')}` : 'Hay campos inválidos en el formulario.';

      this.navbar.alert?.set?.({
        type: 'error',
        title: 'Campos requeridos incompletos',
        message: msg,
        autoClose: true,
        buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.alert?.set?.(null) }],
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

    const confirmed = await this.requestCreateTourConfirmation();
    if (!confirmed) return;

    this.confirmCreateTour();
  }

  private buildCreateTourConfirmationMessage(): string {
    const nombreTour = String(this.form.get('Nombre_Tour')?.value || '').trim();
    const abreviacion = String(this.form.get('Abreviacion')?.value || '').trim();
    const cupoBase = Number(this.form.get('Cupo_Base')?.value || 0);
    const cantidadPlanes = this.plans.length;
    const modoDisponibilidad = this.form.get('Modo_Disponibilidad')?.value === 'SOLO_TEMPORADAS'
      ? 'Solo por temporadas'
      : 'Todo el año';
    const origenId = this.form.get('Id_Tour_Origen')?.value;
    const nombreOrigen = origenId
      ? this.toursExistentes.find((tour) => String(tour.Id_Tour) === String(origenId))?.Nombre_Tour
      : null;

    const partes = [
      `Vas a crear el tour ${nombreTour || '—'}.`,
      `Abreviación: ${abreviacion || '—'}.`,
      `Cupo base: ${cupoBase}.`,
      `Planes: ${cantidadPlanes}.`,
      `Disponibilidad: ${modoDisponibilidad}.`,
    ];

    if (origenId) {
      partes.push(`Copiará horarios desde: ${nombreOrigen || 'tour origen seleccionado'}.`);
    } else {
      partes.push('Los horarios quedarán pendientes/configurables.');
    }

    partes.push('¿Deseas continuar?');
    return partes.join('\n');
  }

  private requestCreateTourConfirmation(): Promise<boolean> {
    return new Promise((resolve) => {
      this.navbar.alert?.set?.({
        type: 'info',
        title: '¿Todo listo?',
        message: this.buildCreateTourConfirmationMessage(),
        autoClose: false,
        buttons: [
          {
            text: 'Cancelar',
            style: 'secondary',
            onClick: () => {
              this.navbar.alert?.set?.(null);
              resolve(false);
            },
          },
          {
            text: 'Crear',
            style: 'primary',
            onClick: () => {
              this.navbar.alert?.set?.(null);
              resolve(true);
            },
          },
        ],
      });
    });
  }

  private confirmCreateTour(): void {
    if (this.isSubmitting()) return;
    this.isSubmitting.set(true);

    const payload = this.buildCreateTourPayload();

    this.tours.crearTour(payload as any).subscribe({
      next: (resp: any) => {
        this.navbar.needsRefresh.set('tours');
        this.navbar.successToast('Tour creado', `Tour creado correctamente. ID: ${resp?.Id_Tour ?? 'N/A'}`);
        this.form.markAsPristine();
        this.router.navigate(['/Tours/VerTours']);
      },
      error: (err) => {
        console.error('Error al crear tour:', err);
        this.isSubmitting.set(false);
        this.navbar.errorToast('Error al crear tour', err?.error?.error || err?.error?.message || 'Error al crear el tour');
      },
      complete: () => this.isSubmitting.set(false),
    });
  }

  hasUnsavedChanges(): boolean {
    return this.form?.dirty && !this.isSubmitting();
  }

  // ── Coordenadas ──────────────────────────────────────────────────────────────

  parseCoordenadas(val: string): { lat: number; lng: number } | null {
    const parts = String(val || '').trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 2) return null;
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  }

  private coordenadasValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const val = String(control.value || '').trim();
      if (!val) return null;
      const parsed = this.parseCoordenadas(val);
      if (!parsed) return { coordenadasInvalidas: true };
      if (parsed.lat < -90 || parsed.lat > 90) return { latitudInvalida: true };
      if (parsed.lng < -180 || parsed.lng > 180) return { longitudInvalida: true };
      return null;
    };
  }
}
