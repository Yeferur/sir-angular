import { Component, OnInit, signal, ChangeDetectorRef } from '@angular/core';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import { firstValueFrom } from 'rxjs';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { TransferService } from '../../../services/Transfers/transfers';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';
@Component({
  selector: 'app-crear-transfer',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, FlatpickrInputDirective],
  templateUrl: './crear-transfer.html',
  styleUrls: ['./crear-transfer.css']
})
export class CrearTransferComponent implements OnInit {
  form!: FormGroup;

  openSummary = false;
  isLoading = signal<boolean>(true);

  resultsServicioTransfer: any[] = [];
  servicioLoading = true;
  resultsRangos: any[] = [];
  resultsMonedas: any[] = [];
  selectedRangoDescripcion: string | null = null;
  precioSeleccionado: number | null = null;
  showFlightFields = false;

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
    private navbar: DynamicIslandGlobalService,
    private transferSvc: TransferService,
    private cdr: ChangeDetectorRef,
  ) { }

  toggleSummary(force?: boolean) {
    this.openSummary = typeof force === 'boolean' ? force : !this.openSummary;
  }

  public getNombreServicio(): string {
    const id = this.form?.get('TipoServicio')?.value;
    const servicio = this.resultsServicioTransfer.find(s => String(s.id) === String(id));
    return servicio ? servicio.Servicio : '—';
  }

  ngOnInit(): void {
    this.form = this.fb.group({
      Titular: ['', Validators.required],
      IndicativoTitular: [''],
      TelefonoTitular: [''],
      Rango: ['Seleccionar', Validators.required],
      Moneda: ['COP'],
      TipoServicio: ['Seleccionar', Validators.required],
      Salida: ['', Validators.required],
      Llegada: ['', Validators.required],
      Fecha: ['', Validators.required],
      Hora: [''],
      TipoVuelo: [''],
      Reporta: ['', Validators.required],
      Vuelo: [''],
      Valor: [0],
      IndicativoReserva: [''],
      TelefonoReserva: ['', Validators.required],
      Observaciones: ['']
    });

    this.loadServicios();
    this.loadRangos();
    this.loadMonedas();
    // escuchar cambio de rango para obtener precio inmediato
    this.form.get('Rango')?.valueChanges.subscribe((rangoId) => {
      if (!rangoId || rangoId === 'Seleccionar') {
        this.selectedRangoDescripcion = null;
        this.precioSeleccionado = null;
        this.form.get('Valor')?.setValue(0);
        return;
      }
      const r = this.resultsRangos.find(rr => String(rr.id) === String(rangoId));
      this.selectedRangoDescripcion = r ? r.Descripcion : null;
      // pedir precios por rango
      this.transferSvc.getPreciosPorRango(rangoId).subscribe({
        next: (rows) => {
          // buscar precio según moneda seleccionada
          const monedaSel = this.form.get('Moneda')?.value || 'COP';
          const precioMoneda = rows.find((p: any) => p.MonedaCodigo === monedaSel);
          const precio = precioMoneda ? Number(precioMoneda.Precio) : (rows[0] ? Number(rows[0].Precio) : null);
          this.precioSeleccionado = precio;
          this.form.get('Valor')?.setValue(precio ?? 0);
          // evitar ExpressionChangedAfterItHasBeenCheckedError
          try { this.cdr.detectChanges(); } catch { /* noop */ }
        },
        error: () => {
          this.precioSeleccionado = null;
          this.form.get('Valor')?.setValue(0);
        }
      });
    });
    // reacción a cambio de moneda: si hay rango seleccionado, reconsultar precios
    this.form.get('Moneda')?.valueChanges.subscribe((mon) => {
      const rangoId = this.form.get('Rango')?.value;
      if (!rangoId || rangoId === 'Seleccionar') return;
      this.transferSvc.getPreciosPorRango(rangoId).subscribe({
        next: (rows) => {
          const precioMoneda = rows.find((p: any) => p.MonedaCodigo === mon);
          const precio = precioMoneda ? Number(precioMoneda.Precio) : (rows[0] ? Number(rows[0].Precio) : null);
          this.precioSeleccionado = precio;
          this.form.get('Valor')?.setValue(precio ?? 0);
          try { this.cdr.detectChanges(); } catch { }
        }, error: () => { /* ignore */ }
      });
    });
    // detectar cuando el tipo de servicio cambia para activar campos de vuelo
    this.form.get('TipoServicio')?.valueChanges.subscribe((serviceId) => {
      const nombre = this.resultsServicioTransfer.find(s => String(s.id) === String(serviceId))?.Servicio || '';
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
    this.form.get('TipoVuelo')?.valueChanges.subscribe((tipo) => {
      if (!this.showFlightFields) return;
      const msg = tipo === 'Internacional'
        ? 'Para vuelos internacionales se recomienda 4 horas de anticipación con el titular.'
        : 'Para vuelos nacionales se recomienda 2 horas de anticipación con el titular.';
      this.navbar.alert.set({ title: 'Anticipación recomendada', type: 'info', message: msg, autoClose: true });
    });
  }

  checkWhatsappForReserva(): void {
    const indic = this.form.get('IndicativoReserva')?.value || '';
    const tel = this.form.get('TelefonoReserva')?.value || '';
    const full = `${indic}${tel}`.replace(/\s+/g, '');
    if (!tel) {
      this.navbar.alert.set({ title: 'Número no válido', type: 'warning', message: 'Ingresa un teléfono para verificar.', autoClose: true });
      return;
    }

    this.transferSvc.checkWhatsApp(full).subscribe({
      next: (res) => {
        if (res?.disabled) {
          this.navbar.alert.set({ title: 'Verificación WhatsApp', type: 'info', message: 'Verificación deshabilitada temporalmente', autoClose: true });
        } else {
          const exists = !!res?.exists;
          this.navbar.alert.set({ title: 'Verificación WhatsApp', type: exists ? 'success' : 'info', message: exists ? 'Número con WhatsApp' : 'Número no encontrado en WhatsApp', autoClose: true });
        }
      },
      error: (err) => {
        this.navbar.alert.set({ title: 'Error verificación', type: 'error', message: (err as any)?.message || 'Error al verificar WhatsApp', autoClose: true });
      }
    });
  }

  private loadRangos(): void {
    this.transferSvc.getRangos().subscribe({
      next: (data) => { this.resultsRangos = Array.isArray(data) ? data : []; },
      error: () => { /* ignore silently for now */ }
    });
  }

  private loadMonedas(): void {
    this.transferSvc.getMonedas().subscribe({
      next: (data) => {
        this.resultsMonedas = Array.isArray(data) ? data : [];
        // set default moneda if existe COP
        const hasCOP = this.resultsMonedas.find((m: any) => m.Codigo === 'COP');
        const defaultMon = hasCOP ? 'COP' : (this.resultsMonedas[0]?.Codigo || 'COP');
        this.form.get('Moneda')?.setValue(defaultMon);
      },
      error: () => { /* ignore */ }
    });
  }

  // removed recommended pickup/time validation: only show advisory alerts for TipoVuelo

  private loadServicios(): void {
    this.servicioLoading = true;
    this.isLoading.set(true);

    this.transferSvc.getServicios().subscribe({
      next: (data) => { this.resultsServicioTransfer = Array.isArray(data) ? data : []; },
      error: () => {
        this.navbar.alert.set({ title: 'Error', type: 'error', message: 'No se pudieron cargar los servicios de transfer.', autoClose: true });
      },
      complete: () => { this.servicioLoading = false; this.isLoading.set(false); }
    });
  }

  async onSubmit(): Promise<void> {
    this.form.updateValueAndValidity({ emitEvent: false });
    if (this.form.invalid) {
      this.form.markAllAsTouched();

      const invalid = Object.keys(this.form.controls).filter(k => this.form.get(k)?.invalid);
      const friendly: Record<string, string> = {
        Titular: 'Titular',
        Rango: 'Rango de pasajeros',
        TipoServicio: 'Tipo de servicio',
        Salida: 'Punto de salida',
        Llegada: 'Punto de llegada',
        Fecha: 'Fecha del servicio',
        TipoVuelo: 'Tipo de vuelo',
        Vuelo: 'Número de vuelo',
        Reporta: 'Nombre del reportante',
        TelefonoReserva: 'Teléfono de reserva'
      };

      const fields = invalid.map(f => friendly[f] || f);
      const msg = fields.length ? `Revisa los siguientes campos: ${fields.join(', ')}` : 'Hay campos inválidos en el formulario.';

      this.navbar.alert.set({
        type: 'error',
        title: 'Campos inválidos',
        message: msg,
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) }]
      });
      return;
    }

    // Verificar WhatsApp del reportante antes de mostrar confirmación
    const indic = this.form.get('IndicativoReserva')?.value || '';
    const tel = this.form.get('TelefonoReserva')?.value || '';
    const full = `${indic}${tel}`.replace(/\s+/g, '');
    if (!tel) {
      this.navbar.alert.set({ title: 'Número no válido', type: 'warning', message: 'Ingresa un teléfono para verificar.', autoClose: true });
      return;
    }

    try {
      const res = await firstValueFrom(this.transferSvc.checkWhatsApp(full));
      if (!res?.disabled) {
        const exists = !!res?.exists;
        if (!exists) {
          this.navbar.alert.set({
            title: 'WhatsApp no disponible',
            type: 'error',
            message: 'El número de reserva no parece tener WhatsApp. Verifica antes de guardar.',
            autoClose: false,
          });
          return;
        }
      }
    } catch (err) {
      this.navbar.alert.set({
        title: 'Error verificación',
        type: 'error',
        message: (err as any)?.message || 'Error al verificar WhatsApp',
        autoClose: false,
        buttons: [
          { text: 'Reintentar', style: 'primary', onClick: () => { this.navbar.alert.set(null); this.onSubmit(); } },
          { text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) }
        ]
      });
      return;
    }

    this.navbar.alert.set({
      title: '¿Crear transfer?',
      type: 'warning',
      message: '¿Deseas crear este transfer?',
      buttons: [
        { text: 'Cancelar', style: 'secondary', onClick: () => this.navbar.alert.set(null) },
        { text: 'Sí, crear', style: 'primary', onClick: () => this.processSubmit() }
      ]
    });
  }

  private processSubmit(): void {
    this.navbar.alert.set({
      title: 'Creando transfer...',
      message: 'Por favor espera.',
      loading: true,
      autoClose: false
    });

    const resolverEstadoYMotivo = (vals: any) => {
      const faltan: string[] = [];
      if (!vals.Titular) faltan.push('titular');
      if (!vals.Rango || vals.Rango === 'Seleccionar') faltan.push('rango de pasajeros');
      if (!vals.Salida) faltan.push('punto de salida');
      if (!vals.Llegada) faltan.push('punto de llegada');
      if (!vals.Fecha) faltan.push('fecha');
      if (!vals.Reporta) faltan.push('reporta');
      if (!vals.TelefonoReserva) faltan.push('teléfono de reserva');

      if (faltan.length > 0) {
        return { estado: 'Pendiente', subestado: 'de datos', motivo: `Faltan: ${faltan.join('; ')}` };
      }

      if (vals.Valor && Number(vals.Valor) > 0) {
        return { estado: 'Confirmada', subestado: null, motivo: 'Valor registrado.' };
      }

      return { estado: 'Pendiente', subestado: 'de pago', motivo: 'Sin valor registrado.' };
    };

    const estadoInfo = resolverEstadoYMotivo(this.form.value);

    // validar campos de vuelo si aplica (se requiere tipo y número de vuelo)
    if (this.showFlightFields) {
      if (!this.form.value.Vuelo || !this.form.value.TipoVuelo) {
        this.navbar.alert.set({ title: 'Falta información de vuelo', type: 'warning', message: 'Completa tipo de vuelo y número de vuelo.', autoClose: true });
        return;
      }
    }

    const transferData = {
      Id_Transfer: `TR-${Math.floor(10000 + Math.random() * 90000)}`,
      Titular: this.form.value.Titular,
      Tel_Contacto: `${this.form.value.IndicativoTitular || ''}${this.form.value.TelefonoTitular || ''}`,
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
      TelefonoTransfer: `${this.form.value.IndicativoReserva || ''}${this.form.value.TelefonoReserva || ''}`,
      ValorServicio: this.form.value.Valor,
      Moneda: this.form.value.Moneda,
      Observaciones: [this.form.value.Observaciones, `EstadoMotivo: ${estadoInfo.motivo}`].filter(Boolean).join('\n'),
      Estado: estadoInfo.estado,
    };

    this.transferSvc.crearTransfer(transferData).subscribe({
      next: (data) => {
        this.navbar.alert.set({
          title: 'Transfer creado',
          type: 'success',
          message: data?.message || 'Transfer creado correctamente.',
          autoClose: true
        });

        this.form.reset({
          TipoServicio: 'Seleccionar',
          Rango: 'Seleccionar',
          Moneda: 'COP',
          Valor: 0
        });

        this.toggleSummary(false);
      },
      error: () => {
        this.navbar.alert.set({
          title: 'Error',
          type: 'error',
          message: 'Hubo un error al crear el transfer.',
          autoClose: true
        });
      },
      complete: () => {
        // si tu navbar usa alert modal, este null lo cierra
        // pero ojo: si estás mostrando success con autoClose, puedes dejarlo quieto
      }
    });
  }
}
