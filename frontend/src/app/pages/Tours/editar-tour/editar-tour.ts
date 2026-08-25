import { Component, OnInit, inject } from '@angular/core';
import { DatepickerComponent } from '../../../shared/datepicker/datepicker';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormsModule,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { ChangeDetectorRef, signal } from '@angular/core';
import { Tours, Tour, CanalComision } from '../../../services/Tours/tours';
import { Reservas } from '../../../services/Reservas/reservas';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { tourAvailabilityValidator, tourPlanValidityValidator } from '../tour-form.validators';

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

type CanalComisionVM = {
  Id_Canal: number;
  Nombre_Canal: string;
  activo: boolean;
  valor: number;
};

type PlanPayload = {
  Id_Plan?: number | null;
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
  Comisiones: ComisionPayload[];
  Cupo_Base: number;
  Nombre_Primera_Parada: string | null;
  Latitud_Primera_Parada: number | null;
  Longitud_Primera_Parada: number | null;
  Planes: PlanPayload[];
  Disponibilidad: DisponibilidadPayload;
};

@Component({
  selector: 'app-editar-tour',
  templateUrl: './editar-tour.html',
  styleUrls: ['../tour-shared.css'],
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, DatepickerComponent, LoadingStateComponent],
})
export class EditarTourComponent implements OnInit {
  private alerts = inject(SirAlertService);
  isLoading = signal<boolean>(true);
  loadError = signal('');
  isSubmitting = signal(false);
  readonly wizardSteps = [
    { id: 'info', label: 'Información' },
    { id: 'pricing', label: 'Planes y tarifas' },
    { id: 'availability', label: 'Calendario' },
    { id: 'settings', label: 'Configuración' },
    { id: 'review', label: 'Revisar' },
  ];
  currentStep = 0;
  maxReachedStep = this.wizardSteps.length - 1;
  expandedPlanIndex = 0;
  expandedSeasonIndex: number | null = null;
  goingBack = false;
  panelAnimating = false;
  private toursLoaded = false;
  private currenciesLoaded = false;
  private canalesLoaded = false;
  private tourLoaded = false;
  private isHydratingTour = false;
  private readonly dayKeys: DiaSemana[] = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

  tourId = 0;

  monedas: MonedaVM[] = [];
  toursExistentes: any[] = [];
  canalesComisiones: CanalComisionVM[] = [];

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
    };
  }

  constructor(
    private fb: FormBuilder,
    private tours: Tours,
    private reservas: Reservas,
    private router: Router,
    private route: ActivatedRoute,
    private cd: ChangeDetectorRef,
    private permisosService: PermisosService
  ) {
    this.form = this.fb.group({
      Nombre_Tour: ['', [Validators.required, Validators.maxLength(255)]],
      Abreviacion: ['', [Validators.required, Validators.maxLength(50)]],
      Cupo_Base: [null, [Validators.required, Validators.min(0)]],
      Nombre_Primera_Parada: ['', [Validators.maxLength(255)]],
      Coordenadas: ['', [this.coordenadasValidator()]],

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
    }, { validators: [tourAvailabilityValidator()] });
  }

  get canUpdateTour(): boolean {
    return this.permisosService.tienePermiso('TOURS.ACTUALIZAR');
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

  getSelectedPlanGroup(): FormGroup {
    return this.plans.at(this.expandedPlanIndex) as FormGroup;
  }

  getCurrencyPriceControl(planIndex: number, currencyIndex: number, type: TipoPasajero): FormControl {
    return this.getPlanCurrencies(planIndex).at(currencyIndex).get(type) as FormControl;
  }

  selectPriceValue(event: FocusEvent): void {
    (event.target as HTMLInputElement | null)?.select();
  }

  ngOnInit(): void {
    this.route.params.subscribe((params) => {
      this.tourId = Number(params['id']) || 0;

      if (!this.tourId) {
        this.navbar.errorToast('Error', 'ID de tour inválido');
        this.router.navigate(['/Tours/VerTours']);
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

  retryInitialLoad(): void {
    window.location.reload();
  }

  /* =========================================================
   * CARGA INICIAL
   * ========================================================= */
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
        this.loadError.set('No pudimos cargar las monedas. Reintenta para proteger las tarifas existentes.');
        this.markInitialLoadStep('currencies');
        this.markInitialLoadStep('canales');
        this.markInitialLoadStep('tour');
      },
      complete: () => this.markInitialLoadStep('currencies'),
    });
  }

  private loadCanales(comisionesExistentes: Array<{ Id_Canal: number; Valor: number }> = []): void {
    this.tours.getCanalesComision().subscribe({
      next: (canales) => {
        this.canalesComisiones = canales.map((c) => {
          const existing = comisionesExistentes.find((e) => e.Id_Canal === c.Id_Canal);
          return {
            Id_Canal: c.Id_Canal,
            Nombre_Canal: c.Nombre_Canal,
            activo: !!existing,
            valor: existing ? existing.Valor : 0,
          };
        });
        try { this.cd.detectChanges(); } catch {}
        this.markInitialLoadStep('canales');
      },
      error: () => {
        this.canalesComisiones = [];
        this.loadError.set('No pudimos cargar las comisiones. No se habilitará el guardado para evitar perder información.');
        try { this.cd.detectChanges(); } catch {}
        this.markInitialLoadStep('canales');
      },
    });
  }

  toggleCanal(idx: number): void {
    const canal = this.canalesComisiones[idx];
    canal.activo = !canal.activo;
    try { this.cd.detectChanges(); } catch {}
  }

  private markInitialLoadStep(step: 'tours' | 'currencies' | 'canales' | 'tour'): void {
    if (step === 'tours') this.toursLoaded = true;
    if (step === 'currencies') this.currenciesLoaded = true;
    if (step === 'canales') this.canalesLoaded = true;
    if (step === 'tour') this.tourLoaded = true;

    if (this.toursLoaded && this.currenciesLoaded && this.canalesLoaded && this.tourLoaded) {
      this.isLoading.set(false);
    }
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
  private createPlanGroup(planName: string, isBase: boolean, idPlan: number | null = null, fechaInicio: string | null = null, fechaFin: string | null = null): FormGroup {
    const currenciesFA = this.fb.array((this.monedas || []).map((m) => this.createCurrencyGroup(m)));
    const esPermanente = !fechaInicio && !fechaFin;

    return this.fb.group({
      Id_Plan: [idPlan],
      Nombre_Plan: [planName, [Validators.required, Validators.maxLength(255)]],
      esPermanente: [esPermanente],
      Fecha_Inicio: [fechaInicio],
      Fecha_Fin: [fechaFin],
      AllowNino: [true],
      AllowInfante: [true],
      monedas: currenciesFA,
    }, { validators: [tourPlanValidityValidator()] });
  }

  goToStep(step: number): void {
    if (step < 0 || step >= this.wizardSteps.length || step > this.maxReachedStep) return;
    if (step === this.currentStep) return;
    this.goingBack = step < this.currentStep;
    this.currentStep = step;
    this.animatePanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  nextStep(): void {
    if (!this.validateStep(this.currentStep) || this.currentStep >= this.wizardSteps.length - 1) return;
    this.goingBack = false;
    this.currentStep += 1;
    this.maxReachedStep = Math.max(this.maxReachedStep, this.currentStep);
    this.animatePanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  canAdvanceFromStep(step: number): boolean {
    if (step === 0) {
      return ['Nombre_Tour', 'Abreviacion', 'Cupo_Base']
        .every((name) => this.form.get(name)?.valid);
    }
    if (step === 1) return this.plans.valid && this.isPricingValid();
    if (step === 2) {
      return this.temporadasFA.valid && !this.form.errors?.['diasBaseVacios'];
    }
    if (step === 3) return !!this.form.get('Coordenadas')?.valid;
    return true;
  }

  prevStep(): void {
    if (this.currentStep === 0) return;
    this.goingBack = true;
    this.currentStep -= 1;
    this.animatePanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  stepHasError(step: number): boolean {
    if (step === 0) {
      return ['Nombre_Tour', 'Abreviacion', 'Cupo_Base']
        .some((name) => !!(this.form.get(name)?.touched && this.form.get(name)?.invalid));
    }
    if (step === 1) return this.plans.touched && this.plans.invalid;
    if (step === 2) {
      return (this.temporadasFA.touched && this.temporadasFA.invalid)
        || (this.form.touched && !!this.form.errors?.['diasBaseVacios']);
    }
    if (step === 3) {
      return !!(this.form.get('Coordenadas')?.touched && this.form.get('Coordenadas')?.invalid);
    }
    return false;
  }

  private validateStep(step: number): boolean {
    if (step === 0) {
      const controls = ['Nombre_Tour', 'Abreviacion', 'Cupo_Base'];
      controls.forEach((name) => this.form.get(name)?.markAsTouched());
      return controls.every((name) => this.form.get(name)?.valid);
    }
    if (step === 1) {
      this.plans.markAllAsTouched();
      this.touchAllPricingControls();
      return this.plans.valid && this.isPricingValid();
    }
    if (step === 2) {
      this.temporadasFA.markAllAsTouched();
      this.form.markAsTouched();
      this.form.updateValueAndValidity({ emitEvent: false });
      return this.temporadasFA.valid && !this.form.errors?.['diasBaseVacios'];
    }
    if (step === 3) {
      this.form.get('Coordenadas')?.markAsTouched();
      return !!this.form.get('Coordenadas')?.valid;
    }
    return true;
  }

  private animatePanel(): void {
    this.panelAnimating = false;
    this.cd.markForCheck();
    requestAnimationFrame(() => {
      this.panelAnimating = true;
      this.cd.markForCheck();
      setTimeout(() => {
        this.panelAnimating = false;
        this.goingBack = false;
        this.cd.markForCheck();
      }, 380);
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
    this.expandedPlanIndex = idx;
    this.form.markAsDirty();

    this.applyPassengerRules(idx, 'NINO');
    this.applyPassengerRules(idx, 'INFANTE');
    this.applyAdultRulesAcrossPlans();
  }

  deletePlan(index: number): void {
    if (index === 0) return;
    const plan = this.plans.at(index) as FormGroup;
    const name = String(plan.get('Nombre_Plan')?.value || 'este plan');
    const remove = () => {
      this.plans.removeAt(index);
      this.expandedPlanIndex = Math.min(this.expandedPlanIndex, this.plans.length - 1);
      this.form.markAsDirty();
      this.applyAdultRulesAcrossPlans();
    };

    if (!plan.get('Id_Plan')?.value) {
      remove();
      return;
    }

    this.alerts.confirm(
      '¿Retirar plan?',
      `Se retirará “${name}” al guardar. Si tiene pasajeros históricos, SIR lo conservará y te explicará por qué no puede eliminarse.`,
      remove,
      undefined,
      { confirmText: 'Retirar', cancelText: 'Conservar', type: 'warning' }
    );
  }

  togglePlanEditor(index: number): void {
    this.expandedPlanIndex = index;
  }

  duplicatePlan(index: number): void {
    const source = this.plans.at(index) as FormGroup;
    if (!source) return;
    const raw = source.getRawValue();
    const copy = this.createPlanGroup(
      `Copia de ${String(raw.Nombre_Plan || 'plan')}`.slice(0, 255),
      false,
      null,
      raw.Fecha_Inicio || null,
      raw.Fecha_Fin || null
    );
    copy.patchValue({
      esPermanente: raw.esPermanente,
      AllowNino: raw.AllowNino,
      AllowInfante: raw.AllowInfante,
    }, { emitEvent: false });

    const copyCurrencies = copy.get('monedas') as FormArray;
    for (const sourceCurrency of raw.monedas || []) {
      const target = copyCurrencies.controls.find((currency) =>
        Number(currency.get('Id_Moneda')?.value) === Number(sourceCurrency.Id_Moneda)
      );
      target?.patchValue({
        ADULTO: Number(sourceCurrency.ADULTO || 0),
        NINO: Number(sourceCurrency.NINO || 0),
        INFANTE: Number(sourceCurrency.INFANTE || 0),
      }, { emitEvent: false });
    }

    this.plans.push(copy);
    const newIndex = this.plans.length - 1;
    this.applyPassengerRules(newIndex, 'NINO');
    this.applyPassengerRules(newIndex, 'INFANTE');
    this.applyAdultRulesAcrossPlans();
    this.expandedPlanIndex = newIndex;
    this.form.markAsDirty();
  }

  setPlanPermanent(planIndex: number, permanent: boolean): void {
    const plan = this.plans.at(planIndex) as FormGroup;
    plan.get('esPermanente')?.setValue(permanent);
    if (permanent) {
      plan.get('Fecha_Inicio')?.setValue(null);
      plan.get('Fecha_Fin')?.setValue(null);
    }
    plan.updateValueAndValidity();
  }

  getPlanValidityLabel(planIndex: number): string {
    const plan = this.plans.at(planIndex) as FormGroup;
    if (plan.get('esPermanente')?.value) return 'Permanente';
    const start = plan.get('Fecha_Inicio')?.value;
    const end = plan.get('Fecha_Fin')?.value;
    return start && end ? `${start} – ${end}` : 'Vigencia pendiente';
  }

  getPlanPassengerLabel(planIndex: number): string {
    const plan = this.plans.at(planIndex) as FormGroup;
    const labels = ['Adultos'];
    if (plan.get('AllowNino')?.value) labels.push('Niños');
    if (plan.get('AllowInfante')?.value) labels.push('Infantes');
    return labels.join(', ');
  }

  getPrimaryCurrencyIndex(planIndex: number): number {
    const currencies = this.getPlanCurrencies(planIndex);
    const copIndex = currencies.controls.findIndex((currency) =>
      String(currency.get('Codigo')?.value || '').toUpperCase() === 'COP'
    );
    return copIndex >= 0 ? copIndex : 0;
  }

  getPlanPrimaryPriceLabel(planIndex: number): string {
    const primaryIndex = this.getPrimaryCurrencyIndex(planIndex);
    const currency = this.getPlanCurrencies(planIndex).at(primaryIndex) as FormGroup;
    if (!currency) return 'Precio pendiente';
    const amount = Number(currency.get('ADULTO')?.value || 0);
    if (amount <= 0) return 'Precio pendiente';
    const code = String(currency.get('Codigo')?.value || 'COP').toUpperCase();
    try {
      return `Desde ${new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: code, maximumFractionDigits: 0,
      }).format(amount)}`;
    } catch {
      return `Desde ${amount.toLocaleString('es-CO')} ${code}`;
    }
  }

  shouldShowCurrencyInReview(planIndex: number, currencyIndex: number): boolean {
    if (currencyIndex === this.getPrimaryCurrencyIndex(planIndex)) return true;
    const currency = this.getPlanCurrencies(planIndex).at(currencyIndex) as FormGroup;
    return ['ADULTO', 'NINO', 'INFANTE'].some((type) => Number(currency.get(type)?.value || 0) > 0);
  }

  togglePassengerType(planIndex: number, tipo: Exclude<TipoPasajero, 'ADULTO'>): void {
    this.applyPassengerRules(planIndex, tipo);
    this.applyAdultRulesAcrossPlans();
  }

  setPassengerEnabled(
    planIndex: number,
    tipo: Exclude<TipoPasajero, 'ADULTO'>,
    enabled: boolean
  ): void {
    const plan = this.plans.at(planIndex) as FormGroup;
    const allowKey = tipo === 'NINO' ? 'AllowNino' : 'AllowInfante';
    plan.get(allowKey)?.setValue(enabled);
    this.togglePassengerType(planIndex, tipo);
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
        if (i === this.getPrimaryCurrencyIndex(planIndex)) ctrl.setValidators([Validators.required, Validators.min(1)]);
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
        const adulto = cg.get('ADULTO');
        if (!adulto) continue;

        if (i === this.getPrimaryCurrencyIndex(p)) adulto.setValidators([Validators.required, Validators.min(1)]);
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

  /* ---------------------------
   * Helpers UI (HTML)
   * --------------------------- */
  isBaseCop(planIndex: number, currencyIndex: number): boolean {
    return planIndex === 0 && this.getCurrencyCode(planIndex, currencyIndex) === 'COP';
  }

  isAdultRequired(planIndex: number, currencyIndex: number): boolean {
    return currencyIndex === this.getPrimaryCurrencyIndex(planIndex);
  }

  private getCurrencyCode(planIndex: number, currencyIndex: number): string {
    const cg = this.getPlanCurrencies(planIndex).at(currencyIndex) as FormGroup;
    return String(cg.get('Codigo')?.value || '');
  }

  getAdultErrorMessage(planIndex: number, currencyIndex: number): string {
    if (currencyIndex === this.getPrimaryCurrencyIndex(planIndex)) {
      return 'Ingresa un precio válido.';
    }
    return 'Ingresa un precio válido para Adulto.';
  }

  getChildErrorMessage(planIndex: number, currencyIndex: number): string {
    if (currencyIndex === this.getPrimaryCurrencyIndex(planIndex)) return 'Ingresa un precio válido.';
    return 'Ingresa un precio válido para Niño.';
  }

  getInfantErrorMessage(planIndex: number, currencyIndex: number): string {
    if (currencyIndex === this.getPrimaryCurrencyIndex(planIndex)) return 'Ingresa un precio válido.';
    return 'Ingresa un precio válido para Infante.';
  }

  private isPricingValid(): boolean {
    for (let p = 0; p < this.plans.length; p++) {
      const plan = this.plans.at(p) as FormGroup;
      const primary = this.getPlanCurrencies(p).at(this.getPrimaryCurrencyIndex(p)) as FormGroup;
      if (!primary || Number(primary.get('ADULTO')?.value || 0) <= 0) return false;
      if (plan.get('AllowNino')?.value && Number(primary.get('NINO')?.value || 0) <= 0) return false;
      if (plan.get('AllowInfante')?.value && Number(primary.get('INFANTE')?.value || 0) <= 0) return false;
    }
    return true;
  }

  private touchAllPricingControls(): void {
    this.plans.controls.forEach((plan) => {
      plan.get('Nombre_Plan')?.markAsTouched();
      const currencies = plan.get('monedas') as FormArray;
      currencies.controls.forEach((currency) => {
        currency.get('ADULTO')?.markAsTouched();
        currency.get('NINO')?.markAsTouched();
        currency.get('INFANTE')?.markAsTouched();
      });
    });
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
        if (!this.isHydratingTour && this.temporadasFA.length === 0) {
          this.addTemporada();
        }
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
    this.expandedSeasonIndex = this.temporadasFA.length - 1;
    this.form.markAsDirty();
    this.temporadasFA.updateValueAndValidity({ emitEvent: false });
  }

  deleteTemporada(index: number): void {
    this.temporadasFA.removeAt(index);
    if (!this.temporadasFA.length) this.expandedSeasonIndex = null;
    else if (this.expandedSeasonIndex === index) this.expandedSeasonIndex = Math.min(index, this.temporadasFA.length - 1);
    else if (this.expandedSeasonIndex !== null && this.expandedSeasonIndex > index) this.expandedSeasonIndex -= 1;
    this.form.markAsDirty();
    this.temporadasFA.updateValueAndValidity({ emitEvent: false });
  }

  toggleSeasonEditor(index: number): void {
    this.expandedSeasonIndex = this.expandedSeasonIndex === index ? null : index;
  }

  getSeasonSummary(index: number): string {
    const season = this.temporadasFA.at(index) as FormGroup;
    const start = season.get('Fecha_Inicio')?.value;
    const end = season.get('Fecha_Fin')?.value;
    const days = this.getTemporadaDiasKeys(index).length;
    const range = start && end ? `${start} – ${end}` : 'Fechas pendientes';
    return `${range} · ${days} ${days === 1 ? 'día' : 'días'}`;
  }

  getSelectedBaseDaysLabel(): string {
    const selected = this.diasSemana.filter((day) => !!this.diasBaseFG.get(day.key)?.value);
    if (selected.length === 7) return 'Todos los días';
    if (!selected.length) return 'Sin días seleccionados';
    return selected.map((day) => day.label.slice(0, 3)).join(', ');
  }

  getActiveCommissionsCount(): number {
    return this.canalesComisiones.filter((canal) => canal.activo && Number(canal.valor) > 0).length;
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
    if (this.isHydratingTour) return;

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
    this.tours.getTourById(this.tourId).subscribe({
      next: (tour: any) => {
        this.isHydratingTour = true;
        try {
          // básicos
          this.form.patchValue(
            {
              Nombre_Tour: tour.Nombre_Tour,
              Abreviacion: tour.Abreviacion,
              Cupo_Base: tour.Cupo_Base,
              Nombre_Primera_Parada: tour.Nombre_Primera_Parada || '',
              Coordenadas: this.formatCoordenadas(tour.Latitud_Primera_Parada, tour.Longitud_Primera_Parada),
            },
            { emitEvent: false }
          );

          const comisionesRaw: Array<{ Id_Canal: number; Valor: number }> =
            Array.isArray(tour.Comisiones) ? tour.Comisiones :
            Array.isArray(tour.comisiones) ? tour.comisiones :
            [];
          this.loadCanales(comisionesRaw);

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
            this.expandedSeasonIndex = this.temporadasFA.length ? 0 : null;
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
                (p.Id_Plan != null ? Number(p.Id_Plan) : null),
                p.Fecha_Inicio || null,
                p.Fecha_Fin || null
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

            this.markInitialLoadStep('tour');
            this.adjustControlsAfterPopulate();
            const loadedMode = this.form.get('Modo_Disponibilidad')?.value;
            if (loadedMode) this.form.get('Modo_Disponibilidad')?.setValue(loadedMode);
            try { this.cd.detectChanges(); } catch {}
            this.isHydratingTour = false;
            return;
          }

          // si no hay planes, deja base vacío
          this.markInitialLoadStep('tour');
          this.isHydratingTour = false;
        } catch (e) {
          console.error('Error mapping tour:', e);
          this.markInitialLoadStep('tour');
          this.isHydratingTour = false;
        }
      },
      error: (err) => {
        this.isHydratingTour = false;
        this.markInitialLoadStep('tour');
        this.markInitialLoadStep('canales');
        this.loadError.set(err?.error?.message || err?.error?.error || 'No pudimos cargar la información del tour.');
      },
    });
  }

  /* =========================================================
   * PAYLOAD UPDATE
   * ========================================================= */
  private buildUpdateTourPayload(): EditarTourFullPayload {
    const raw = this.form.getRawValue();
    const coords = this.parseCoordenadas(raw.Coordenadas || '');

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
        Id_Plan: p.Id_Plan != null ? Number(p.Id_Plan) : null,
        Nombre_Plan: String(p.Nombre_Plan || '').trim(),
        Fecha_Inicio: (p.esPermanente !== false) ? null : (p.Fecha_Inicio || null),
        Fecha_Fin: (p.esPermanente !== false) ? null : (p.Fecha_Fin || null),
        AllowNino: allowNino,
        AllowInfante: allowInf,
        Monedas: monedas,
      };
    });

    const comisiones: ComisionPayload[] = this.canalesComisiones
      .filter((c) => c.activo && c.valor > 0)
      .map((c) => ({ Id_Canal: c.Id_Canal, Valor: c.valor }));

    const disponibilidad = this.buildDisponibilidadPayload();

    return {
      Nombre_Tour: String(raw.Nombre_Tour || '').trim(),
      Abreviacion: String(raw.Abreviacion || '').trim(),
      Comisiones: comisiones,
      Cupo_Base: Number(raw.Cupo_Base || 0),
      Nombre_Primera_Parada: String(raw.Nombre_Primera_Parada || '').trim() || null,
      Latitud_Primera_Parada: coords?.lat ?? null,
      Longitud_Primera_Parada: coords?.lng ?? null,
      Planes: planes,
      Disponibilidad: disponibilidad,
    };
  }

  getTemporadaDiasKeys(tempIndex: number): DiaSemana[] {
    const t = this.temporadasFA.at(tempIndex) as FormGroup;
    const dias = t.get('dias') as FormGroup;
    return Object.keys(dias.controls).filter((k) => !!dias.get(k)?.value) as DiaSemana[];
  }

  /* =========================================================
   * SUBMIT
   * ========================================================= */
  async onSubmitEditarTour(): Promise<void> {
    if (this.isSubmitting()) return;

    this.form.updateValueAndValidity({ emitEvent: false });

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.goToFirstInvalidStep();

      const invalid = Object.keys(this.form.controls).filter((k) => this.form.get(k)?.invalid);

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
      } catch (_err) {
        // noop
      }

      if (pricingInvalid && invalid.indexOf('planes') === -1) invalid.push('planes');

      const friendly: Record<string, string> = {
        Nombre_Tour: 'Nombre del Tour',
        Abreviacion: 'Abreviacion',
        Cupo_Base: 'Cupo Base',
        Nombre_Primera_Parada: 'Primera parada',
        Coordenadas: 'Geolocalización',
        Modo_Disponibilidad: 'Modo de disponibilidad',
        planes: 'Planes y precios',
        temporadas: 'Temporadas'
      };

      const fields = invalid.map((f) => friendly[f] || f);
      const msg = fields.length
        ? `Revisa los siguientes campos: ${fields.join(', ')}`
        : 'Hay campos invalidos en el formulario.';

      this.navbar.alert?.set?.({
        type: 'error',
        title: 'Campos requeridos incompletos',
        message: msg,
        autoClose: true,
        buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.alert?.set?.(null) }],
      });
      return;
    }

    this.touchAllPricingControls();
    if (!this.isPricingValid()) {
      this.maxReachedStep = Math.max(this.maxReachedStep, 1);
      this.currentStep = 1;
      this.animatePanel();
      this.navbar.alert?.set?.({
        type: 'error',
        title: 'Faltan precios',
        message: 'Cada plan necesita precio de Adulto en COP. Si Niño o Infante están habilitados, también necesitan su tarifa principal en COP.',
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) }],
      });
      return;
    }

    const confirmed = await this.requestUpdateTourConfirmation();
    if (!confirmed) return;

    this.editarTourConfirmado();
  }

  private goToFirstInvalidStep(): void {
    let target = 0;
    if (['Nombre_Tour', 'Abreviacion', 'Cupo_Base'].every((name) => this.form.get(name)?.valid)) {
      target = this.plans.valid && this.isPricingValid()
        ? (this.temporadasFA.valid && !this.form.errors?.['diasBaseVacios']
          ? (this.form.get('Coordenadas')?.valid ? 4 : 3)
          : 2)
        : 1;
    }
    this.maxReachedStep = Math.max(this.maxReachedStep, target);
    this.goingBack = target < this.currentStep;
    this.currentStep = target;
    this.animatePanel();
  }

  private buildUpdateTourConfirmationMessage(): string {
    const nombreTour = String(this.form.get('Nombre_Tour')?.value || '').trim();
    const abreviacion = String(this.form.get('Abreviacion')?.value || '').trim();
    const cupoBase = Number(this.form.get('Cupo_Base')?.value || 0);
    const cantidadPlanes = this.plans.length;
    const modoDisponibilidad = this.form.get('Modo_Disponibilidad')?.value === 'SOLO_TEMPORADAS'
      ? 'Por temporadas'
      : 'Todo el año';
    const partes = [
      `Vas a guardar los cambios del tour ${nombreTour || '—'}.`,
      `Abreviación: ${abreviacion || '—'}.`,
      `Cupo base: ${cupoBase}.`,
      `Planes: ${cantidadPlanes}.`,
      `Disponibilidad: ${modoDisponibilidad}.`,
    ];

    partes.push('¿Deseas continuar?');
    return partes.join('\n');
  }

  private requestUpdateTourConfirmation(): Promise<boolean> {
    return new Promise((resolve) => {
      this.navbar.alert?.set?.({
        type: 'info',
        title: '¿Todo listo?',
        message: this.buildUpdateTourConfirmationMessage(),
        autoClose: false,
        buttons: [
          {
            text: 'Cancelar',
            style: 'secondary',
            onClick: () => {
              this.navbar.alert?.set?.(null);
              resolve(false);
            }
          },
          {
            text: 'Guardar',
            style: 'primary',
            onClick: () => {
              this.navbar.alert?.set?.(null);
              resolve(true);
            }
          }
        ]
      });
    });
  }

  private editarTourConfirmado(): void {
    if (this.isSubmitting() || this.form.invalid) return;

    this.isSubmitting.set(true);

    const payload = this.buildUpdateTourPayload();

    this.tours.updateTour(this.tourId, payload as any).subscribe({
      next: () => {
        this.navbar.successToast('Tour actualizado', 'El tour ha sido actualizado exitosamente.');
        this.form.markAsPristine();
        this.router.navigate(['/Tours/VerTours']);
      },
      error: (err) => {
        console.error('Error al actualizar tour:', err);
        this.isSubmitting.set(false);
        this.navbar.errorToast('Error al actualizar tour', err?.error?.error || err?.error?.message || 'Error al actualizar el tour');
      },
      complete: () => this.isSubmitting.set(false),
    });
  }

  hasUnsavedChanges(): boolean {
    return this.form?.dirty && !this.isSubmitting();
  }

  parseCoordenadas(val: string): { lat: number; lng: number } | null {
    const parts = String(val || '').trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 2) return null;
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  }

  private formatCoordenadas(lat: unknown, lng: unknown): string {
    if (lat == null || lng == null || lat === '' || lng === '') return '';
    return `${lat}, ${lng}`;
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
