import { Component, OnInit, OnDestroy, signal, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators, FormArray } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AlertButton, SirAlertService } from '../../../services/Alertas/alert.service';
import { TransferService } from '../../../services/Transfers/transfers';
import { DatepickerComponent } from '../../../shared/datepicker/datepicker';
import { UppercaseInputDirective } from '../../../shared/directives/uppercase-input.directive';
import { UiStateService } from '../../../services/ui-state.service';

type CrearTransferLoadResult = {
  servicios: any[];
  rangos: any[];
  monedas: any[];
  transfer?: any | null;
};

interface WizardStep {
  id: string;
  label: string;
}
@Component({
  selector: 'app-crear-transfer',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, UppercaseInputDirective, DatepickerComponent],
  templateUrl: './crear-transfer.html',
  styleUrls: ['./crear-transfer.css']
})
export class CrearTransferComponent implements OnInit, OnDestroy {
  private alerts = inject(SirAlertService);
  private uiState = inject(UiStateService);
  form!: FormGroup;
  private readonly e164WithTenDigitsPattern = /^\+[1-9]\d{10,12}$/;

  readonly wizardSteps: WizardStep[] = [
    { id: 'servicio', label: 'Servicio' },
    { id: 'responsable', label: 'Responsable' },
    { id: 'pago', label: 'Pago' },
    { id: 'resumen', label: 'Resumen' }
  ];

  currentStep = 0;
  goingBack = false;
  maxReachedStep = 0;
  panelAnimating = false;

  private toUpperText(value: unknown): string {
    return String(value ?? '').trim().toLocaleUpperCase('es-CO');
  }

  private getTodayYmd(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  readonly todayYmd = this.getTodayYmd();

  private normalizeYmd(value: unknown): string | null {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    const parts = raw.split('-');
    if (parts.length !== 3) return null;

    const [yearPart, monthPart, dayPart] = parts;
    if (!/^\d{4}$/.test(yearPart) || !/^\d{1,2}$/.test(monthPart) || !/^\d{1,2}$/.test(dayPart)) {
      return null;
    }

    const year = Number(yearPart);
    const month = Number(monthPart);
    const day = Number(dayPart);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const parsed = new Date(year, month - 1, day);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return null;
    }

    return `${yearPart}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private fechaNoPasadaValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const normalized = this.normalizeYmd(control.value);
      if (!normalized) return control.value ? { fechaInvalida: true } : null;
      return normalized < this.getTodayYmd() ? { fechaPasada: true } : null;
    };
  }

  private validateFechaTransferBeforeSubmit(): boolean {
    const fechaCtrl = this.form?.get('Fecha');
    if (!fechaCtrl) return true;

    const normalized = this.normalizeYmd(fechaCtrl.value);
    if (!normalized) return true;

    if (normalized < this.getTodayYmd()) {
      const currentErrors = fechaCtrl.errors ?? {};
      fechaCtrl.setErrors({ ...currentErrors, fechaPasada: true });
      fechaCtrl.markAsTouched();
      this.navbar.errorToast('Fecha inválida', 'La fecha del servicio no puede ser anterior a hoy.');
      return false;
    }

    return true;
  }

  private triggerPanelAnimation(back: boolean): void {
    this.goingBack = back;
    this.panelAnimating = false;
    this.cdr.markForCheck();
    requestAnimationFrame(() => {
      this.panelAnimating = true;
      this.cdr.markForCheck();
      setTimeout(() => {
        this.panelAnimating = false;
        this.goingBack = false;
        this.cdr.markForCheck();
      }, 380);
    });
  }

  canNavigateToStep(index: number): boolean {
    return index <= this.maxReachedStep || index <= this.currentStep;
  }

  goToStep(index: number): void {
    if (!this.canNavigateToStep(index) || index === this.currentStep) return;
    const back = index < this.currentStep;
    this.currentStep = index;
    this.triggerPanelAnimation(back);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  nextStep(): void {
    if (!this.canAdvanceFromStep(this.currentStep)) {
      this.markCurrentStepTouched();
      return;
    }

    if (this.currentStep < this.wizardSteps.length - 1) {
      this.currentStep++;
      this.maxReachedStep = Math.max(this.maxReachedStep, this.currentStep);
      this.triggerPanelAnimation(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  prevStep(): void {
    if (this.currentStep <= 0) return;
    this.currentStep--;
    this.triggerPanelAnimation(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  canAdvanceFromStep(step: number): boolean {
    switch (step) {
      case 0:
        return this.isServicioStepValid();
      case 1:
        return this.isResponsableStepValid();
      case 2:
        return this.isPagoStepValid();
      case 3:
        return true;
      default:
        return true;
    }
  }

  private isServicioStepValid(): boolean {
    const controls = ['Titular', 'Cantidad_Personas', 'TipoServicio', 'Salida', 'Llegada', 'Fecha'];
    if (controls.some((name) => this.form?.get(name)?.invalid)) return false;
    if (this.showFlightFields && (this.form.get('Vuelo')?.invalid || this.form.get('TipoVuelo')?.invalid)) return false;

    const cantidad = this.normalizarCantidadPersonas(this.form.get('Cantidad_Personas')?.value);
    if (cantidad !== null && !this.selectedRango) return false;

    return true;
  }

  private isResponsableStepValid(): boolean {
    return !!(
      this.form?.get('Reporta')?.valid &&
      this.form?.get('TelefonoReserva')?.valid
    );
  }

  private isPagoStepValid(): boolean {
    if (!this.abonosValidos) return false;

    const tipoPago = this.form?.get('TipoPago')?.value;
    if (tipoPago === 'Completo') return !!this.form?.get('ComprobantePago')?.valid;
    if (tipoPago === 'Abonos') return this.abonos.controls.every((control) => control.valid);
    return true;
  }

  private markCurrentStepTouched(): void {
    switch (this.currentStep) {
      case 0: {
        ['Titular', 'Cantidad_Personas', 'TipoServicio', 'Salida', 'Llegada', 'Fecha', 'Vuelo', 'TipoVuelo']
          .forEach((name) => this.form.get(name)?.markAsTouched());

        const cantidad = this.normalizarCantidadPersonas(this.form.get('Cantidad_Personas')?.value);
        const message = cantidad !== null && !this.selectedRango
          ? 'No existe un rango configurado para la cantidad de personas indicada.'
          : 'Completa los datos obligatorios del servicio antes de continuar.';

        this.navbar.showAlert({
          type: 'warning',
          title: 'Paso incompleto',
          message,
          autoClose: true,
          buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.clearOverlay() }]
        });
        break;
      }
      case 1:
        this.form.get('Reporta')?.markAsTouched();
        this.form.get('TelefonoReserva')?.markAsTouched();
        this.navbar.showAlert({
          type: 'warning',
          title: 'Paso incompleto',
          message: 'Completa los datos del responsable antes de continuar.',
          autoClose: true,
          buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.clearOverlay() }]
        });
        break;
      case 2:
        this.form.get('ComprobantePago')?.markAsTouched();
        this.abonos.controls.forEach((control) => control.markAllAsTouched());
        this.markPaymentFilesTouched();
        this.navbar.showAlert({
          type: 'warning',
          title: 'Pago incompleto',
          message: !this.abonosValidos
            ? 'Los abonos no pueden superar el valor del transfer.'
            : 'Revisa la información de pago y los comprobantes antes de continuar.',
          autoClose: true,
          buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.clearOverlay() }]
        });
        break;
    }
  }

  stepHasError(step: number): boolean {
    if (step > this.currentStep) return false;

    switch (step) {
      case 0: {
        const requiredTouchedInvalid = ['Titular', 'Cantidad_Personas', 'TipoServicio', 'Salida', 'Llegada', 'Fecha']
          .some((name) => {
            const control = this.form?.get(name);
            return !!(control?.touched && control.invalid);
          });
        const flightInvalid = this.showFlightFields && ['Vuelo', 'TipoVuelo'].some((name) => {
          const control = this.form?.get(name);
          return !!(control?.touched && control.invalid);
        });
        const cantidad = this.normalizarCantidadPersonas(this.form?.get('Cantidad_Personas')?.value);
        return requiredTouchedInvalid || !!flightInvalid || (cantidad !== null && !this.selectedRango);
      }
      case 1:
        return ['Reporta', 'TelefonoReserva'].some((name) => {
          const control = this.form?.get(name);
          return !!(control?.touched && control.invalid);
        });
      case 2:
        return !this.abonosValidos || (this.form?.get('TipoPago')?.value === 'Completo' && !!(this.form.get('ComprobantePago')?.touched && this.form.get('ComprobantePago')?.invalid));
      default:
        return false;
    }
  }

  openSummary = false;
  isLoading = signal<boolean>(true);
  isSubmitting = signal<boolean>(false);

  resultsServicioTransfer: any[] = [];
  resultsRangos: any[] = [];
  resultsMonedas: any[] = [];
  selectedRango: any | null = null;
  selectedRangoDescripcion: string | null = null;
  precioSeleccionado: number | null = null;
  valorEsEditable = false;
  private rangoLookupSeq = 0;
  showFlightFields = false;

  // Archivos de comprobantes
  pagoPagadoFile: File | null = null;
  pagoPagadoFileName: string | null = null;
  abonoFiles: Map<number, File> = new Map();
  abonoFileNames: Map<number, string> = new Map();

  private get navbar() {
    const mapButtons = (buttons: Array<{ text: string; style: string; onClick: () => void }>): AlertButton[] =>
      buttons.map((button) => ({
        text: button.text,
        style: button.style === 'secondary' ? 'secondary' : button.style === 'delete' ? 'danger' : 'primary',
        onClick: button.onClick,
      }));

    return {
      showAlert: (alert: Parameters<SirAlertService['showAlert']>[0]) => this.alerts.showAlert({
        ...alert,
        buttons: alert.buttons ? mapButtons(alert.buttons as any[]) : alert.buttons,
      }),
      showConfirm: (title: string, message: string, buttons: Array<{ text: string; style: string; onClick: () => void }>) =>
        this.alerts.showConfirm(title, message, mapButtons(buttons)),
      successToast: (title: string, message = '') => this.alerts.successToast(title, message),
      errorToast: (title: string, message = '') => this.alerts.errorToast(title, message),
      warningToast: (title: string, message = '') => this.alerts.warningToast(title, message),
      clearOverlay: () => this.alerts.closeModal(),
      cuposInfo: this.uiState.cuposInfo,
    };
  }

  constructor(
    private fb: FormBuilder,
    private transferSvc: TransferService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private destroyRef: DestroyRef
  ) { }

  private notSeleccionarValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = String(control.value ?? '').trim().toLowerCase();
      return value === '' || value === 'seleccionar' ? { seleccionarInvalido: true } : null;
    };
  }

  private cantidadPersonasValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const raw = control.value;
      if (raw === null || raw === undefined || raw === '') return { required: true };
      const cantidad = Number(raw);
      if (!Number.isInteger(cantidad) || cantidad < 1) return { cantidadInvalida: true };
      return null;
    };
  }

  private normalizarCantidadPersonas(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const cantidad = Number(value);
    return Number.isInteger(cantidad) && cantidad > 0 ? cantidad : null;
  }

  private getMonedaSeleccionada(): any | null {
    const monedaCodigo = String(this.form?.get('Moneda')?.value || '').trim();
    if (!monedaCodigo) return null;
    return this.resultsMonedas.find((m: any) => String(m.Codigo || '').trim() === monedaCodigo) || null;
  }

  private obtenerRangoDetectado(cantidad: number | null): any | null {
    if (cantidad === null) return null;
    return this.resultsRangos.find((r) => {
      const minimo = Number(r?.Minimo ?? NaN);
      const maximoRaw = r?.Maximo;
      const maximo = maximoRaw === null || maximoRaw === undefined || maximoRaw === '' ? null : Number(maximoRaw);
      return Number.isFinite(minimo)
        && cantidad >= minimo
        && (maximo === null || cantidad <= maximo);
    }) ?? null;
  }

  private actualizarRangoDetectado(opts: { preservarValor?: boolean; notificarSinPrecio?: boolean } = {}): void {
    if (!this.form) return;

    const cantidad = this.normalizarCantidadPersonas(this.form.get('Cantidad_Personas')?.value);
    const rangoCtrl = this.form.get('Rango');
    const valorCtrl = this.form.get('Valor');
    const rango = this.obtenerRangoDetectado(cantidad);

    this.selectedRango = rango;
    this.selectedRangoDescripcion = rango?.Descripcion || null;

    if (!cantidad || !rango) {
      rangoCtrl?.setValue(null, { emitEvent: false });
      this.precioSeleccionado = null;
      this.valorEsEditable = true;
      if (!opts.preservarValor) {
        valorCtrl?.setValue(0, { emitEvent: false });
      }
      this.cdr.markForCheck();
      return;
    }

    rangoCtrl?.setValue(rango.Id_Rango ?? rango.id, { emitEvent: false });
    const moneda = this.getMonedaSeleccionada();
    const lookupSeq = ++this.rangoLookupSeq;

    this.transferSvc.getPrecioBasePorRangoYMoneda(String(rango.Id_Rango ?? rango.id), String(moneda?.Id_Moneda ?? ''))
      .pipe(
        catchError(() => of({ found: false, precio: 0 })),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          if (lookupSeq !== this.rangoLookupSeq) return;

          const precio = Number(result?.precio ?? 0);
          const precioValido = Boolean(result?.found) && Number.isFinite(precio);

          this.precioSeleccionado = precioValido ? precio : null;
          this.valorEsEditable = true;

          if (precioValido) {
            valorCtrl?.setValue(precio, { emitEvent: false });
          } else {
            valorCtrl?.setValue(0, { emitEvent: false });
          }

          this.cdr.markForCheck();
        },
        error: () => {
          if (lookupSeq !== this.rangoLookupSeq) return;
          this.precioSeleccionado = null;
          this.valorEsEditable = true;
          this.cdr.markForCheck();
        }
      });
  }

  private syncValorManualState(): void {
  }

  toggleSummary(force?: boolean) {
    this.openSummary = typeof force === 'boolean' ? force : !this.openSummary;
  }

  private closeSummaryIfOpen(): void {
    if (this.openSummary) {
      this.openSummary = false;
    }
  }

  public getNombreServicio(): string {
    const id = this.form?.get('TipoServicio')?.value;
    const servicio = this.resultsServicioTransfer.find(s => String(s.Id_Servicio ?? s.id) === String(id));
    return servicio ? servicio.Servicio : '—';
  }

  getResumenRuta(): string {
    const salida = String(this.form?.get('Salida')?.value || '').trim() || '—';
    const llegada = String(this.form?.get('Llegada')?.value || '').trim() || '—';
    return `${salida} → ${llegada}`;
  }

  getResumenTipoPago(): string {
    switch (this.form?.get('TipoPago')?.value) {
      case 'Completo': return 'Ya pagó';
      case 'Abonos': return `Abonos (${this.abonos.length})`;
      default: return 'Paga en el punto';
    }
  }

  get abonos(): FormArray {
    return this.form.get('Abonos') as FormArray;
  }

  private crearAbonoGroup(): FormGroup {
    const group = this.fb.group({
      Monto: ['', [Validators.required, Validators.min(0.01)]],
      Observaciones: [''],
      Fecha_Pago: [''],
      Comprobante: [null]
    });

    group.get('Monto')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncPaymentFileValidators());

    return group;
  }

  addAbono(): void {
    this.abonos.push(this.crearAbonoGroup());
    this.syncPaymentFileValidators();
  }

  removeAbono(index: number): void {
    this.abonos.removeAt(index);
    this.syncPaymentFileValidators();
  }

  getTotalAbonado(): number {
    if (this.form.get('TipoPago')?.value !== 'Abonos') return 0;
    return this.abonos.controls.reduce((sum, control) => {
      const monto = Number(control.get('Monto')?.value || 0);
      return sum + monto;
    }, 0);
  }

  getPendiente(): number {
    const valor = Number(this.form.get('Valor')?.value || 0);
    const tipoPago = this.form.get('TipoPago')?.value;

    if (tipoPago === 'Completo') return 0;
    if (tipoPago === 'Abonos') {
      return Math.max(0, valor - this.getTotalAbonado());
    }
    return valor;
  }

  getAbonosIndices(): number[] {
    return Array.from({ length: this.abonos.length }, (_, i) => i);
  }

  get abonosValidos(): boolean {
    return this.getTotalAbonado() <= Number(this.form.get('Valor')?.value || 0);
  }

  recalcularTotales(): void {
    this.form.get('Valor')?.updateValueAndValidity({ emitEvent: false });
  }

  private syncPaymentFileValidators(): void {
    if (!this.form) return;

    const tipoPago = this.form.get('TipoPago')?.value;
    const comprobantePagoCtrl = this.form.get('ComprobantePago');

    if (tipoPago === 'Completo') {
      comprobantePagoCtrl?.setValidators([Validators.required]);
    } else {
      comprobantePagoCtrl?.clearValidators();
    }
    comprobantePagoCtrl?.updateValueAndValidity({ emitEvent: false });

    this.abonos.controls.forEach((control) => {
      const group = control as FormGroup;
      const monto = Number(group.get('Monto')?.value || 0);
      const comprobanteCtrl = group.get('Comprobante');
      if (!comprobanteCtrl) return;

      if (tipoPago === 'Abonos' && monto > 0) {
        comprobanteCtrl.setValidators([Validators.required]);
      } else {
        comprobanteCtrl.clearValidators();
      }
      comprobanteCtrl.updateValueAndValidity({ emitEvent: false });
    });
  }

  private markPaymentFilesTouched(): void {
    this.form.get('ComprobantePago')?.markAsTouched();
    this.abonos.controls.forEach((control) => {
      control.get('Comprobante')?.markAsTouched();
    });
  }

  private buildTransferPayload(): any {
    const tipoPago = this.form.value.TipoPago;
    const abonosPayload = tipoPago === 'Abonos'
      ? this.abonos.controls.map((control) => ({
          Monto: Number(control.get('Monto')?.value || 0),
          Observaciones: this.toUpperText(control.get('Observaciones')?.value) || null,
          Fecha_Pago: control.get('Fecha_Pago')?.value || null
        }))
      : [];

    return {
      Titular: this.toUpperText(this.form.value.Titular),
      DNI: this.toUpperText(this.form.value.DNI),
      Tel_Contacto: this.form.value.TelefonoTitular || '',
      Cantidad_Personas: this.normalizarCantidadPersonas(this.form.value.Cantidad_Personas),
      Id_Rango: this.selectedRango?.Id_Rango ?? this.form.value.Rango ?? null,
      RangoDescripcion: this.selectedRangoDescripcion,
      Servicio: this.form.value.TipoServicio,
      Salida: this.toUpperText(this.form.value.Salida),
      Llegada: this.toUpperText(this.form.value.Llegada),
      FechaTransfer: this.form.value.Fecha,
      NombreReporta: this.toUpperText(this.form.value.Reporta),
      HoraRecogida: this.form.value.Hora,
      Vuelo: this.toUpperText(this.form.value.Vuelo),
      TipoVuelo: this.toUpperText(this.form.value.TipoVuelo),
      TelefonoTransfer: this.form.value.TelefonoReserva || '',
      Id_Moneda: this.getMonedaSeleccionada()?.Id_Moneda ?? null,
      ValorServicio: Number(this.form.value.Valor || 0),
      Valor: Number(this.form.value.Valor || 0),
      Moneda: this.form.value.Moneda,
      Observaciones: this.toUpperText(this.form.value.Observaciones) || null,
      Estado: 'Pendiente',
      Pago: {
        Tipo: tipoPago,
        Observaciones: tipoPago === 'Completo' ? this.toUpperText(this.form.value.PagoObservaciones) || null : null,
        Pago_Comprobante: null,
        Abonos: abonosPayload
      }
    };
  }

  private buildTransferFormData(): FormData {
    const payload = this.buildTransferPayload();
    const formData = new FormData();
    formData.append('payload', JSON.stringify(payload));

    const pagoCompletoFile = this.form.get('ComprobantePago')?.value;
    if (pagoCompletoFile instanceof File) {
      formData.append('comprobantePago', pagoCompletoFile);
    }

    if (this.form.value.TipoPago === 'Abonos') {
      this.abonos.controls.forEach((control, index) => {
        const file = control.get('Comprobante')?.value;
        if (file instanceof File) {
          formData.append(`comprobanteAbono_${index}`, file);
        }
      });
    }

    return formData;
  }

  // MÉTODOS PARA ARCHIVOS/COMPROBANTES
  private validateFile(file: File | null): { valid: boolean; error?: string } {
    if (!file) return { valid: false, error: 'No se seleccionó archivo' };

    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!allowedTypes.includes(file.type)) {
      return { valid: false, error: 'Tipo no permitido. Solo JPG, PNG o PDF.' };
    }

    if (file.size > maxSize) {
      return { valid: false, error: 'Archivo muy grande. Máximo 5MB.' };
    }

    return { valid: true };
  }

  onPagoCompletoFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const files = target.files;
    if (files && files[0]) {
      const validation = this.validateFile(files[0]);
      if (!validation.valid) {
        this.navbar.errorToast('Archivo inválido', validation.error || 'Error al validar archivo');
        target.value = '';
        return;
      }
      this.pagoPagadoFile = files[0];
      this.pagoPagadoFileName = files[0].name;
      this.form.get('ComprobantePago')?.setValue(files[0]);
      this.form.get('ComprobantePago')?.markAsDirty();
      this.syncPaymentFileValidators();
    }
  }

  onFileSelected(event: Event): void {
    this.onPagoCompletoFileSelected(event);
  }

  onAbonoFileSelected(event: Event, index: number): void {
    const target = event.target as HTMLInputElement;
    const files = target.files;
    if (files && files[0]) {
      const validation = this.validateFile(files[0]);
      if (!validation.valid) {
        this.navbar.errorToast('Archivo inválido', validation.error || 'Error al validar archivo');
        target.value = '';
        return;
      }
      this.abonoFiles.set(index, files[0]);
      this.abonoFileNames.set(index, files[0].name);
      const abonoControl = this.abonos.at(index) as FormGroup;
      abonoControl.get('Comprobante')?.setValue(files[0]);
      abonoControl.markAsDirty();
      this.syncPaymentFileValidators();
    }
  }

  clearPagoCompletoFile(): void {
    this.pagoPagadoFile = null;
    this.pagoPagadoFileName = null;
    this.form.get('ComprobantePago')?.setValue(null);
    this.form.get('ComprobantePago')?.markAsDirty();
    this.syncPaymentFileValidators();
    const input = document.getElementById('file-pago-completo') as HTMLInputElement;
    if (input) input.value = '';
    const newInput = document.getElementById('ComprobantePago') as HTMLInputElement;
    if (newInput) newInput.value = '';
  }

  deleteComprobante(): void {
    this.clearPagoCompletoFile();
  }

  clearAbonoFile(index: number): void {
    this.abonoFiles.delete(index);
    this.abonoFileNames.delete(index);
    const abonoControl = this.abonos.at(index) as FormGroup;
    abonoControl.get('Comprobante')?.setValue(null);
    abonoControl.markAsDirty();
    this.syncPaymentFileValidators();
    const input = document.getElementById(`file-abono-${index}`) as HTMLInputElement;
    if (input) input.value = '';
    const newInput = document.getElementById(`ComprobanteAbono${index}`) as HTMLInputElement;
    if (newInput) newInput.value = '';
  }

  getAbonoFileName(index: number): string | null {
    const file = this.abonos.at(index)?.get('Comprobante')?.value;
    return file?.name || this.abonoFileNames.get(index) || null;
  }

  ngOnInit(): void {
    this.form = this.fb.group({
      Titular: ['', Validators.required],
      DNI: [''],
      TelefonoTitular: ['', [Validators.pattern(this.e164WithTenDigitsPattern)]],
      Cantidad_Personas: [null, [this.cantidadPersonasValidator()]],
      Rango: [null],
      Moneda: ['COP'],
      TipoServicio: ['Seleccionar', [Validators.required, this.notSeleccionarValidator()]],
      Salida: ['', Validators.required],
      Llegada: ['', Validators.required],
      Fecha: ['', [Validators.required, this.fechaNoPasadaValidator()]],
      Hora: [''],
      TipoVuelo: [''],
      Reporta: ['', Validators.required],
      Vuelo: [''],
      Valor: [0],
      TelefonoReserva: ['', [Validators.required, Validators.pattern(this.e164WithTenDigitsPattern)]],
      Observaciones: [''],
      TipoPago: ['PagaEnPunto'],
      Abonos: this.fb.array([]),
      ComprobantePago: [null],
      PagoObservaciones: ['']
    });

    this.syncPaymentFileValidators();

    this.form.get('TipoPago')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.syncPaymentFileValidators();
        this.cdr.markForCheck();
      });

    this.loadCatalogos();

    // detectar rango automáticamente a partir de la cantidad real de personas
    this.form.get('Cantidad_Personas')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.actualizarRangoDetectado({ preservarValor: false, notificarSinPrecio: true });
      });

    this.form.get('Valor')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
      });

    this.form.get('Moneda')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.actualizarRangoDetectado({ preservarValor: false, notificarSinPrecio: true });
      });
    // detectar cuando el tipo de servicio cambia para activar campos de vuelo
    this.form.get('TipoServicio')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((serviceId) => {
        const nombre = this.resultsServicioTransfer.find(s => String(s.Id_Servicio ?? s.id) === String(serviceId))?.Servicio || '';
        // sólo activar si es 'Hotel -> Aeropuerto' (no al revés)
        const isHotelToAirport = /hotel\s*\/?\s*aeropuerto/i.test(nombre);
        this.showFlightFields = Boolean(isHotelToAirport);

        const tipoVueloCtrl = this.form.get('TipoVuelo');
        const vueloCtrl = this.form.get('Vuelo');
        if (this.showFlightFields) {
          tipoVueloCtrl?.setValidators([Validators.required]);
          vueloCtrl?.setValidators([Validators.required]);
        } else {
          tipoVueloCtrl?.clearValidators();
          vueloCtrl?.clearValidators();
        }
        tipoVueloCtrl?.updateValueAndValidity({ emitEvent: false });
        vueloCtrl?.updateValueAndValidity({ emitEvent: false });

        if (!this.showFlightFields) {
          vueloCtrl?.setValue('');
          tipoVueloCtrl?.setValue('');
        }
      });

    // cuando cambie el tipo de vuelo y el servicio sea hotel->aeropuerto, advertir al usuario
    this.form.get('TipoVuelo')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((tipo) => {
        if (!this.showFlightFields) return;
        const msg = tipo === 'Internacional'
          ? 'Para vuelos internacionales se recomienda 4 horas de anticipación con el titular.'
          : 'Para vuelos nacionales se recomienda 2 horas de anticipación con el titular.';
        this.closeSummaryIfOpen();
        this.navbar.showAlert({
          type: 'info',
          title: 'Recomendación',
          message: msg,
          autoClose: true,
          buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.clearOverlay() }]
        });
      });
  }

  checkWhatsappForReserva(): void {
    // WhatsApp verification removed — no operation.
  }

  private loadCatalogos(): void {
    this.isLoading.set(true);

    const requests: any = {
      servicios: this.transferSvc.getServicios().pipe(catchError(() => of([] as any[]))),
      rangos: this.transferSvc.getRangos().pipe(catchError(() => of([] as any[]))),
      monedas: this.transferSvc.getMonedas().pipe(catchError(() => of([] as any[])))
    };

    forkJoin<CrearTransferLoadResult>(requests).subscribe({
      next: (result: CrearTransferLoadResult) => {
        this.resultsServicioTransfer = Array.isArray(result.servicios) ? result.servicios : [];
        this.resultsRangos = Array.isArray(result.rangos) ? result.rangos : [];
        this.resultsMonedas = Array.isArray(result.monedas) ? result.monedas : [];

        // set default moneda if existe COP
        const hasCOP = this.resultsMonedas.find((m: any) => m.Codigo === 'COP');
        const defaultMon = hasCOP ? 'COP' : (this.resultsMonedas[0]?.Codigo || 'COP');
        this.form.get('Moneda')?.setValue(defaultMon);

        if (result.servicios.length === 0) {
          this.navbar.errorToast('Error', 'No se pudieron cargar los servicios de transfer.');
        }

      },
      error: () => {
        this.navbar.errorToast('Error', 'No se pudieron cargar los catálogos necesarios.');
      },
      complete: () => {
        this.isLoading.set(false);
        this.cdr.markForCheck();
      }
    });
  }

  async onSubmit(): Promise<void> {
      if (this.isSubmitting()) return;
    this.closeSummaryIfOpen();

    this.syncPaymentFileValidators();
    this.form.updateValueAndValidity({ emitEvent: false });
    if (!this.validateFechaTransferBeforeSubmit()) {
      this.isSubmitting.set(false);
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.markPaymentFilesTouched();

      const invalid = Object.keys(this.form.controls).filter(k => this.form.get(k)?.invalid);
      const friendly: Record<string, string> = {
        Titular: 'Titular',
        TelefonoTitular: 'Teléfono del titular (ej: +573001234567)',
        Cantidad_Personas: 'Cantidad de personas',
        TipoServicio: 'Tipo de servicio',
        Salida: 'Punto de salida',
        Llegada: 'Punto de llegada',
        Fecha: 'Fecha del servicio (no puede ser anterior a hoy)',
        TipoVuelo: 'Tipo de vuelo',
        Vuelo: 'Número de vuelo',
        Reporta: 'Nombre del reportante',
        TelefonoReserva: 'Teléfono de reserva (ej: +573001234567)',
        ComprobantePago: 'Comprobante del pago completo'
      };

      const fields = invalid.map(f => friendly[f] || f);
      const msg = fields.length ? `Revisa los siguientes campos: ${fields.join(', ')}` : 'Hay campos inválidos en el formulario.';
      this.closeSummaryIfOpen();

      this.navbar.showAlert({
        type: 'error',
        title: 'Campos requeridos incompletos',
        message: msg,
        autoClose: true,
        buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.clearOverlay() }]
      });
      return;
    }

    const cantidadPersonas = this.normalizarCantidadPersonas(this.form.get('Cantidad_Personas')?.value);
    if (cantidadPersonas !== null && !this.selectedRango) {
      this.navbar.errorToast('Rango no encontrado', 'No existe un rango configurado para la cantidad de personas indicada.');
      return;
    }

    this.closeSummaryIfOpen();

    const confirmed = await this.requestCreateTransferConfirmation();
    if (!confirmed) return;

    this.processSubmit();
  }

  private buildCreateTransferConfirmationMessage(): string {
    const fecha = String(this.form.get('Fecha')?.value || '').trim();
    const cantidad = String(this.form.get('Cantidad_Personas')?.value || '').trim();
    const rangoDescripcion = this.selectedRangoDescripcion || '—';
    const salida = String(this.form.get('Salida')?.value || '').trim();
    const llegada = String(this.form.get('Llegada')?.value || '').trim();
    const moneda = String(this.form.get('Moneda')?.value || 'COP').trim();
    const valor = Number(this.form.get('Valor')?.value || 0);
    return [
      `Fecha: ${fecha || '—'}.`,
      `Pasajeros: ${cantidad || '—'} (${rangoDescripcion}).`,
      `Ruta: ${salida || '—'} → ${llegada || '—'}.`,
      `Total: ${moneda} ${valor.toLocaleString('es-CO')}.`,
      '¿Deseas continuar con la creación del transfer?'
    ].join('\n');
  }

  private requestCreateTransferConfirmation(): Promise<boolean> {
    return new Promise((resolve) => {
      this.closeSummaryIfOpen();
      this.navbar.showConfirm(
        '¿Todo listo?',
        this.buildCreateTransferConfirmationMessage(),
        [
          {
            text: 'Cancelar',
            style: 'secondary',
            onClick: () => {
              this.navbar.clearOverlay();
              resolve(false);
            }
          },
          {
            text: 'Crear',
            style: 'primary',
            onClick: () => {
              this.navbar.clearOverlay();
              resolve(true);
            }
          }
        ]
      );
    });
  }

  private processSubmit(): void {
    this.isSubmitting.set(true);

    if (!this.validateFechaTransferBeforeSubmit()) {
      this.isSubmitting.set(false);
      return;
    }

    // validar campos de vuelo si aplica (se requiere tipo y número de vuelo)
    if (this.showFlightFields) {
      if (!this.form.value.Vuelo || !this.form.value.TipoVuelo) {
        this.navbar.warningToast('Falta información de vuelo', 'Completa tipo de vuelo y número de vuelo.');
        this.isSubmitting.set(false);
        return;
      }
    }

    this.syncPaymentFileValidators();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.markPaymentFilesTouched();
      this.closeSummaryIfOpen();
      this.navbar.errorToast('Faltan datos', 'Revisa el formulario antes de guardar.');
      this.isSubmitting.set(false);
      return;
    }

    const formData = this.buildTransferFormData();

    this.transferSvc.crearTransfer(formData).subscribe({
      next: (data) => {
        this.navbar.successToast('Transfer creado', data?.message || 'Transfer creado correctamente.');
        this.resetForm();
        this.isSubmitting.set(false);
        this.router.navigate(['/Transfers/VerTransfers']);
      },
      error: () => {
        this.navbar.errorToast('Error', 'Hubo un error al crear el transfer.');
        this.isSubmitting.set(false);
      }
    });
  }

  private resetForm(): void {
    this.abonos.clear();
    this.form.reset({
      TipoServicio: 'Seleccionar',
      Cantidad_Personas: null,
      Rango: null,
      Moneda: 'COP',
      Valor: 0,
      TipoPago: 'PagaEnPunto',
      ComprobantePago: null,
      PagoObservaciones: ''
    });
    this.form.markAsPristine();
    this.form.get('ComprobantePago')?.setValue(null);
    this.pagoPagadoFile = null;
    this.pagoPagadoFileName = null;
    this.abonoFiles.clear();
    this.abonoFileNames.clear();
    this.selectedRango = null;
    this.selectedRangoDescripcion = null;
    this.precioSeleccionado = null;
    this.valorEsEditable = false;
    this.toggleSummary(false);
    this.currentStep = 0;
    this.maxReachedStep = 0;
    this.goingBack = false;
    this.panelAnimating = false;
    this.syncPaymentFileValidators();
  }

  ngOnDestroy(): void {
    if (this.navbar?.cuposInfo) this.navbar.cuposInfo.set(null);
    this.navbar?.clearOverlay?.();
  }

  hasUnsavedChanges(): boolean {
    return this.form?.dirty && !this.isSubmitting();
  }

  getPhoneError(controlName: string): string {
    const ctrl = this.form?.get(controlName);
    if (!ctrl) return 'Teléfono inválido.';
    if (ctrl.hasError('required')) return 'El teléfono es obligatorio.';
    if (ctrl.hasError('pattern')) {
      return "Debe iniciar con '+' y tener indicativo + exactamente 10 dígitos del número (ej: +573001234567).";
    }
    return 'Teléfono inválido.';
  }
}
