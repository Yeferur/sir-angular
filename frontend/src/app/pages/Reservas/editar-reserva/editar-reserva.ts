import { Component, OnInit, ChangeDetectorRef, inject, signal, computed, effect, Injector, runInInjectionContext } from '@angular/core';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from '../../../../environments/environment';
import { ActivatedRoute } from '@angular/router';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { WebSocketService } from '../../../services/WebSocket/web-socket';
import {
  Reservas, Tour, Canal, Moneda, Plan, Horario, PrecioMap, Punto, ReservaHistorialCambio,
} from '../../../services/Reservas/reservas';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { DuplicarPanelComponent } from '../../../DynamicNavbar/duplicar-panel/duplicar-panel';
import { TourRulesService } from '../../../services/Reservas/tour-rules.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-editar-reserva',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DecimalPipe, DatePipe, FlatpickrInputDirective],
  templateUrl: './editar-reserva.html',
  styleUrls: ['./editar-reserva.css'],
})
export class EditarReservaComponent implements OnInit {
showDuplicate: boolean = false;
  openSummary = false;
  private readonly e164WithTenDigitsPattern = /^\+[1-9]\d{10,12}$/;

  toggleSummary(force?: boolean) {
    this.openSummary = typeof force === 'boolean' ? force : !this.openSummary;
  }


  private wsService = inject(WebSocketService);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);
  private reservasSvc = inject(Reservas);
  private navbar = inject(DynamicIslandGlobalService);
  private route = inject(ActivatedRoute);
  private sanitizer = inject(DomSanitizer);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);
  private tourRules = inject(TourRulesService);

  // Estado
  isLoading = signal<boolean>(true);
  isSubmitting = signal<boolean>(false);
  reservaId = signal<string | null>(null);
  form!: FormGroup;

  // Catálogos
  tours = signal<Tour[]>([]);
  canales = signal<Canal[]>([]);
  monedas = signal<Moneda[]>([]);
  planes = signal<Plan[]>([]);

  // Horario auto (tour + punto principal)
  horarioSeleccionado = signal<Horario | null>(null);

  // Precios por tipo (referencia del plan/moneda)
  preciosRef = signal<PrecioMap>({});

  // Código de moneda para UI
  monedaCodigo = computed(() => {
    const id = this.form?.get('Id_Moneda')?.value;
    const m = this.monedas().find(x => x.Id_Moneda === Number(id));
    return m?.Codigo || 'COP';
  });

  isRioClaroTour(): boolean {
    const idTour = Number(this.form?.get('SelectTour')?.value || 0);
    if (!idTour) return false;

    const tour = this.tours().find((t) => Number(t.Id_Tour) === idTour);
    if (!tour) return idTour === 1;

    const nombre = String((tour as any).Nombre_Tour || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    const abreviacion = String((tour as any).Abreviacion || '').toUpperCase();

    return idTour === 1 || nombre.includes('RIO CLARO') || abreviacion === 'TRC';
  }

  // Puntos de encuentro (chips + búsqueda)
  puntosSeleccionados = signal<Punto[]>([]);
  puntoBusquedaResults = signal<Punto[]>([]);
  private conflictoRutasNotificado = signal<boolean>(false);
  rutasLogisticasSeleccionadas = computed(() => {
    const rutas = new Set(
      this.puntosSeleccionados()
        .map((p) => this.normalizarRutaLogistica((p as any)?.ruta))
        .filter((r) => r !== '' && r !== '0' && r !== 'PENDIENTE')
    );
    return Array.from(rutas);
  });
  distanciaMaximaPuntosLogisticosKm = computed(() => {
    const puntos = this.puntosSeleccionados().filter((p) => {
      const ruta = this.normalizarRutaLogistica((p as any)?.ruta);
      return this.tieneCoordenadasLogisticas(p) && ruta !== '' && ruta !== '0' && ruta !== 'PENDIENTE';
    });
    let max = 0;

    for (let i = 0; i < puntos.length; i++) {
      const p1 = puntos[i];
      const ruta1 = this.normalizarRutaLogistica((p1 as any)?.ruta);
      const lat1 = Number((p1 as any)?.Latitud);
      const lon1 = Number((p1 as any)?.Longitud);

      for (let j = i + 1; j < puntos.length; j++) {
        const p2 = puntos[j];
        const ruta2 = this.normalizarRutaLogistica((p2 as any)?.ruta);
        if (!ruta1 || !ruta2 || ruta1 === ruta2) continue;
        const lat2 = Number((p2 as any)?.Latitud);
        const lon2 = Number((p2 as any)?.Longitud);
        const distancia = this.distanciaHaversineKm(lat1, lon1, lat2, lon2);
        if (distancia > max) max = distancia;
      }
    }

    return max;
  });
  tieneConflictoRutasLogisticas = computed(() => this.rutasLogisticasSeleccionadas().length > 1);
  tieneConflictoDistanciaLogistica = computed(() => this.distanciaMaximaPuntosLogisticosKm() > 6);
  tieneConflictoLogistico = computed(() => this.tieneConflictoRutasLogisticas() || this.tieneConflictoDistanciaLogistica());
  mensajeInviabilidadLogistica = computed(() => {
    const mensajes: string[] = [];
    if (this.tieneConflictoRutasLogisticas()) {
      mensajes.push('Los puntos seleccionados pertenecen a rutas distintas.');
    }
    if (this.tieneConflictoDistanciaLogistica()) {
      mensajes.push(`La distancia máxima entre puntos de rutas distintas supera 6 km (${this.distanciaMaximaPuntosLogisticosKm().toFixed(1)} km).`);
    }
    return mensajes.join(' ');
  });

  private normalizarRutaLogistica(ruta: unknown): string {
    return String(ruta ?? '').trim().toUpperCase();
  }

  private tieneCoordenadasLogisticas(punto: Punto): boolean {
    const lat = Number((punto as any)?.Latitud);
    const lon = Number((punto as any)?.Longitud);
    return Number.isFinite(lat) && Number.isFinite(lon);
  }

  private distanciaHaversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const radiusKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return radiusKm * c;
  }

  private evaluarConflictoRutasEnTiempoReal(): void {
    const hayConflicto = this.tieneConflictoLogistico();
    if (hayConflicto && !this.conflictoRutasNotificado()) {
      this.navbar.alert.set({
        type: 'warning',
        title: 'Inviabilidad logística detectada',
        message: this.mensajeInviabilidadLogistica() || 'Los puntos seleccionados no cumplen la validación logística.',
        autoClose: true,
      });
    }
    this.conflictoRutasNotificado.set(hayConflicto);
  }

  historialActividad = signal<ReservaHistorialCambio[]>([]);
  historialLoading = signal<boolean>(false);
  historialError = signal<string | null>(null);
  historialTimeline = computed(() =>
    [...this.historialActividad()].sort(
      (a, b) => new Date(b.Fecha_Registro).getTime() - new Date(a.Fecha_Registro).getTime()
    )
  );

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

  // Snapshot original (útil si necesitas comparar cambios o saldo histórico)
  private originalReserva: any = null;
  // Modo creado desde duplicado
  private isDuplicateMode = false;

  async ngOnInit(): Promise<void> {
    // Estructura del form (idéntica a crear, pero la usaremos solo para editar)
    this.form = this.fb.group({
      // Cabecera
      SelectTour: [{ value: '', disabled: false }, Validators.required],
      Id_Plan: [{ value: '', disabled: false }],
      Fecha_Tour: [null, Validators.required],
      Id_Horario: [null],
      Idioma_Reserva: ['ESPAÑOL'],
      Id_Moneda: [{ value: 1, disabled: false }, Validators.required],

      // Responsable
      Id_Canal: [1, Validators.required],
      Nombre_Reportante: ['', Validators.required],
      Telefono_Reportante: ['', [Validators.required, Validators.pattern(this.e164WithTenDigitsPattern)]],
      Observaciones: [''],

      // Tipo
      Tipo_Reserva: ['Grupal', Validators.required],

      // Colecciones
      Pasajeros: this.fb.array([]),

      // Pagos
      FormaPago: ['Directo'],
      Abonos: this.fb.array([]),
      ComisionInternacional: [0],

      // Punto principal
      Id_Punto: [null, Validators.required],

      // Comprobante (pago completo)
      ComprobantePago: [null],
    });
    this.wsService.messages$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((msg: any) => {
        const fecha = this.form.get('Fecha_Tour')?.value;
        const tour = this.form.get('SelectTour')?.value;
        if ((msg?.type === 'reservaCreada' || msg?.type === 'reservaActualizada') && msg?.Fecha_Tour === fecha && msg?.Id_Tour == tour) {
          this.CuposDisponiblesNavbar();
        }
    });
    try {
      // 1) catálogos en paralelo
      const [tours, canales, monedas] = await Promise.all([
        firstValueFrom(this.reservasSvc.getTours()),
        firstValueFrom(this.reservasSvc.getCanales()),
        firstValueFrom(this.reservasSvc.getMonedas()),
      ]);
      this.tours.set(tours || []);
      this.canales.set(canales || []);
      this.monedas.set(monedas || []);
    } catch {
      this.navbar.alert.set({
        type: 'error',
        title: 'Error cargando datos',
        message: 'No fue posible cargar Tours, Canales o Monedas.',
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) }],
      });
    }

    // 2) leer parámetro de ruta (usa :Id_Reserva en tus rutas)
    const idParam = this.route.snapshot.paramMap.get('Id_Reserva') ?? this.route.snapshot.paramMap.get('id');
    const id = idParam;

    if (!id) {
      this.isLoading.set(false);
      this.navbar.alert.set({
        type: 'warning',
        title: 'ID de reserva inválido',
        message: 'No se recibió Id_Reserva en la ruta.',
        autoClose: true,
      });
      return;
    }

    this.reservaId.set(id);
    await this.cargarReservaExistente(id);
    await this.cargarHistorialActividad(id);

    // Además, escuchar cambios en los parámetros de la ruta si Angular reutiliza el componente
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(pm => {
        const newId = pm.get('Id_Reserva') ?? pm.get('id');
        if (newId && newId !== this.reservaId()) {
          this.reservaId.set(newId);
          Promise.all([
            this.cargarReservaExistente(newId),
            this.cargarHistorialActividad(newId),
          ]).then(() => this.cdr.markForCheck());
        }
    });

    // React to Id_Reserva changes from the Dynamic Navbar: if user clicks "Editar" there,
    // the navbar service will set Id_Reserva; when it changes, reload this editor with the new id.
    runInInjectionContext(this.injector, () => effect(() => {
      const navId = this.navbar.Id_Reserva();
      if (navId && navId !== this.reservaId()) {
        // load new reservation into the editor
        this.reservaId.set(navId);
        Promise.all([
          this.cargarReservaExistente(navId),
          this.cargarHistorialActividad(navId),
        ]).then(() => this.cdr.markForCheck());
      }
    }));

    this.isLoading.set(false);
    this.cdr.markForCheck();
  }

  // ===== Getters =====
  get pasajeros(): FormArray { return this.form.get('Pasajeros') as FormArray; }
  get abonos(): FormArray { return this.form.get('Abonos') as FormArray; }

  // ===================== Carga / hidratación =====================
  private async cargarReservaExistente(id: string) {
    this.isLoading.set(true);
    try {
      // Ajusta este método según tu servicio:
      // getReservaDetalle(id) o getReserva(id)
      const data = await firstValueFrom(this.reservasSvc.getReservaDetalle?.(id) ?? this.reservasSvc.getReserva(id));

      this.originalReserva = structuredClone(data);
      // Cabecera
      this.form.patchValue({
        SelectTour: data?.Cabecera?.Id_Tour ?? data?.Id_Tour ?? '',
        Id_Plan: data?.Cabecera?.Id_Plan ?? data?.Id_Plan ?? '',
        Fecha_Tour: data?.Cabecera?.Fecha_Tour ?? data?.FechaReserva ?? '',
        Id_Horario: data?.Cabecera?.Id_Horario ?? data?.Id_Horario ?? '',
        Idioma_Reserva: data?.Cabecera?.Idioma_Reserva ?? data?.IdiomaReserva ?? 'ESPAÑOL',
        Id_Moneda: data?.Cabecera?.Id_Moneda ?? data?.Id_Moneda ?? 1,
        Id_Canal: data?.Cabecera?.Id_Canal ?? data?.Id_Canal ?? 1,
        Nombre_Reportante: data?.Cabecera?.Nombre_Reportante ?? data?.Reportante?.Nombre ?? '',
        Telefono_Reportante: data?.Cabecera?.Telefono_Reportante ?? data?.Reportante?.Telefono ?? '',
        Observaciones: data?.Cabecera?.Observaciones ?? data?.Observaciones ?? '',
        Tipo_Reserva: data?.Cabecera?.Tipo_Reserva ?? data?.Tipo_Reserva ?? 'Grupal',
        // Forma de pago deducida del histórico
        FormaPago: this.deduceFormaPago(data?.Pagos),
        ComisionInternacional: data?.Cabecera?.ComisionInternacional ?? data?.ComisionInternacional ?? 0,
        Id_Punto: data?.Cabecera?.Id_Punto ?? data?.Id_Punto ?? null,
        ComprobantePago: null, // no se puede rehidratar un File
      }, { emitEvent: false });



      // Planes y preciosRef para poder calcular totales/sidebar
      const idTour = Number(this.form.get('SelectTour')?.value);
      if (idTour) {
        const planes = await firstValueFrom(this.reservasSvc.getPlanesByTour(idTour));
        this.planes.set(planes || []);
        await this.onPlanMonedaChange(true); // solo cargar preciosRef
      }

      // Puntos seleccionados (chip principal)
      const puntoId = this.form.get('Id_Punto')?.value;
      console.log('Punto principal ID:', puntoId);
      if (puntoId) {
        const principal = await firstValueFrom(this.reservasSvc.getPuntoById(puntoId));
        if (principal) this.puntosSeleccionados.set([principal]);
      }

      // Horario auto
      await this.fijarHorarioAutomatico();

      // Pasajeros: reconstruir EXACTO desde DB y marcar precios como dirty
      this.pasajeros.clear();
      const listaPax = data?.Pasajeros ?? data?.Detalle?.Pasajeros ?? [];
      for (const p of listaPax) {
        const fg = this.fb.group({
          Tipo_Pasajero: [p.Tipo_Pasajero ?? p.TipoPasajero ?? 'ADULTO', Validators.required],
          Nombre_Pasajero: [p.Nombre_Pasajero ?? p.NombrePasajero ?? ''],
          DNI: [p.DNI ?? p.IdPas ?? ''],
          Telefono_Pasajero: [p.Telefono_Pasajero ?? p.TelefonoPasajero ?? '', [Validators.pattern(/^(\+[1-9]\d{10,12})?$/)]],
          Id_Punto: [p.Id_Punto ?? puntoId ?? null],
          Confirmacion: [p.Confirmacion ?? false],
          PrecioRef: [p.Precio_Tour ?? p.PrecioRef ?? 0],
          Precio_Pasajero: [p.Precio_Pasajero ?? 0, [Validators.min(0)]],
          Comision: [typeof p.Comision === 'number' ? p.Comision : 0], // SIEMPRE la de la BD al cargar
        });
        // evita que autollenarPrecios reescriba lo traído de DB
        fg.get('Precio_Pasajero')?.markAsDirty();
        fg.get('Comision')?.markAsDirty();
        this.pasajeros.push(fg);
      }

      // Pagos: hidratar tipo de pago y comprobantes
      this.abonos.clear();
      const pagosDb = data?.Pagos ?? [];
      // Detectar tipo de pago principal
      let tipoPagoForm: 'Directo' | 'Completo' | 'Abono' = 'Directo';
      if (pagosDb.some((p: any) => p.Tipo === 'Pago Completo')) tipoPagoForm = 'Completo';
      else if (pagosDb.some((p: any) => p.Tipo === 'Abono')) tipoPagoForm = 'Abono';
      this.form.get('FormaPago')?.setValue(tipoPagoForm, { emitEvent: false });

      // Si es pago completo, rellenar comprobante
      if (tipoPagoForm === 'Completo') {
        const pagoCompleto = pagosDb.find((p: any) => p.Tipo === 'Pago Completo');
        if (pagoCompleto) {
          this.form.get('ComprobantePago')?.setValue({
            Id_Pago: pagoCompleto.Id_Pago || null,
            SoporteUrl: pagoCompleto.Ruta_Comprobante || pagoCompleto.SoporteUrl || null,
          });
        }
      }

      // Si hay abonos, rellenar el array
      if (tipoPagoForm === 'Abono') {
        const abonosDb = pagosDb.filter((p: any) => p.Tipo === 'Abono');
        for (const abono of abonosDb) {
          const fg = this.fb.group({
            Monto: [abono.Monto || 0],
            Comprobante: [null], // No se puede rehidratar el archivo
            SoporteUrl: [abono.Ruta_Comprobante || abono.SoporteUrl || null]
          });
          this.abonos.push(fg);
        }
      }



      // Activar verificación de cupos y comisiones después de llenar el formulario
      await this.verificarCuposDisponibles();
      this.CuposDisponiblesNavbar();
      await this.recalcularComisionesPorCanal();
      this.cdr.markForCheck();
    } catch (e) {
      console.error(e);
      this.navbar.alert.set({
        type: 'error',
        title: 'Error al cargar reserva',
        message: 'No se pudo cargar la reserva para edición.',
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) }],
      });
    } finally {
      this.isLoading.set(false);
    }
  }

  private deduceFormaPago(pagos: Array<{ Tipo: string }> | undefined): 'Directo' | 'Completo' | 'Abono' {
    if (!pagos?.length) return 'Directo';
    if (pagos.some(p => p.Tipo === 'Pago Completo')) return 'Completo';
    if (pagos.some(p => p.Tipo === 'Abono')) return 'Abono';
    return 'Directo';
  }

  private async cargarHistorialActividad(id: string): Promise<void> {
    this.historialLoading.set(true);
    this.historialError.set(null);

    try {
      const timeline = await firstValueFrom(this.reservasSvc.getReservaHistorial(id, 30));
      this.historialActividad.set(timeline || []);
    } catch (e) {
      console.error('Error cargando historial forense de reserva:', e);
      this.historialActividad.set([]);
      this.historialError.set('No se pudo cargar el historial de actividad.');
    } finally {
      this.historialLoading.set(false);
    }
  }

  // ===================== Abonos helpers =====================
  private crearAbonoGroup(): FormGroup {
    return this.fb.group({
      Monto: [0],
      Comprobante: [null], // File
    });
  }
  agregarAbono() { this.abonos.push(this.crearAbonoGroup()); }
  eliminarAbono(i: number) { this.abonos.removeAt(i); }
  totalAbonos(): number {
    return this.abonos.controls.reduce((acc, g: any) =>
      acc + Number(g.get('Monto')?.value || 0), 0);
  }
  get abonosValidos(): boolean {
    const total = this.totalNeto() + Number(this.form.get('ComisionInternacional')?.value || 0);
    return this.totalAbonos() <= total;
  }

  // ===================== Puntos: búsqueda / selección =====================
  async onPuntoSearch(ev: Event) {
    const term = (ev.target as HTMLInputElement)?.value?.trim() || '';
    if (term.length < 2) { this.puntoBusquedaResults.set([]); return; }
    try {
      const results = await firstValueFrom(this.reservasSvc.buscarPuntos(term));
      this.puntoBusquedaResults.set(results || []);
    } catch {
      this.puntoBusquedaResults.set([]);
      this.navbar.alert.set({ type: 'error', title: 'Error buscando puntos', message: 'No fue posible obtener los puntos de encuentro.', autoClose: true });
    }
  }
  async seleccionarPunto(p: Punto, input: HTMLInputElement) {
    if (!p) return;
    if (this.puntosSeleccionados().some(x => x.Id_Punto === p.Id_Punto)) return;
    if (this.puntosSeleccionados().length >= 3) return;
    this.puntosSeleccionados.update(arr => [...arr, p]);
    input.value = '';
    this.puntoBusquedaResults.set([]);
    const principal = this.puntosSeleccionados()[0];
    this.form.get('Id_Punto')?.setValue(principal?.Id_Punto ?? null);
    this.evaluarConflictoRutasEnTiempoReal();
    await this.fijarHorarioAutomatico();
    this.verificarCuposDisponibles();
  }
  async eliminarPunto(p: Punto) {
    this.puntosSeleccionados.update(arr => arr.filter(x => x.Id_Punto !== p.Id_Punto));
    const principal = this.puntosSeleccionados()[0] || null;
    this.form.get('Id_Punto')?.setValue(principal?.Id_Punto ?? null);
    if (!principal) {
      this.horarioSeleccionado.set(null);
      this.form.get('Id_Horario')?.setValue(null);
    } else {
      await this.fijarHorarioAutomatico();
    }
    this.evaluarConflictoRutasEnTiempoReal();
    this.verificarCuposDisponibles();
  }

  // ===================== Horario auto =====================
  private async fijarHorarioAutomatico() {
    const Id_Tour = Number(this.form.get('SelectTour')?.value);
    const principal = this.puntosSeleccionados()[0];
    const Id_Punto = principal?.Id_Punto ?? null;
    if (!Id_Tour || !Id_Punto) {
      this.horarioSeleccionado.set(null);
      this.form.get('Id_Horario')?.setValue(null);
      return;
    }
    try {
      const horario = await firstValueFrom(this.reservasSvc.getHorarioPorPunto(Id_Punto, Id_Tour));
      if (horario?.Id_Horario) {
        this.horarioSeleccionado.set(horario);
        this.form.get('Id_Horario')?.setValue(horario.Id_Horario);
      } else {
        this.horarioSeleccionado.set(null);
        this.form.get('Id_Horario')?.setValue(null);
        this.navbar.alert.set({ type: 'warning', title: 'Sin horario', message: 'No se encontró horario para el punto principal con el tour seleccionado.', autoClose: true });
      }
    } catch {
      this.horarioSeleccionado.set(null);
      this.form.get('Id_Horario')?.setValue(null);
      this.navbar.alert.set({ type: 'error', title: 'Error al asignar horario', message: 'No fue posible obtener el horario del punto principal.', autoClose: false });
    }
  }

  // ===================== Cambios Tour/Plan/Moneda =====================
  async onTourChange() {
    const idTour = Number(this.form.get('SelectTour')?.value);
    this.form.patchValue({ Id_Plan: null, Id_Horario: null });
    this.horarioSeleccionado.set(null);
    this.preciosRef.set({});
    if (!idTour) return;

    try {
      const planes = await firstValueFrom(this.reservasSvc.getPlanesByTour(idTour));
      this.planes.set(planes || []);
      if (this.planes().length === 1) this.form.get('Id_Plan')?.setValue(this.planes()[0].Id_Plan);

      if (!this.form.get('Id_Moneda')?.value) this.form.get('Id_Moneda')?.setValue(1, { emitEvent: false });

      this.recalcularComisionesPorCanal();
      await this.fijarHorarioAutomatico();
      await this.onPlanMonedaChange(true);
      // IMPORTANTE: en edición, respeta precios traídos (no llames autollenar si no quieres pisar)
      this.recalcularTotales();

      const teniaInfantes = this.countByTipo('INFANTE') > 0;
      if (teniaInfantes && !this.tourRules.allowsPassengerType(idTour, 'INFANTE')) {
        this.removeInfantes();
        this.navbar.alert.set({ type: 'warning', title: 'Infantes no permitidos', message: 'En este tour no se aceptan infantes. Han sido removidos.', autoClose: true });
      }

      this.tourRules.resetSession();

    } catch {
      this.navbar.alert.set({ type: 'error', title: 'Error al cambiar tour', message: 'No se pudieron cargar los datos del tour seleccionado.', autoClose: false });
    }
  }

  async onPlanMonedaChange(soloCargar = false) {
    const Id_Tour = Number(this.form.get('SelectTour')?.value);
    const Id_Plan = this.form.get('Id_Plan')?.value || null;
    const Id_Moneda = this.form.get('Id_Moneda')?.value || null;
    if (!Id_Tour || !Id_Moneda) return;

    try {
      const precios = await firstValueFrom(this.reservasSvc.getPrecios({ Id_Tour, Id_Plan, Id_Moneda }));
      this.preciosRef.set(precios || {});
      // En edición, por defecto NO autollenar para no pisar
      if (!soloCargar) {
        // Si quieres aplicar referencia a nuevos pasajeros añadidos:
        this.autollenarPrecios();
      }
      this.recalcularTotales();
    } catch {
      this.navbar.alert.set({ type: 'error', title: 'Error al cargar precios', message: 'No fue posible obtener los precios para el plan/moneda.', autoClose: false });
    }
  }

  // ===================== Pasajeros (igual que crear) =====================
  displayTipo(t: string | null | undefined): string {
    switch ((t || '').toUpperCase()) {
      case 'NINO': return 'NIÑO';
      case 'ADULTO': return 'ADULTO';
      case 'INFANTE': return 'INFANTE';
      default: return (t || '').toString().toUpperCase();
    }
  }
  // Retorna la posición (1-based) del pasajero i dentro de su tipo (ADULTO/NINO/INFANTE)
  tipoIndex(i: number): number {
    const ctrl = this.pasajeros.at(i);
    if (!ctrl) return i + 1;
    const tipo = ctrl.get('Tipo_Pasajero')?.value;
    const mismos = this.pasajeros.controls.filter(c => c.get('Tipo_Pasajero')?.value === tipo);
    return mismos.indexOf(ctrl) + 1;
  }
  private countByTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): number {
    return this.pasajeros.controls.filter(c => c.get('Tipo_Pasajero')?.value === tipo).length;
  }
  private removeInfantes(): void {
    for (let i = this.pasajeros.length - 1; i >= 0; i--) {
      if (this.pasajeros.at(i)?.get('Tipo_Pasajero')?.value === 'INFANTE') this.pasajeros.removeAt(i);
    }
    this.recalcularTotales();
  }

  agregarPasajero(tipo: 'ADULTO' | 'NINO' | 'INFANTE') {
    const currentTourId = Number(this.form.get('SelectTour')?.value);
    if (!this.tourRules.allowsPassengerType(currentTourId, tipo)) return;

    const principalPunto = this.form.get('Id_Punto')?.value ?? null;
    const fg = this.fb.group({
      Tipo_Pasajero: [tipo, Validators.required],
      Nombre_Pasajero: [''],
      DNI: [''],
      Telefono_Pasajero: ['', [Validators.pattern(/^(\+[1-9]\d{10,12})?$/)]],
      Id_Punto: [principalPunto],
      Confirmacion: [false],
      PrecioRef: [0],
      Precio_Pasajero: [0, [Validators.min(0)]],
      Comision: [0],
    });

    // Validación DNI en tiempo real
    fg.get('DNI')?.valueChanges.pipe(
      debounceTime(800),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
      switchMap((dniVal: string) => {
        if (!dniVal || dniVal.length < 5) return of(null);
        const fecha = this.form.get('Fecha_Tour')?.value;
        if (!fecha) return of(null);
        // excludeReservaId es el ID actual de la reserva
        return (this.reservasSvc as any).verificarDniDuplicado(dniVal, fecha, this.reservaId() || undefined).pipe(
          catchError(() => of(null))
        );
      })
    ).subscribe((res: any) => {
      if (res?.exists) {
        const reservaId = res?.reserva?.Id_Reserva ?? '?';
        fg.get('DNI')?.setErrors({ duplicadoEnBd: true });
        this.navbar.alert.set({
          type: 'warning',
          title: 'Documento Duplicado',
          message: `El documento ${fg.get('DNI')?.value} ya se encuentra reservado en otro tour para esta misma fecha (Reserva #${reservaId}).`,
          autoClose: false,
          buttons: [{ text: 'Entendido', style: 'secondary', onClick: () => this.navbar.alert.set(null) }]
        });
      } else {
        const errs = fg.get('DNI')?.errors;
        if (errs) {
          delete errs['duplicadoEnBd'];
          if (Object.keys(errs).length === 0) fg.get('DNI')?.setErrors(null);
          else fg.get('DNI')?.setErrors(errs);
        }
      }
    });

    this.pasajeros.push(fg);
    this.tourRules.evaluateAlertsForPassenger(currentTourId, tipo);

    // Solo para NUEVOS: autollenar referencia inicial
    this.autollenarPrecios();
    this.recalcularTotales();
  }

  eliminarPasajero(i: number) {
    const currentTourId = Number(this.form.get('SelectTour')?.value);
    const tipo = this.pasajeros.at(i)?.get('Tipo_Pasajero')?.value;
    this.pasajeros.removeAt(i);
    this.recalcularTotales();
    if (tipo === 'NINO') this.tourRules.evaluateAlertsForPassenger(currentTourId, tipo);
  }

  adultosInputValue(): number { return this.countByTipo('ADULTO'); }
  ninosInputValue(): number { return this.countByTipo('NINO'); }
  infantesInputValue(): number { return this.countByTipo('INFANTE'); }

  setCantidadPasajeros(tipo: 'ADULTO' | 'NINO' | 'INFANTE', val: any) {
    const currentTourId = Number(this.form.get('SelectTour')?.value);
    if (!this.tourRules.allowsPassengerType(currentTourId, tipo)) return;
    
    const n = Math.max(0, Number(val || 0));
    const cur = this.countByTipo(tipo);

    if (n > cur) {
      for (let i = 0; i < (n - cur); i++) {
        const fg = this.fb.group({
          Tipo_Pasajero: [tipo, Validators.required],
          Nombre_Pasajero: [''],
          DNI: [''],
          Telefono_Pasajero: ['', [Validators.pattern(/^(\+[1-9]\d{10,12})?$/)]],
          Id_Punto: [this.form.get('Id_Punto')?.value ?? null],
          Confirmacion: [false],
          PrecioRef: [0],
          Precio_Pasajero: [0, [Validators.min(0)]],
          Comision: [0],
        });

        // Validación DNI
        fg.get('DNI')?.valueChanges.pipe(
          debounceTime(800),
          distinctUntilChanged(),
          takeUntilDestroyed(this.destroyRef),
          switchMap((dniVal: string) => {
            if (!dniVal || dniVal.length < 5) return of(null);
            const fecha = this.form.get('Fecha_Tour')?.value;
            if (!fecha) return of(null);
            return (this.reservasSvc as any).verificarDniDuplicado(dniVal, fecha, this.reservaId() || undefined).pipe(
              catchError(() => of(null))
            );
          })
        ).subscribe((res: any) => {
          if (res?.exists) {
            const reservaId = res?.reserva?.Id_Reserva ?? '?';
            fg.get('DNI')?.setErrors({ duplicadoEnBd: true });
            this.navbar.alert.set({
              type: 'warning',
              title: 'Documento Duplicado',
              message: `El documento ${fg.get('DNI')?.value} ya se encuentra reservado en otro tour para esta misma fecha (Reserva #${reservaId}).`,
              autoClose: false,
              buttons: [{ text: 'Entendido', style: 'secondary', onClick: () => this.navbar.alert.set(null) }]
            });
          } else {
            const errs = fg.get('DNI')?.errors;
            if (errs) {
              delete errs['duplicadoEnBd'];
              if (Object.keys(errs).length === 0) fg.get('DNI')?.setErrors(null);
              else fg.get('DNI')?.setErrors(errs);
            }
          }
        });

        this.pasajeros.push(fg);
      }
      this.autollenarPrecios();
      this.recalcularTotales();
    } else if (n < cur) {
      for (let i = cur - 1; i >= n; i--) {
        const idx = this.pasajeros.controls.findIndex(c => c.get('Tipo_Pasajero')?.value === tipo);
        if (idx >= 0) this.pasajeros.removeAt(idx);
      }
      this.recalcularTotales();
    }

    if (tipo === 'NINO') this.tourRules.evaluateAlertsForPassenger(currentTourId, tipo);
  }

  async autollenarPrecios() {
    const idTour = Number(this.form.get('SelectTour')?.value);
    const idCanal = Number(this.form.get('Id_Canal')?.value);
    if (!idTour || !idCanal) {
      for (const ctrl of this.pasajeros.controls) {
        ctrl.get('Comision')?.setValue(0, { emitEvent: false });
        if (!ctrl.get('Precio_Pasajero')?.dirty) ctrl.get('Precio_Pasajero')?.setValue(0, { emitEvent: false });
        ctrl.get('PrecioRef')?.setValue(0, { emitEvent: false });
      }
      this.cdr.markForCheck();
      return;
    }

    try {
      const comisiones = await firstValueFrom(this.reservasSvc.getComisiones(idTour, idCanal));
      const ref = this.preciosRef();
      for (const ctrl of this.pasajeros.controls) {
        const tipo = ctrl.get('Tipo_Pasajero')?.value as 'ADULTO' | 'NINO' | 'INFANTE';
        const precioTour = ref[tipo] ?? 0;
        ctrl.get('PrecioRef')?.setValue(precioTour, { emitEvent: false });
        if (!ctrl.get('Precio_Pasajero')?.dirty) ctrl.get('Precio_Pasajero')?.setValue(precioTour, { emitEvent: false });
        const com = tipo === 'INFANTE' ? 0 : (comisiones[tipo] || 0);
        ctrl.get('Comision')?.setValue(com, { emitEvent: false });
      }
    } catch {
      for (const ctrl of this.pasajeros.controls) ctrl.get('Comision')?.setValue(0, { emitEvent: false });
    }
    this.cdr.markForCheck();
  }

  pasajerosConAsiento(): number {
    return this.pasajeros.controls.filter(c => {
      const t = c.get('Tipo_Pasajero')?.value; return t === 'ADULTO' || t === 'NINO';
    }).length;
  }

  async recalcularComisionesPorCanal() {
    const idTour = Number(this.form.get('SelectTour')?.value);
    const idCanal = Number(this.form.get('Id_Canal')?.value);
    if (!idTour || !idCanal) {
      for (const ctrl of this.pasajeros.controls) ctrl.get('Comision')?.setValue(0, { emitEvent: false });
      this.cdr.markForCheck(); return;
    }
    try {
      const comisiones = await firstValueFrom(this.reservasSvc.getComisiones(idTour, idCanal));
      for (const ctrl of this.pasajeros.controls) {
        const tipo = ctrl.get('Tipo_Pasajero')?.value as 'ADULTO' | 'NINO' | 'INFANTE';
        const comision = tipo === 'INFANTE' ? 0 : (comisiones[tipo] || 0);
        ctrl.get('Comision')?.setValue(Math.floor(comision), { emitEvent: false });
      }
    } catch {
      for (const ctrl of this.pasajeros.controls) ctrl.get('Comision')?.setValue(0, { emitEvent: false });
    }
    this.cdr.markForCheck();
  }

  // ===================== Totales =====================
  totalNeto(): number {
    let sum = 0;
    for (const c of this.pasajeros.controls) {
      const precio = Number(c.get('Precio_Pasajero')?.value || 0);
      sum += precio;
    }
    return sum;
  }
  comisionTotal(): number {
    let sum = 0;
    for (const c of this.pasajeros.controls) sum += Number(c.get('Comision')?.value || 0);
    return sum;
  }
  pendientePorPagar(): number {
    const forma = this.form.get('FormaPago')?.value;
    const total = this.totalNeto() + Number(this.form.get('ComisionInternacional')?.value || 0);
    if (forma === 'Abono') return Math.max(0, total - this.totalAbonos());
    if (forma === 'Completo') return 0;
    return total;
  }
  recalcularTotales() { /* getters ya recalculan */ }

  // ===================== Cupos =====================
  async verificarCuposDisponibles(): Promise<void> {
    const Fecha = this.form.get('Fecha_Tour')?.value;
    const Id_Tour = this.form.get('SelectTour')?.value;
    const cant = this.pasajerosConAsiento();
    const Id_Reserva = this.reservaId();
    if (!Fecha || !Id_Tour) return;

    try {
      // Ahora enviamos también el Id_Reserva
      const data = await firstValueFrom(this.reservasSvc.verificarCupos(Fecha, Number(Id_Tour), cant, Id_Reserva));
      if (!data?.disponible) {
        this.navbar.alert.set({
          type: 'warning',
          title: 'Cupos insuficientes',
          message: `Solo hay ${data?.cuposDisponibles ?? 0} cupos disponibles para este tour.`,
          autoClose: false,
          buttons: [{ text: 'Entendido', style: 'secondary', onClick: () => this.navbar.alert.set(null) }],
        });
      }
    } catch {
      this.navbar.alert.set({
        type: 'error',
        title: 'Error al verificar cupos',
        message: 'No fue posible verificar los cupos disponibles.',
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) }],
      });
    }
  }

  CuposDisponiblesNavbar(): void {
    const { Fecha_Tour, SelectTour, Tipo_Reserva } = this.form.value;
    const totalPasajeros = this.pasajerosConAsiento();
    const Id_Reserva = this.reservaId();
    if (Tipo_Reserva !== 'Grupal') { this.navbar.cuposInfo.set(null); return; }
    if (Fecha_Tour && SelectTour) {
      // Enviamos también el Id_Reserva
      this.reservasSvc.verificarCupos(Fecha_Tour, SelectTour, totalPasajeros, Id_Reserva).subscribe({
        next: (data) => this.navbar.cuposInfo.set({ ...data }),
        error: () => this.navbar.cuposInfo.set(null)
      });
    } else {
      this.navbar.cuposInfo.set(null);
    }
  }

  // ===================== Guardado (ACTUALIZAR) =====================
  private confirmar(titulo: string, mensaje: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.navbar.alert.set({
        type: 'info',
        title: titulo,
        message: mensaje,
        autoClose: false,
        buttons: [
          { text: 'Cancelar', style: 'secondary', onClick: () => { this.navbar.alert.set(null); resolve(false); } },
          { text: 'Confirmar', style: 'primary', onClick: () => { this.navbar.alert.set(null); resolve(true); } },
        ],
      });
    });
  }

  // Mostrar diálogo con opciones (retorna la key del botón pulsado)
  private confirmarOpciones(titulo: string, mensaje: string, opciones: Array<{ key: string; text: string; style?: string }>): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.navbar.alert.set({
        type: 'warning',
        title: titulo,
        message: mensaje,
        autoClose: false,
        buttons: opciones.map(o => ({ text: o.text, style: o.style || 'primary', onClick: () => { this.navbar.alert.set(null); resolve(o.key); } })).concat([{ text: 'Cerrar', style: 'secondary', onClick: () => { this.navbar.alert.set(null); resolve(null); } }])
      });
    });
  }

  // ===== Duplicar reserva =====
  async duplicarReserva(): Promise<void> {
    this.openSummary = false;
    try {
      this.abonos.clear();
      this.form.get('ComprobantePago')?.setValue(null);
      for (const fg of this.pasajeros.controls) fg.get('Confirmacion')?.setValue(false);

      const principal = this.puntosSeleccionados()[0] ?? null;
      this.form.get('Id_Punto')?.setValue(principal?.Id_Punto ?? null);

      this.navbar.openPanel({
        id: 'duplicar',
        title: 'Duplicar reserva',
        component: DuplicarPanelComponent,
        props: {
          tours: this.tours(),
          Id_Tour: Number(this.form.get('SelectTour')?.value) || null,
          Fecha_Tour: this.form.get('Fecha_Tour')?.value || null,

          onConfirm: async ({ Id_Tour, Fecha_Tour, Observaciones }: any) => {
            const targetTourId = Number(Id_Tour);
            const targetFecha = String(Fecha_Tour || '').slice(0, 10);

            this.navbar.closePanel();
            await Promise.resolve();

            const origFecha = this.originalReserva?.Cabecera?.Fecha_Tour ?? this.originalReserva?.FechaReserva ?? this.form.get('Fecha_Tour')?.value;
            const origFechaNorm = String(origFecha || '').slice(0, 10);

            if (!targetFecha || targetFecha === origFechaNorm) {
              this.navbar.alert.set({ type: 'warning', title: 'Fecha inválida', message: 'La fecha debe ser distinta a la original.', autoClose: true });
              return;
            }

            const okRestricciones = await this.confirmarRestriccionesAntesDeDuplicar(targetTourId);
            if (!okRestricciones) return;

            await this.crearReservaDuplicada({
              Id_Tour: targetTourId,
              Fecha_Tour: targetFecha,
              Observaciones: typeof Observaciones === 'string' ? Observaciones.trim() : null
            });
          }
        }
      });

      this.CuposDisponiblesNavbar();
      this.cdr.markForCheck();
    } catch (e) {
      console.error('Error preparando duplicación', e);
      this.navbar.alert.set({ type: 'error', title: 'Error', message: 'No fue posible preparar la duplicación.', autoClose: false });
    }
  }

  private async crearReservaDuplicada(overrides: { Id_Tour: number; Fecha_Tour: string; Observaciones?: string | null }): Promise<void> {
    try {
      const targetTourId = overrides.Id_Tour;

      let pax = this.pasajeros.controls.map(c => ({
        Nombre_Pasajero: c.get('Nombre_Pasajero')?.value || '',
        DNI: c.get('DNI')?.value || null,
        Telefono_Pasajero: c.get('Telefono_Pasajero')?.value || null,
        Tipo_Pasajero: c.get('Tipo_Pasajero')?.value,
        Id_Punto: c.get('Id_Punto')?.value || this.form.get('Id_Punto')?.value || null,
        Confirmacion: false,
        Precio_Tour: 0,
        Precio_Pasajero: 0,
        Comision: 0,
      }));

      // Paso 1: Validar/Adaptar pasajeros a las reglas del Tour DESTINO
      let removeInfantesCount = 0;
      let adaptadosCount = 0;
      pax = pax.filter(p => {
        if (p.Tipo_Pasajero === 'INFANTE' && !this.tourRules.allowsPassengerType(targetTourId, 'INFANTE')) {
          removeInfantesCount++;
          return false;
        }
        return true;
      });

      pax = pax.map(p => {
        const adp = this.tourRules.adaptPassengerType(targetTourId, p.Tipo_Pasajero);
        if (adp !== p.Tipo_Pasajero) adaptadosCount++;
        return { ...p, Tipo_Pasajero: adp };
      });

      // Paso 2: Fetch Precios Financieros Exactos del Catalogo
      // Intentamos recuperar precios con el Plan Original. Si es undefined, lo mandamos null para que traiga el default del backend.
      const idMoneda = Number(this.form.get('Id_Moneda')?.value || 1);
      let idPlan = Number(this.form.get('Id_Plan')?.value || 0) || null;
      let preciosNuevos: PrecioMap = {};
      try {
        preciosNuevos = await firstValueFrom(this.reservasSvc.getPrecios({ Id_Tour: targetTourId, Id_Plan: idPlan, Id_Moneda: idMoneda })) || {};
      } catch {
        preciosNuevos = await firstValueFrom(this.reservasSvc.getPrecios({ Id_Tour: targetTourId, Id_Plan: null, Id_Moneda: idMoneda })) || {};
      }

      const idCanal = Number(this.form.get('Id_Canal')?.value || 1);
      let comisionesGlobal = {};
      try {
        comisionesGlobal = await firstValueFrom(this.reservasSvc.getComisiones(targetTourId, idCanal)) || {};
      } catch {}

      pax.forEach((p: any) => {
        const precioReal = (preciosNuevos as any)[p.Tipo_Pasajero] ?? 0;
        p.Precio_Tour = precioReal;
        p.Precio_Pasajero = precioReal;
        p.Comision = p.Tipo_Pasajero === 'INFANTE' ? 0 : ((comisionesGlobal as any)[p.Tipo_Pasajero] ?? 0);
      });

      const totalNeto = pax.reduce((acc, p) => acc + Number(p.Precio_Pasajero || 0), 0);

      const principal = this.puntosSeleccionados()[0] ?? null;
      const Id_Punto = principal?.Id_Punto ?? this.form.get('Id_Punto')?.value ?? null;
      let horarioId = this.form.get('Id_Horario')?.value || null;
      if (Id_Punto) {
        try {
          const horario = await firstValueFrom(this.reservasSvc.getHorarioPorPunto(Id_Punto, targetTourId));
          if (horario?.Id_Horario) horarioId = horario.Id_Horario;
        } catch { }
      }

      const cab = {
        Tipo_Reserva: this.form.get('Tipo_Reserva')?.value,
        Id_Horario: horarioId,
        Fecha_Tour: overrides.Fecha_Tour,
        Id_Canal: idCanal,
        Idioma_Reserva: this.form.get('Idioma_Reserva')?.value,
        Telefono_Reportante: this.form.get('Telefono_Reportante')?.value,
        Nombre_Reportante: this.form.get('Nombre_Reportante')?.value,
        Observaciones: overrides.Observaciones ?? this.form.get('Observaciones')?.value,
        Id_Tour: targetTourId,
        Id_Punto: Id_Punto,
      };

      const payload: any = {
        cabeceraReserva: cab,
        pasajeros: pax,
        pagos: [{ Monto: totalNeto, Tipo: 'Pago Directo' }]
      };

      const res = await firstValueFrom(this.reservasSvc.crearReserva(payload, { abonos: [] }));
      const rAny: any = res as any;
      const nuevoId = rAny?.Id_Reserva ?? rAny?.id ?? rAny?.reservaId ?? null;

      if (!nuevoId) {
        this.navbar.alert.set({ type: 'success', title: 'Reserva creada', message: 'Reserva duplicada correctamente.', autoClose: true });
        return;
      }

      let extraMsg = '';
      if (removeInfantesCount > 0) extraMsg += `\nNota: Se removieron ${removeInfantesCount} infantes no permitidos.`;
      if (adaptadosCount > 0) extraMsg += `\nNota: Se reajustaron tarifas de ${adaptadosCount} menores por política del tour.`;

      this.navbar.alert.set({
        type: 'success',
        title: 'Reserva duplicada con éxito',
        message: `ID de nueva reserva: ${nuevoId}${extraMsg}`,
        autoClose: false,
        buttons: [
          { text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) },
          { text: 'Ver Reserva', style: 'primary', onClick: () => { this.navbar.alert.set(null); this.abrirReservaEnNavbar(String(nuevoId)); } }
        ]
      });

    } catch (err) {
      console.error(err);
      this.navbar.alert.set({ type: 'error', title: 'Error', message: 'No fue posible crear la reserva duplicada. Verifica tu conexión.', autoClose: false });
    }
  }

  private async confirmarRestriccionesAntesDeDuplicar(targetTourId: number): Promise<boolean> {
    const infantes = this.countByTipo('INFANTE');
    if (infantes > 0 && !this.tourRules.allowsPassengerType(targetTourId, 'INFANTE')) {
      const decision = await this.confirmarOpciones(
        'Infantes detectados',
        `El tour destino NO acepta infantes. Tienes ${infantes} registrado(s). Serán ignorados de la clonación si continúas. ¿Continuar clonación?`,
        [{ key: 'continuar', text: 'Sí, ignorar infantes', style: 'primary' }]
      );
      if (decision !== 'continuar') return false;
    }
    return true;
  }

  private abrirReservaEnNavbar(idReserva: string) {

    this.navbar.alert.set(null);
this.navbar.cuposInfo.set(null);
    this.navbar.Id_Reserva.set(idReserva);

  }

  async onSubmit(): Promise<void> {
    if (this.isSubmitting()) return;
    this.isSubmitting.set(true);

    // ===== Validación del formulario ANTES de confirmar =====
    this.form.updateValueAndValidity({ emitEvent: false });
    if (this.form.invalid) {
      this.form.markAllAsTouched();

      const invalid = Object.keys(this.form.controls).filter(k => this.form.get(k)?.invalid);
      const friendly: Record<string, string> = {
        SelectTour: 'Tour',
        Fecha_Tour: 'Fecha del Tour',
        Id_Horario: 'Horario',
        Id_Moneda: 'Moneda',
        Id_Canal: 'Canal',
        Nombre_Reportante: 'Nombre del Reportante',
        Telefono_Reportante: 'Teléfono del Reportante (indicativo + 10 dígitos, ej: +573001234567)',
        Tipo_Reserva: 'Tipo de Reserva',
        Id_Punto: 'Punto de Encuentro'
      };

      const fields = invalid.map(f => friendly[f] || f);
      const msg = fields.length
        ? `Revisa los siguientes campos: ${fields.join(', ')}`
        : 'Hay campos invalidos en el formulario.';

      this.navbar.alert.set({
        type: 'error',
        title: 'Campos requeridos incompletos',
        message: msg,
        autoClose: true,
        buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.alert.set(null) }]
      });
      this.isSubmitting.set(false);
      return;
    }

    if (this.tieneConflictoLogistico()) {
      this.navbar.alert.set({
        type: 'error',
        title: 'Inviabilidad logística',
        message: this.mensajeInviabilidadLogistica() || 'Corrige los puntos de encuentro antes de guardar.',
        autoClose: false,
        buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.alert.set(null) }]
      });
      this.isSubmitting.set(false);
      return;
    }

    const tourNombre = this.tours().find(t => t.Id_Tour === Number(this.form.get('SelectTour')?.value))?.Nombre_Tour ?? '—';
    const fecha = this.form.get('Fecha_Tour')?.value ?? '—';
    const ad = this.countByTipo('ADULTO');
    const ni = this.countByTipo('NINO');
    const infa = this.countByTipo('INFANTE');
    const totalNeto = this.totalNeto();

    const ok = await this.confirmar(
      '¿Actualizar reserva?',
      `Vas a actualizar la reserva #${this.reservaId() ?? '—'}: ${tourNombre} • ${fecha}.
      Pasajeros: Adultos ${ad} • Niños ${ni} • Infantes ${infa}.
      Total neto: ${this.monedaCodigo()} ${totalNeto}.
      ¿Deseas continuar?`
    );
    if (!ok) {
      this.isSubmitting.set(false);
      return;
    }

    try {
      // Pasajeros payload
      const pax = this.pasajeros.controls.map(c => ({
        Nombre_Pasajero: c.get('Nombre_Pasajero')?.value || '',
        DNI: c.get('DNI')?.value || null,
        Telefono_Pasajero: c.get('Telefono_Pasajero')?.value || null,
        Tipo_Pasajero: c.get('Tipo_Pasajero')?.value,
        Id_Punto: c.get('Id_Punto')?.value || this.form.get('Id_Punto')?.value || null,
        Confirmacion: !!c.get('Confirmacion')?.value,
        Precio_Tour: Number(c.get('PrecioRef')?.value || 0),
        Precio_Pasajero: Number(c.get('Precio_Pasajero')?.value || 0),
        Comision: Number(c.get('Comision')?.value || 0),
      }));

      // Pagos + archivos (sólo NUEVOS en edición)
      type PagoTipo = 'Pago Directo' | 'Pago Completo' | 'Abono';
      const pagos: Array<{ Monto: number; Tipo: PagoTipo; fileField?: string }> = [];
      const archivos: { completo?: File | null; abonos?: (File | null)[] } = { abonos: [] };

      const forma = this.form.get('FormaPago')?.value as 'Directo' | 'Completo' | 'Abono';
      let comprobanteCompletoFile: File | null = null;
      let tieneComprobanteOUrl = false;

      if (forma === 'Directo') {
        pagos.push({ Monto: totalNeto, Tipo: 'Pago Directo' });
      } else if (forma === 'Completo') {
        const cmpVal = this.form.get('ComprobantePago')?.value;
        const pagoCompleto: any = { Monto: totalNeto, Tipo: 'Pago Completo' };
        
        if (cmpVal instanceof File) {
          pagoCompleto.fileField = 'comprobante_pago';
          archivos.completo = cmpVal;
          comprobanteCompletoFile = cmpVal;
          tieneComprobanteOUrl = true;
        } else if (cmpVal?.SoporteUrl) {
          pagoCompleto.SoporteUrl = cmpVal.SoporteUrl;
          tieneComprobanteOUrl = true;
        }
        pagos.push(pagoCompleto);
      } else if (forma === 'Abono') {
        this.abonos.controls.forEach((g, i) => {
          const monto = Number(g.get('Monto')?.value || 0);
          const cmpVal = g.get('Comprobante')?.value;
          if (monto > 0) {
            const pagoAbono: any = { Monto: monto, Tipo: 'Abono' };
            if (cmpVal instanceof File) {
              pagoAbono.fileField = `abono_${i}`;
              archivos.abonos!.push(cmpVal);
              tieneComprobanteOUrl = true;
            } else if (cmpVal?.SoporteUrl) {
              pagoAbono.SoporteUrl = cmpVal.SoporteUrl;
              archivos.abonos!.push(null);
              tieneComprobanteOUrl = true;
            } else {
              archivos.abonos!.push(null);
            }
            pagos.push(pagoAbono);
          }
        });
      }

      // Estado sugerido (opcional)
      const { estado, subestado } = this.resolverEstadoYMotivo(pax, forma, tieneComprobanteOUrl);

      // Cabecera
      const cab = {
        Id_Reserva: this.reservaId(),
        Tipo_Reserva: this.form.get('Tipo_Reserva')?.value,
        Id_Horario: this.form.get('Id_Horario')?.value || null,
        Fecha_Tour: this.form.get('Fecha_Tour')?.value,
        Id_Canal: this.form.get('Id_Canal')?.value,
        Idioma_Reserva: this.form.get('Idioma_Reserva')?.value,
        Telefono_Reportante: this.form.get('Telefono_Reportante')?.value,
        Nombre_Reportante: this.form.get('Nombre_Reportante')?.value,
        Observaciones: this.form.get('Observaciones')?.value,
        Id_Tour: this.form.get('SelectTour')?.value,
        Id_Punto: this.form.get('Id_Punto')?.value,
        Estado: estado, // si tu backend recalcula, puedes omitir enviar Estado
      };

      // Si el pago es Directo o Completo, indicamos que se deben reemplazar los pagos
      let payload: any = { cabeceraReserva: cab, pasajeros: pax, pagos };
      if (forma === 'Directo' || forma === 'Completo') {
        payload.replacePagos = true;
      }
      // === CREAR o ACTUALIZAR RESERVA ===
      // Si venimos de un duplicado o no hay reservaId, hacemos `crearReserva`
      let res: any = null;
      if (this.isDuplicateMode || !this.reservaId()) {
        res = await firstValueFrom(this.reservasSvc.crearReserva(payload, archivos));
      } else {
        res = await firstValueFrom(
          this.reservasSvc.actualizarReserva?.(this.reservaId()!, payload, archivos)
          ?? this.reservasSvc.crearReserva(payload, archivos)
        );
      }

      // Si guardamos una duplicación como nueva, salir del modo duplicado
      if (this.isDuplicateMode) this.isDuplicateMode = false;

      const reservaActual = this.reservaId() || (res as any)?.Id_Reserva || cab.Id_Reserva;
      const estadoTexto = subestado ? `${estado} ${subestado}` : estado;
      this.navbar.alert.set({
        type: 'success',
        title: 'Reserva actualizada',
        message: `La reserva ${reservaActual} ha sido actualizada correctamente. Estado: ${estadoTexto}.`,
        autoClose: false,
        buttons: [
          { text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) },
          { text: 'Ver Reserva', style: 'primary', onClick: () => { this.navbar.alert.set(null); this.navbar.cuposInfo.set(null); this.navbar.Id_Reserva.set(String(reservaActual)); } },
        ],
      });

      if (reservaActual) {
        await this.cargarHistorialActividad(String(reservaActual));
      }

      this.form.markAsPristine();
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Error al actualizar reserva:', err);
      this.navbar.alert.set({
        type: 'error',
        title: 'Error al actualizar',
        message: 'Ocurrió un problema al enviar los cambios al servidor.',
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) }],
      });
    } finally {
      this.isSubmitting.set(false);
    }
  }

  hasUnsavedChanges(): boolean {
    return this.form?.dirty && !this.isSubmitting();
  }

  // ===================== Utilidades / files =====================
  seleccionarTexto(e: any) { e?.target?.select?.(); }
  horaSalida(): string { return this.horarioSeleccionado()?.HoraSalida || ''; }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const ctrl = this.form.get('ComprobantePago');
    if (!input?.files?.length || !ctrl) return;
    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) {
      this.navbar.alert.set({ type: 'warning', title: 'Archivo muy grande', message: 'El máximo permitido es 5 MB.', autoClose: true });
      ctrl.setValue(null); input.value = ''; return;
    }
    const ok = /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (!ok) {
      this.navbar.alert.set({ type: 'warning', title: 'Formato no permitido', message: 'Sólo PDF, JPG o PNG.', autoClose: true });
      ctrl.setValue(null); input.value = ''; return;
    }
    ctrl.setValue(file);
    ctrl.markAsDirty();
    ctrl.updateValueAndValidity({ emitEvent: false });
    this.navbar.alert.set({ type: 'success', title: 'Archivo cargado', message: `Se ha cargado el comprobante: ${file.name}`, autoClose: true });
  }

  onAbonoFileSelected(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const abonoControl = this.abonos.at(index) as FormGroup;
    if (!input?.files?.length || !abonoControl) return;
    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) {
      this.navbar.alert.set({ type: 'warning', title: 'Archivo muy grande', message: 'El máximo permitido es 5 MB.', autoClose: true });
      abonoControl.get('Comprobante')?.setValue(null); input.value = ''; return;
    }
    const ok = /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (!ok) {
      this.navbar.alert.set({ type: 'warning', title: 'Formato no permitido', message: 'Sólo PDF, JPG o PNG.', autoClose: true });
      abonoControl.get('Comprobante')?.setValue(null); input.value = ''; return;
    }
    abonoControl.get('Comprobante')?.setValue(file);
    abonoControl.markAsDirty();
    abonoControl.updateValueAndValidity({ emitEvent: false });
    this.navbar.alert.set({ type: 'success', title: 'Archivo cargado', message: `Se ha cargado el archivo: ${file.name}`, autoClose: true });
  }

  // ===================== Estado sugerido (opcional) =====================
  private validarDatosPasajeros(pax: Array<any>) {
    let faltanNombre = 0, faltanDni = 0, hayTelefonoPasajero = false;
    for (const p of pax) {
      const nombre = (p.Nombre_Pasajero ?? '').toString().trim();
      const dni = (p.DNI ?? '').toString().trim();
      const tel = (p.Telefono_Pasajero ?? '').toString().trim();
      if (!nombre) faltanNombre++;
      if (!dni) faltanDni++;
      if (!!tel) hayTelefonoPasajero = true;
    }
    const okNombres = faltanNombre === 0;
    const okDni = faltanDni === 0;
    return { ok: okNombres && okDni && hayTelefonoPasajero, okNombres, okDni, hayTelefonoPasajero, faltanNombre, faltanDni };
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

  // ===================== Comprobante preview / actions =====================
  previewVisible = signal(false);
  previewUrl = signal<SafeResourceUrl | null>(null);

  viewComprobante(url: string | null) {
    if (!url) return;
    const href = this.resolveComprobanteUrl(url);
    if (!href) {
      this.navbar.alert.set({
        type: 'warning',
        title: 'Comprobante inválido',
        message: 'No se pudo resolver la URL del comprobante.',
        autoClose: true,
      });
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  closePreview() {
    this.previewVisible.set(false);
    this.previewUrl.set(null);
  }

  triggerComprobanteUpload() {
    const input = document.getElementById('ComprobantePago') as HTMLInputElement | null;
    input?.click();
  }

  deleteComprobante() {
    const currentValue: any = this.form.get('ComprobantePago')?.value;
    const idPago = Number(currentValue?.Id_Pago);
    const idReserva = this.reservaId();

    this.navbar.alert.set({
      type: 'warning',
      title: 'Eliminar comprobante',
      message: 'Esta acción eliminará el comprobante actual de manera permanente. ¿Deseas continuar?',
      autoClose: false,
      buttons: [
        { text: 'Cancelar', style: 'secondary', onClick: () => this.navbar.alert.set(null) },
        {
          text: 'Eliminar',
          style: 'primary',
          onClick: () => {
            this.navbar.alert.set(null);

            if (idReserva && Number.isFinite(idPago) && idPago > 0) {
              this.reservasSvc.eliminarComprobantePagoReserva(idReserva, idPago).subscribe({
                next: () => {
                  this.clearComprobanteLocalState();
                  this.navbar.alert.set({
                    type: 'success',
                    title: 'Comprobante eliminado',
                    message: 'El comprobante se eliminó correctamente del servidor.',
                    autoClose: true,
                  });
                },
                error: () => {
                  this.navbar.alert.set({
                    type: 'error',
                    title: 'Error al eliminar',
                    message: 'No se pudo eliminar el comprobante en el servidor.',
                    autoClose: true,
                  });
                },
              });
              return;
            }

            this.clearComprobanteLocalState();
            this.navbar.alert.set({
              type: 'info',
              title: 'Comprobante eliminado',
              message: 'El comprobante fue removido del formulario. Guarda para persistir.',
              autoClose: true,
            });
          },
        },
      ],
    });
  }

  private clearComprobanteLocalState(): void {
    this.form.get('ComprobantePago')?.setValue(null);
    this.form.get('ComprobantePago')?.markAsDirty();
    this.form.get('ComprobantePago')?.updateValueAndValidity({ emitEvent: false });
    const input = document.getElementById('ComprobantePago') as HTMLInputElement | null;
    if (input) input.value = '';
  }

  private resolveComprobanteUrl(url: string): string | null {
    const raw = String(url || '').trim();
    if (!raw) return null;

    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/uploads/')) return raw;
    if (raw.startsWith('uploads/')) return `/${raw}`;

    const apiBase = (environment.apiUrl || '').replace(/\/$/, '');
    const fileName = raw.split('/').filter(Boolean).pop();
    if (!fileName) return null;
    return `${apiBase}/reservas/comprobante/${encodeURIComponent(fileName)}`;
  }

  private resolverEstadoYMotivo(
    pasajeros: Array<any>,
    formaPago: 'Directo' | 'Completo' | 'Abono',
    tieneComprobanteCompleto: boolean
  ): { estado: 'Confirmada' | 'Pendiente'; subestado: 'de datos' | 'de pago' | null; motivo: string } {
    const val = this.validarDatosPasajeros(pasajeros);
    if (!val.ok) {
      const partes: string[] = [];
      if (!val.okNombres) partes.push(`faltan ${val.faltanNombre} nombre(s)`);
      if (!val.okDni) partes.push(`faltan ${val.faltanDni} DNI/pasaporte(s)`);
      if (!val.hayTelefonoPasajero) partes.push('no hay ningún teléfono de pasajero');
      const razon = `Faltan datos básicos de pasajeros: ${partes.join('; ')}.`;
      return { estado: 'Pendiente', subestado: 'de datos', motivo: razon };
    }
    if (formaPago === 'Directo') return { estado: 'Confirmada', subestado: null, motivo: 'Pago directo y datos completos.' };
    if (formaPago === 'Completo') {
      if (tieneComprobanteCompleto) return { estado: 'Confirmada', subestado: null, motivo: 'Pago completo con comprobante y datos completos.' };
      return { estado: 'Pendiente', subestado: 'de pago', motivo: 'Falta el comprobante del pago completo.' };
    }
    return { estado: 'Pendiente', subestado: 'de pago', motivo: 'Se registró un abono. Falta completar el pago.' };
  }
}
