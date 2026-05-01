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

  resultsServicioTransfer: any[] = [];
  resultsRangos: any[] = [];
  resultsMonedas: any[] = [];
  selectedRangoDescripcion: string | null = null;
  precioSeleccionado: number | null = null;
  showFlightFields = false;

  // Archivos de comprobantes
  pagoPagadoFile: File | null = null;
  pagoPagadoFileName: string | null = null;
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

  get abonos(): FormArray {
    return this.form.get('Abonos') as FormArray;
  }

  addAbono(): void {
    this.abonos.push(this.fb.group({
      Monto: ['', [Validators.required, Validators.min(0.01)]],
      Observaciones: [''],
      Fecha_Pago: ['']
    }));
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
      this.pagoPagadoFile = files[0];
      this.pagoPagadoFileName = files[0].name;
    }
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
    }
  }

  clearPagoCompletoFile(): void {
    this.pagoPagadoFile = null;
    this.pagoPagadoFileName = null;
    const input = document.getElementById('file-pago-completo') as HTMLInputElement;
    if (input) input.value = '';
  }

  clearAbonoFile(index: number): void {
    this.abonoFiles.delete(index);
    this.abonoFileNames.delete(index);
    const input = document.getElementById(`file-abono-${index}`) as HTMLInputElement;
    if (input) input.value = '';
  }

  getAbonoFileName(index: number): string | null {
    return this.abonoFileNames.get(index) || null;
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
      Abonos: this.fb.array([])
    });

    // Cargar catálogos y datos del transfer
    this.loadCatalogosAndTransferData();

    // Listeners para cambios
    this.form.get('Rango')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((rangoId) => {
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

    const transferId = this.route.snapshot.paramMap.get('id');
    if (!transferId) {
      this.navbar.errorToast('Error', 'ID de transfer no encontrado.');
      this.router.navigate(['/Transfers/VerTransfers']);
      return;
    }

    forkJoin({
      servicios: this.transferSvc.getServicios().pipe(catchError(() => of([]))),
      rangos: this.transferSvc.getRangos().pipe(catchError(() => of([]))),
      monedas: this.transferSvc.getMonedas().pipe(catchError(() => of([]))),
      transfer: this.transferSvc.getTransfer(transferId).pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ servicios, rangos, monedas, transfer }) => {
        this.resultsServicioTransfer = Array.isArray(servicios) ? servicios : [];
        this.resultsRangos = Array.isArray(rangos) ? rangos : [];
        this.resultsMonedas = Array.isArray(monedas) ? monedas : [];

        if (!transfer || !transfer.data?.transfer) {
          this.navbar.errorToast('Error', 'Transfer no encontrado.');
          this.router.navigate(['/Transfers/VerTransfers']);
          return;
        }

        this.fillFormWithTransferData(transfer.data);
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
    if (pagos.length === 0) {
      this.form.patchValue({ TipoPago: 'PagaEnPunto' }, { emitEvent: false });
    } else if (pagos.length === 1 && pagos[0].Metodo === 'Completo') {
      this.form.patchValue({ TipoPago: 'Completo' }, { emitEvent: false });
    } else {
      this.form.patchValue({ TipoPago: 'Abonos' }, { emitEvent: false });
      // Llenar abonos
      const abonosArray = this.form.get('Abonos') as FormArray;
      abonosArray.clear();
      pagos.forEach((pago: any) => {
        if (pago.Metodo === 'Abono' || pago.Metodo === 'Paga en punto') {
          abonosArray.push(this.fb.group({
            Monto: [Number(pago.Monto || 0)],
            Observaciones: [pago.Observaciones || ''],
            Fecha_Pago: [pago.Fecha_Pago || '']
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

    const transferId = this.route.snapshot.paramMap.get('id');
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

    const transferData = {
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
      Estado: 'Confirmada',
      Pago: {
        Tipo: this.form.value.TipoPago,
        Abonos: this.form.value.TipoPago === 'Abonos' ? this.form.value.Abonos : []
      }
    };

    this.transferSvc.actualizarTransfer(transferId, transferData).subscribe({
      next: (data) => {
        this.navbar.successToast('Transfer actualizado', 'Transfer actualizado correctamente.');
        this.form.markAsPristine();
        this.isSubmitting.set(false);
        this.router.navigate(['/Transfers/VerTransfers']);
      },
      error: (err) => {
        console.error('Error:', err);
        this.navbar.errorToast('Error', 'Hubo un error al actualizar el transfer.');
        this.isSubmitting.set(false);
      }
    });
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
