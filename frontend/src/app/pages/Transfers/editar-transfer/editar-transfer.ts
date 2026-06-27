import { Component, OnInit, OnDestroy, signal, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators, FormArray } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { AlertButton, SirAlertService } from '../../../services/Alertas/alert.service';
import { TransferService } from '../../../services/Transfers/transfers';
import { SirDrawerService } from '../../../services/Drawer/drawer.service';
import { DatepickerComponent } from '../../../shared/datepicker/datepicker';
import { UppercaseInputDirective } from '../../../shared/directives/uppercase-input.directive';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { UiStateService } from '../../../services/ui-state.service';

interface WizardStep {
  id: string;
  label: string;
}

@Component({
  selector: 'app-editar-transfer',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, UppercaseInputDirective, DatepickerComponent],
  templateUrl: './editar-transfer.html',
  styleUrls: ['./editar-transfer.css']
})
export class EditarTransferComponent implements OnInit, OnDestroy {
  private alerts = inject(SirAlertService);
  private uiState = inject(UiStateService);
  private drawer = inject(SirDrawerService);
  form!: FormGroup;
  private readonly e164WithTenDigitsPattern = /^\+[1-9]\d{10,12}$/;
  private originalTransfer: any = null;

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

  private normalizeIncomingDate(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    const direct = this.normalizeYmd(raw);
    if (direct) return direct;

    const isoCandidate = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0];
    const normalizedIsoCandidate = this.normalizeYmd(isoCandidate);
    if (normalizedIsoCandidate) return normalizedIsoCandidate;

    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const [, dayPart, monthPart, yearPart] = slashMatch;
      const reordered = `${yearPart}-${monthPart.padStart(2, '0')}-${dayPart.padStart(2, '0')}`;
      return this.normalizeYmd(reordered) || '';
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';

    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
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
    if (this.form?.get('TipoPago')?.value === 'Abonos') return this.abonos.controls.every((control) => control.valid);
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
        this.abonos.controls.forEach((control) => control.markAllAsTouched());
        this.form.get('ComprobantePago')?.markAsTouched();
        this.navbar.showAlert({
          type: 'warning',
          title: 'Pago incompleto',
          message: !this.abonosValidos
            ? 'Los abonos no pueden superar el valor del transfer.'
            : 'Revisa la información de pago antes de continuar.',
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
        return !this.abonosValidos;
      default:
        return false;
    }
  }

  openSummary = false;
  isLoading = signal<boolean>(true);
  isSubmitting = signal<boolean>(false);
  private isHydrating = false;

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
  private pagoCompletoSoporteUrlParaReemplazo: string | null = null;
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
      confirmDelete: (title: string, message: string, onConfirm: () => void, onCancel?: () => void) =>
        this.alerts.confirmDelete(title, message, onConfirm, onCancel),
      successToast: (title: string, message = '') => this.alerts.successToast(title, message),
      errorToast: (title: string, message = '') => this.alerts.errorToast(title, message),
      warningToast: (title: string, message = '') => this.alerts.warningToast(title, message),
      clearOverlay: () => this.alerts.closeModal(),
      needsRefresh: this.uiState.needsRefresh,
      cuposInfo: this.uiState.cuposInfo,
      Id_Transfer: this.uiState.transferId,
    };
  }

  constructor(
    private fb: FormBuilder,
    private transferSvc: TransferService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private route: ActivatedRoute,
    private destroyRef: DestroyRef,
    private permisosSvc: PermisosService
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
    if (this.isHydrating || !this.form) return;

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

          if (opts.preservarValor === true) {
            this.cdr.markForCheck();
            return;
          }

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

  get transferHeaderCode(): string {
    const id = this.getTransferIdFromRoute();
    return id ? `#${this.formatTransferCode(id)}` : '';
  }

  get abonos(): FormArray {
    return this.form.get('Abonos') as FormArray;
  }

  private crearAbonoGroup(data?: any): FormGroup {
    return this.fb.group({
      Id_Pago: [data?.Id_Pago || null],
      Monto: [data?.Monto ?? '', [Validators.required, Validators.min(0.01)]],
      Observaciones: [data?.Observaciones || ''],
      Fecha_Pago: [data?.Fecha_Pago || ''],
      Comprobante: [null],
      SoporteUrl: [data?.Pago_Comprobante || data?.SoporteUrl || null]
    });
  }

  addAbono(): void {
    this.abonos.push(this.crearAbonoGroup());
  }

  removeAbono(index: number): void {
    this.abonos.removeAt(index);
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

  private validateFile(file: File | null): { valid: boolean; error?: string } {
    if (!file) return { valid: false, error: 'No se seleccionó archivo' };
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    const maxSize = 5 * 1024 * 1024;
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
      const currentValue = this.form.get('ComprobantePago')?.value;
      this.pagoCompletoSoporteUrlParaReemplazo = currentValue?.SoporteUrl || this.pagoCompletoSoporteUrlParaReemplazo;
      this.pagoPagadoFile = files[0];
      this.pagoPagadoFileName = files[0].name;
      this.form.get('ComprobantePago')?.setValue(files[0]);
      this.form.get('ComprobantePago')?.markAsDirty();
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
    }
  }

  clearPagoCompletoFile(): void {
    this.pagoPagadoFile = null;
    this.pagoPagadoFileName = null;
    this.pagoCompletoSoporteUrlParaReemplazo = null;
    this.form.get('ComprobantePago')?.setValue(null);
    this.form.get('ComprobantePago')?.markAsDirty();
    const input = document.getElementById('file-pago-completo') as HTMLInputElement;
    if (input) input.value = '';
    const newInput = document.getElementById('ComprobantePagoReemplazar') as HTMLInputElement;
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
    abonoControl.get('SoporteUrl')?.setValue(null);
    abonoControl.markAsDirty();
    const input = document.getElementById(`file-abono-${index}`) as HTMLInputElement;
    if (input) input.value = '';
    const newInput = document.getElementById(`ComprobanteAbono${index}`) as HTMLInputElement;
    if (newInput) newInput.value = '';
  }

  getAbonoFileName(index: number): string | null {
    const file = this.abonos.at(index)?.get('Comprobante')?.value;
    return file?.name || this.abonoFileNames.get(index) || null;
  }

  eliminarComprobanteAbono(index: number): void {
    this.clearAbonoFile(index);
  }

  viewComprobante(url: string | null): void {
    if (!url) return;
    const filename = String(url).split('/').filter(Boolean).pop();
    if (!filename) {
      this.navbar.warningToast('Comprobante inválido', 'No se pudo resolver el comprobante.');
      return;
    }

    this.transferSvc.descargarComprobante(filename).subscribe({
      next: (blob) => {
        const href = URL.createObjectURL(blob);
        window.open(href, '_blank');
        setTimeout(() => URL.revokeObjectURL(href), 30000);
      },
      error: () => this.navbar.errorToast('Error', 'No se pudo abrir el comprobante.')
    });
  }

  private getTransferIdFromRoute(): string | null {
    const routeId =
      this.route.snapshot.paramMap.get('id') ||
      this.route.snapshot.paramMap.get('Id_Transfer') ||
      this.route.snapshot.queryParamMap.get('id') ||
      this.route.snapshot.queryParamMap.get('Id_Transfer') ||
      this.route.snapshot.url.map((segment) => segment.path).filter(Boolean).at(-1) ||
      this.navbar.Id_Transfer();

    const normalizedId = String(routeId ?? '').trim();
    return normalizedId || null;
  }

  private formatTransferCode(idTransfer: string | number): string {
    const numeric = String(idTransfer || '').replace(/\D/g, '');
    return numeric ? `TRS${numeric.padStart(5, '0')}` : String(idTransfer || '').trim() || 'TRS';
  }

  private unwrapListResponse(response: any): any[] {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.data)) return response.data;
    return [];
  }

  private unwrapTransferDetalle(response: any): any | null {
    if (!response) return null;
    if (response?.data?.data?.transfer) return response.data.data;
    if (response?.data?.transfer) return response.data;
    if (response?.data?.Id_Transfer) return response.data;
    if (response?.transfer) return response;
    if (response?.Id_Transfer) return response;
    return null;
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

    // Cargar catálogos y datos del transfer
    this.loadCatalogosAndTransferData();

    // Listeners para cambios
    this.form.get('Cantidad_Personas')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.isHydrating) return;
        this.actualizarRangoDetectado({ preservarValor: false, notificarSinPrecio: true });
      });

    this.form.get('Moneda')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.isHydrating) return;
        this.actualizarRangoDetectado({ preservarValor: false, notificarSinPrecio: true });
      });

    this.form.get('TipoServicio')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((serviceId) => {
        if (this.isHydrating) return;
        const nombre = this.resultsServicioTransfer.find(s => String(s.Id_Servicio ?? s.id) === String(serviceId))?.Servicio || '';
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

    this.form.get('TipoVuelo')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((tipo) => {
        if (this.isHydrating) return;
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

  private loadCatalogosAndTransferData(): void {
    this.isLoading.set(true);

    const transferId = this.getTransferIdFromRoute();
    if (!transferId) {
      this.navbar.errorToast('Error', 'ID de transfer no encontrado.');
      this.router.navigate(['/Transfers/VerTransfers']);
      this.isLoading.set(false);
      return;
    }

    forkJoin({
      servicios: this.transferSvc.getServicios().pipe(catchError(() => of([]))),
      rangos: this.transferSvc.getRangos().pipe(catchError(() => of([]))),
      monedas: this.transferSvc.getMonedas().pipe(catchError(() => of([]))),
      transfer: this.transferSvc.getTransfer(transferId).pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ servicios, rangos, monedas, transfer }) => {
        this.resultsServicioTransfer = this.unwrapListResponse(servicios);
        this.resultsRangos = this.unwrapListResponse(rangos);
        this.resultsMonedas = this.unwrapListResponse(monedas);

        const detalle = this.unwrapTransferDetalle(transfer);
        if (!detalle) {
          const backendMessage =
            transfer?.message ||
            transfer?.error?.message ||
            transfer?.error?.error ||
            null;

          this.navbar.errorToast('Error', backendMessage || 'No se pudo cargar el detalle del transfer.');
          this.router.navigate(['/Transfers/VerTransfers']);
          return;
        }

        this.fillFormWithTransferData(detalle);
      },
      error: () => {
        this.navbar.errorToast('Error', 'No se pudieron cargar los catálogos.');
        this.isLoading.set(false);
      },
      complete: () => {
        this.isLoading.set(false);
        this.cdr.markForCheck();
      }
    });
  }

  private fillFormWithTransferData(data: any): void {
    const transfer = data.transfer || data;
    const pagos = data.pagos || [];
    this.originalTransfer = structuredClone(transfer);

    this.isHydrating = true;
    try {
      // Llenar formulario con datos del transfer
      this.form.patchValue({
        Titular: transfer.Nombre_Titular || '',
        DNI: transfer.DNI || '',
        TelefonoTitular: transfer.Telefono_Titular || '',
        Cantidad_Personas: transfer.Cantidad_Personas ?? null,
        Rango: transfer.Id_Rango || null,
        Moneda: transfer.MonedaCodigo || 'COP',
        TipoServicio: transfer.Id_Servicio || 'Seleccionar',
        Salida: transfer.Punto_Salida || '',
        Llegada: transfer.Punto_Destino || '',
        Fecha: this.normalizeIncomingDate(transfer.Fecha_Transfer),
        Hora: transfer.Hora_Recogida || '',
        TipoVuelo: transfer.TipoVuelo || '',
        Reporta: transfer.Nombre_Reportante || '',
        Vuelo: transfer.Vuelo || '',
        Valor: Number(transfer.Valor || 0),
        TelefonoReserva: transfer.Telefono_Reportante || '',
        Observaciones: transfer.Observaciones || ''
      }, { emitEvent: false });

      // Determinar tipo de pago
      if (pagos.length === 0 || (pagos.length === 1 && pagos[0].Metodo === 'Paga en punto')) {
        this.form.patchValue({ TipoPago: 'PagaEnPunto' }, { emitEvent: false });
      } else if (pagos.length === 1 && pagos[0].Metodo === 'Completo') {
        this.form.patchValue({ TipoPago: 'Completo' }, { emitEvent: false });
        this.form.get('PagoObservaciones')?.setValue(pagos[0].Observaciones || '', { emitEvent: false });
        this.form.get('ComprobantePago')?.setValue(
          pagos[0].Pago_Comprobante
            ? { Id_Pago: pagos[0].Id_Pago, SoporteUrl: pagos[0].Pago_Comprobante }
            : null,
          { emitEvent: false }
        );
      } else {
        this.form.patchValue({ TipoPago: 'Abonos' }, { emitEvent: false });
        // Llenar abonos
        const abonosArray = this.form.get('Abonos') as FormArray;
        abonosArray.clear();
        pagos.forEach((pago: any) => {
          if (pago.Metodo === 'Abono') {
            abonosArray.push(this.crearAbonoGroup({
              ...pago,
              Monto: Number(pago.Monto || 0)
            }));
          }
        });
      }

      // Detectar si necesita campos de vuelo
      const serviceId = this.form.get('TipoServicio')?.value;
      if (serviceId && serviceId !== 'Seleccionar') {
        const nombre = this.resultsServicioTransfer.find(s => String(s.Id_Servicio ?? s.id) === String(serviceId))?.Servicio || '';
        this.showFlightFields = /hotel\s*\/?\s*aeropuerto/i.test(nombre);
      }

      this.form.markAsPristine();
    } finally {
      this.isHydrating = false;
      this.actualizarRangoDetectado({ preservarValor: true, notificarSinPrecio: false });
    }
  }

  async onSubmit(): Promise<void> {
    if (this.isSubmitting()) return;
    this.closeSummaryIfOpen();

    this.form.updateValueAndValidity({ emitEvent: false });
    if (!this.validateFechaTransferBeforeSubmit()) {
      this.isSubmitting.set(false);
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();

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
        TelefonoReserva: 'Teléfono de reserva (ej: +573001234567)'
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

    const confirmed = await this.requestUpdateTransferConfirmation();
    if (!confirmed) return;

    this.processSubmit();
  }

  private buildUpdateTransferConfirmationMessage(): string {
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
      '¿Deseas continuar con la actualización del transfer?'
    ].join('\n');
  }

  private requestUpdateTransferConfirmation(): Promise<boolean> {
    return new Promise((resolve) => {
      this.closeSummaryIfOpen();
      this.navbar.showConfirm(
        '¿Confirmar actualización?',
        this.buildUpdateTransferConfirmationMessage(),
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
            text: 'Actualizar',
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

  private getTransferEstadoActual(): string {
    return String(
      this.originalTransfer?.Estado ??
      this.originalTransfer?.Estado_Transfer ??
      this.originalTransfer?.estado ??
      this.originalTransfer?.Cabecera?.Estado ??
      this.originalTransfer?.transfer?.Estado ??
      ''
    ).trim().toLowerCase();
  }

  get puedeCancelarTransfer(): boolean {
    const estado = this.getTransferEstadoActual();
    return !!this.getTransferIdFromRoute() && !['cancelada', 'cancelado', 'completada', 'completado'].includes(estado);
  }

  get canDeleteTransfer(): boolean {
    return this.permisosSvc.tienePermiso('TRANSFERS.ELIMINAR');
  }

  get canUpdateTransfer(): boolean {
    return this.permisosSvc.tienePermiso('TRANSFERS.ACTUALIZAR');
  }

  cancelarTransfer(): void {
    const id = this.getTransferIdFromRoute();
    if (!id || !this.puedeCancelarTransfer) return;

    this.closeSummaryIfOpen();

    this.navbar.showConfirm(
      'Cancelar transfer',
      `¿Deseas cancelar el transfer #${id}? La información no se eliminará y quedará sólo para consulta futura.`,
      [
        {
          text: 'Mantener',
          style: 'secondary',
          onClick: () => this.navbar.clearOverlay()
        },
        {
          text: 'Cancelar transfer',
          style: 'primary',
          onClick: () => {
            this.navbar.clearOverlay();
            this.isSubmitting.set(true);
            this.transferSvc.cancelarTransfer(id).subscribe({
              next: () => {
                this.navbar.successToast('Transfer cancelado', `El transfer #${id} quedó en estado Cancelado.`);
                this.form.markAsPristine();
                this.isSubmitting.set(false);
                this.router.navigate(['/Transfers/VerTransfers']);
              },
              error: (err) => {
                const message = err?.error?.message || err?.error?.error || err?.message || 'No se pudo cancelar el transfer.';
                this.navbar.errorToast('No se pudo cancelar', message);
                this.isSubmitting.set(false);
              }
            });
          }
        }
      ]
    );
  }

  eliminarTransfer(): void {
    const id = this.getTransferIdFromRoute();
    if (!id || !this.canDeleteTransfer) return;

    this.closeSummaryIfOpen();

    this.alerts.confirmDelete(
      'Eliminar transfer',
      `¿Deseas eliminar el transfer #${id}? Esta acción eliminará el registro de forma permanente.`,
      () => {
        this.isSubmitting.set(true);
        this.transferSvc.deleteTransfer(id).subscribe({
          next: () => {
            this.navbar.needsRefresh.set('transfers');
            this.navbar.successToast('Transfer eliminado', `El transfer #${id} fue eliminado correctamente.`);
            this.isSubmitting.set(false);
            this.router.navigate(['/Transfers/VerTransfers']);
          },
          error: (err) => {
            const message = err?.error?.message || err?.error?.error || err?.message || 'No se pudo eliminar el transfer.';
            this.navbar.errorToast('No se pudo eliminar', message);
            this.isSubmitting.set(false);
          }
        });
      }
    );
    return;

    this.navbar.showConfirm(
      'Eliminar transfer',
      `¿Deseas eliminar el transfer #${id}? Esta acción eliminará el registro de forma permanente.`,
      [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.navbar.clearOverlay()
        },
        {
          text: 'Eliminar',
          style: 'delete',
          onClick: () => {
            this.navbar.clearOverlay();
            this.isSubmitting.set(true);
            this.transferSvc.deleteTransfer(id).subscribe({
              next: () => {
                this.navbar.needsRefresh.set('transfers');
                this.navbar.successToast('Transfer eliminado', `El transfer #${id} fue eliminado correctamente.`);
                this.isSubmitting.set(false);
                this.router.navigate(['/Transfers/VerTransfers']);
              },
              error: (err) => {
                const message = err?.error?.message || err?.error?.error || err?.message || 'No se pudo eliminar el transfer.';
                this.navbar.errorToast('No se pudo eliminar', message);
                this.isSubmitting.set(false);
              }
            });
          }
        }
      ]
    );
  }

  private processSubmit(): void {
    this.isSubmitting.set(true);

    if (!this.validateFechaTransferBeforeSubmit()) {
      this.isSubmitting.set(false);
      return;
    }

    const transferId = this.getTransferIdFromRoute();
    if (!transferId) {
      this.navbar.errorToast('Error', 'ID de transfer no encontrado.');
      this.isSubmitting.set(false);
      return;
    }

    if (this.showFlightFields) {
      if (!this.form.value.Vuelo || !this.form.value.TipoVuelo) {
        this.navbar.warningToast('Falta información de vuelo', 'Completa tipo de vuelo y número de vuelo.');
        this.isSubmitting.set(false);
        return;
      }
    }

    const tipoPago = this.form.value.TipoPago;
    const comprobantePagoValue = this.form.get('ComprobantePago')?.value;
    const pagoCompletoRutaActual = comprobantePagoValue instanceof File
      ? this.pagoCompletoSoporteUrlParaReemplazo
      : comprobantePagoValue?.SoporteUrl || null;
    const abonosPayload = tipoPago === 'Abonos'
      ? this.abonos.controls
          .map((control) => ({
            Monto: Number(control.get('Monto')?.value || 0),
            Observaciones: this.toUpperText(control.get('Observaciones')?.value) || null,
            Fecha_Pago: control.get('Fecha_Pago')?.value || null,
            Pago_Comprobante: control.get('SoporteUrl')?.value || null
          }))
          .filter((abono) => abono.Monto > 0)
      : [];

    const pagoFinal: any = {
      Tipo: tipoPago,
      Observaciones: tipoPago === 'Completo' ? this.toUpperText(this.form.value.PagoObservaciones) || null : null,
      Pago_Comprobante: tipoPago === 'Completo' ? pagoCompletoRutaActual : null,
      Abonos: abonosPayload
    };

    const transferData: any = {
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
      Observaciones: this.toUpperText(this.form.value.Observaciones),
      Estado: null,
      Pago: pagoFinal
    };

    this.transferSvc.actualizarTransfer(transferId, transferData).subscribe({
      next: (data) => {
        const idTransfer = data?.data?.Id_Transfer || transferId;
        const pagos = data?.data?.pagos || [];

        if (idTransfer && this.hasComprobantesToUpload()) {
          this.uploadComprobantesTransfer(idTransfer, pagos);
          return;
        }

        this.finishSubmitSuccess('Transfer actualizado correctamente.');
      },
      error: (err) => {
        console.error('Error:', err);
        const message = err?.error?.message || err?.error?.error || err?.message || 'Hubo un error al actualizar el transfer.';
        this.navbar.errorToast('Error', message);
        this.isSubmitting.set(false);
      }
    });
  }

  private uploadComprobantesTransfer(idTransfer: number | string, pagos: any[]): void {
    const uploads: Promise<void>[] = [];
    const pagoCompletoFile = this.form.get('ComprobantePago')?.value;

    if (pagoCompletoFile instanceof File && pagos.length > 0) {
      uploads.push(new Promise((resolve, reject) => {
        this.transferSvc.subirComprobantePago(idTransfer, pagos[0].Id_Pago, pagoCompletoFile).subscribe({
          next: () => resolve(),
          error: (err) => reject(err)
        });
      }));
    }

    const abonosConMonto = this.abonos.controls.filter(control => Number(control.get('Monto')?.value || 0) > 0);
    abonosConMonto.forEach((control, index) => {
      const file = control.get('Comprobante')?.value;
      if (file instanceof File && pagos[index]) {
        uploads.push(new Promise((resolve, reject) => {
          this.transferSvc.subirComprobantePago(idTransfer, pagos[index].Id_Pago, file).subscribe({
            next: () => resolve(),
            error: (err) => reject(err)
          });
        }));
      }
    });

    Promise.all(uploads)
      .then(() => this.finishSubmitSuccess('Transfer y comprobantes actualizados correctamente.'))
      .catch(() => {
        this.finishSubmitSuccess('Transfer actualizado pero hubo problemas al guardar algunos comprobantes.');
      });
  }

  private hasComprobantesToUpload(): boolean {
    const pagoCompletoFile = this.form.get('ComprobantePago')?.value;
    if (pagoCompletoFile instanceof File) return true;
    return this.abonos.controls.some(control => control.get('Comprobante')?.value instanceof File);
  }

  private finishSubmitSuccess(message: string): void {
    this.form.markAsPristine();
    this.isSubmitting.set(false);
    const transferId = String(this.getTransferIdFromRoute() || '').trim();
    this.alerts.showModal({
      type: 'success',
      title: 'Transfer actualizado',
      message,
      buttons: [
        {
          text: 'Cerrar',
          style: 'secondary',
          onClick: () => {
            this.alerts.closeModal();
            this.goToVerTransfers();
          }
        },
        {
          text: 'Ver Transfer',
          style: 'primary',
          onClick: () => {
            this.alerts.closeModal();
            this.goToVerTransfers(transferId, true);
          }
        },
      ],
    });
  }

  private goToVerTransfers(idTransfer?: string | null, openDrawer = false): void {
    this.uiState.needsRefresh.set('transfers');
    this.uiState.cuposInfo.set(null);
    const transferId = idTransfer ? String(idTransfer) : '';
    if (openDrawer && transferId) {
      this.drawer.openTransfer(transferId);
    }
    void this.router.navigate(['/Transfers/VerTransfers']);
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
