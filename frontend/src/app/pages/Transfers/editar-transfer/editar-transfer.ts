import { Component, OnInit, OnDestroy, signal, ChangeDetectorRef, DestroyRef } from '@angular/core';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators, FormArray } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { TransferService } from '../../../services/Transfers/transfers';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';

@Component({
  selector: 'app-editar-transfer',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, FlatpickrInputDirective],
  templateUrl: './editar-transfer.html',
  styleUrls: ['./editar-transfer.css']
})
export class EditarTransferComponent implements OnInit, OnDestroy {
  form!: FormGroup;
  private readonly e164WithTenDigitsPattern = /^\+[1-9]\d{10,12}$/;

  openSummary = false;
  isLoading = signal<boolean>(true);
  isSubmitting = signal<boolean>(false);
  private isHydrating = false;

  resultsServicioTransfer: any[] = [];
  resultsRangos: any[] = [];
  resultsMonedas: any[] = [];
  selectedRangoDescripcion: string | null = null;
  precioSeleccionado: number | null = null;
  showFlightFields = false;

  // Archivos de comprobantes
  pagoPagadoFile: File | null = null;
  pagoPagadoFileName: string | null = null;
  private pagoCompletoSoporteUrlParaReemplazo: string | null = null;
  abonoFiles: Map<number, File> = new Map();
  abonoFileNames: Map<number, string> = new Map();

  fpOptionsFecha: Partial<FlatpickrOptions> = {
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'd/m/Y',
    allowInput: false,
    disableMobile: true,
    monthSelectorType: 'dropdown' as FlatpickrOptions['monthSelectorType'],
    altInputClass: 'form-input flatpickr-input flatpickr-alt',
    onReady: (_sel, _str, inst: any) => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      const cal: HTMLElement = inst?.calendarContainer;
      if (!cal) return;
      cal.classList.add('sir-flatpickr');

      const clampDay = (y: number, m: number, d: number) => {
        const last = new Date(y, m + 1, 0).getDate();
        return Math.min(Math.max(d, 1), last);
      };

      let yearDiv: HTMLDivElement | null = null;
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

  constructor(
    private fb: FormBuilder,
    private navbar: DynamicIslandGlobalService,
    private transferSvc: TransferService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private route: ActivatedRoute,
    private destroyRef: DestroyRef
  ) { }

  private notSeleccionarValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = String(control.value ?? '').trim().toLowerCase();
      return value === '' || value === 'seleccionar' ? { seleccionarInvalido: true } : null;
    };
  }

  toggleSummary(force?: boolean) {
    this.openSummary = typeof force === 'boolean' ? force : !this.openSummary;
  }

  public getNombreServicio(): string {
    const id = this.form?.get('TipoServicio')?.value;
    const servicio = this.resultsServicioTransfer.find(s => String(s.Id_Servicio ?? s.id) === String(id));
    return servicio ? servicio.Servicio : '—';
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
    if (response?.data?.transfer) return response.data;
    if (response?.transfer) return response;
    return null;
  }

  ngOnInit(): void {
    this.form = this.fb.group({
      Titular: ['', Validators.required],
      DNI: [''],
      TelefonoTitular: ['', [Validators.pattern(this.e164WithTenDigitsPattern)]],
      Rango: ['Seleccionar', [Validators.required, this.notSeleccionarValidator()]],
      Moneda: ['COP'],
      TipoServicio: ['Seleccionar', [Validators.required, this.notSeleccionarValidator()]],
      Salida: ['', Validators.required],
      Llegada: ['', Validators.required],
      Fecha: ['', Validators.required],
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
    this.form.get('Rango')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((rangoId) => {
        if (this.isHydrating) return;
        if (!rangoId || rangoId === 'Seleccionar') {
          this.selectedRangoDescripcion = null;
          this.precioSeleccionado = null;
          this.form.get('Valor')?.setValue(0);
          return;
        }
        const r = this.resultsRangos.find(rr => String(rr.Id_Rango ?? rr.id) === String(rangoId));
        this.selectedRangoDescripcion = r ? r.Descripcion : null;
        const rId = String(rangoId);
        this.transferSvc.getPreciosPorRango(rId as any).subscribe({
          next: (rows) => {
            const monedaSel = this.form.get('Moneda')?.value || 'COP';
            const precioMoneda = rows.find((p: any) => p.MonedaCodigo === monedaSel);
            const precio = precioMoneda ? Number(precioMoneda.Precio) : (rows[0] ? Number(rows[0].Precio) : null);
            this.precioSeleccionado = precio;
            this.form.get('Valor')?.setValue(precio ?? 0);
            this.cdr.markForCheck();
          },
          error: () => {
            this.precioSeleccionado = null;
            this.form.get('Valor')?.setValue(0);
          }
        });
      });

    this.form.get('Moneda')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((mon) => {
        if (this.isHydrating) return;
        const rangoId = this.form.get('Rango')?.value;
        if (!rangoId || rangoId === 'Seleccionar') return;
        this.transferSvc.getPreciosPorRango(rangoId).subscribe({
          next: (rows) => {
            const precioMoneda = rows.find((p: any) => p.MonedaCodigo === mon);
            const precio = precioMoneda ? Number(precioMoneda.Precio) : (rows[0] ? Number(rows[0].Precio) : null);
            this.precioSeleccionado = precio;
            this.form.get('Valor')?.setValue(precio ?? 0);
            this.cdr.markForCheck();
          }, error: () => { }
        });
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
        this.navbar.alert.set({
          type: 'info',
          title: 'Recomendación',
          message: msg,
          autoClose: true,
          buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.alert.set(null) }]
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
          this.navbar.errorToast('Error', 'Transfer no encontrado.');
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

    this.isHydrating = true;
    try {
      // Llenar formulario con datos del transfer
      this.form.patchValue({
        Titular: transfer.Nombre_Titular || '',
        DNI: transfer.DNI || '',
        TelefonoTitular: transfer.Telefono_Titular || '',
        Rango: transfer.Id_Rango || 'Seleccionar',
        Moneda: transfer.MonedaCodigo || 'COP',
        TipoServicio: transfer.Id_Servicio || 'Seleccionar',
        Salida: transfer.Punto_Salida || '',
        Llegada: transfer.Punto_Destino || '',
        Fecha: transfer.Fecha_Transfer || '',
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

      // Actualizar descripciones
      const rangoId = this.form.get('Rango')?.value;
      if (rangoId && rangoId !== 'Seleccionar') {
        const r = this.resultsRangos.find(rr => String(rr.Id_Rango ?? rr.id) === String(rangoId));
        this.selectedRangoDescripcion = r ? r.Descripcion : null;
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
    }
  }

  async onSubmit(): Promise<void> {
    if (this.isSubmitting()) return;

    this.form.updateValueAndValidity({ emitEvent: false });
    if (this.form.invalid) {
      this.form.markAllAsTouched();

      const invalid = Object.keys(this.form.controls).filter(k => this.form.get(k)?.invalid);
      const friendly: Record<string, string> = {
        Titular: 'Titular',
        TelefonoTitular: 'Teléfono del titular (ej: +573001234567)',
        Rango: 'Rango de pasajeros',
        TipoServicio: 'Tipo de servicio',
        Salida: 'Punto de salida',
        Llegada: 'Punto de llegada',
        Fecha: 'Fecha del servicio',
        TipoVuelo: 'Tipo de vuelo',
        Vuelo: 'Número de vuelo',
        Reporta: 'Nombre del reportante',
        TelefonoReserva: 'Teléfono de reserva (ej: +573001234567)'
      };

      const fields = invalid.map(f => friendly[f] || f);
      const msg = fields.length ? `Revisa los siguientes campos: ${fields.join(', ')}` : 'Hay campos inválidos en el formulario.';

      this.navbar.alert.set({
        type: 'error',
        title: 'Campos requeridos incompletos',
        message: msg,
        autoClose: true,
        buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.alert.set(null) }]
      });
      return;
    }

    this.processSubmit();
  }

  private processSubmit(): void {
    this.isSubmitting.set(true);

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
            Observaciones: control.get('Observaciones')?.value || null,
            Fecha_Pago: control.get('Fecha_Pago')?.value || null,
            Pago_Comprobante: control.get('SoporteUrl')?.value || null
          }))
          .filter((abono) => abono.Monto > 0)
      : [];

    const pagoFinal: any = {
      Tipo: tipoPago,
      Observaciones: tipoPago === 'Completo' ? this.form.value.PagoObservaciones || null : null,
      Pago_Comprobante: tipoPago === 'Completo' ? pagoCompletoRutaActual : null,
      Abonos: abonosPayload
    };

    const transferData: any = {
      Titular: this.form.value.Titular,
      DNI: this.form.value.DNI || '',
      Tel_Contacto: this.form.value.TelefonoTitular || '',
      Id_Rango: this.form.value.Rango,
      RangoDescripcion: this.selectedRangoDescripcion,
      Servicio: this.form.value.TipoServicio,
      Salida: this.form.value.Salida,
      Llegada: this.form.value.Llegada,
      FechaTransfer: this.form.value.Fecha,
      NombreReporta: this.form.value.Reporta,
      HoraRecogida: this.form.value.Hora,
      Vuelo: this.form.value.Vuelo,
      TipoVuelo: this.form.value.TipoVuelo,
      TelefonoTransfer: this.form.value.TelefonoReserva || '',
      ValorServicio: this.form.value.Valor,
      Moneda: this.form.value.Moneda,
      Observaciones: this.form.value.Observaciones,
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
        this.navbar.warningToast('Advertencia', 'Transfer actualizado pero hubo problemas al guardar algunos comprobantes.');
        this.form.markAsPristine();
        this.isSubmitting.set(false);
        this.router.navigate(['/Transfers/VerTransfers']);
      });
  }

  private hasComprobantesToUpload(): boolean {
    const pagoCompletoFile = this.form.get('ComprobantePago')?.value;
    if (pagoCompletoFile instanceof File) return true;
    return this.abonos.controls.some(control => control.get('Comprobante')?.value instanceof File);
  }

  private finishSubmitSuccess(message: string): void {
    this.navbar.successToast('Transfer actualizado', message);
    this.form.markAsPristine();
    this.isSubmitting.set(false);
    this.router.navigate(['/Transfers/VerTransfers']);
  }

  ngOnDestroy(): void {
    if (this.navbar?.cuposInfo) this.navbar.cuposInfo.set(null);
    if (this.navbar?.alert) this.navbar.alert.set(null);
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
