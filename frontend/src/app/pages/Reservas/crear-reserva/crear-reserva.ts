import { Component, OnInit, ChangeDetectorRef, inject, signal, computed, ViewChild, NgZone, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from '../../../../environments/environment';
import { CommonModule, DecimalPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import { firstValueFrom, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError } from 'rxjs/operators';
import { WebSocketService } from '../../../services/WebSocket/web-socket';
import { TransferService } from '../../../services/Transfers/transfers';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import {
  Reservas, Tour, Canal, Moneda, Plan, Horario, PrecioMap, Punto,
} from '../../../services/Reservas/reservas';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { TourRulesService } from '../../../services/Reservas/tour-rules.service';

@Component({
  selector: 'app-crear-reserva',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DecimalPipe, FlatpickrInputDirective],
  templateUrl: './crear-reserva.html',
  styleUrls: ['./crear-reserva.css'],
})
export class CrearReservaComponent implements OnInit {
  openSummary = false;
  showDuplicate = false;
  private readonly e164WithTenDigitsPattern = /^\+[1-9]\d{10,12}$/;

  toggleSummary(force?: boolean) {
    this.openSummary = typeof force === 'boolean' ? force : !this.openSummary;
  }


  private wsService = inject(WebSocketService);
  private transferSvc = inject(TransferService);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);
  private reservasSvc = inject(Reservas);
  private navbar = inject(DynamicIslandGlobalService);
  private zone = inject(NgZone);
  private destroyRef = inject(DestroyRef);
  private tourRules = inject(TourRulesService);

  isLoading = signal<boolean>(true);
  isSubmitting = signal<boolean>(false);
  form!: FormGroup;

  // catálogos
  tours = signal<Tour[]>([]);
  canales = signal<Canal[]>([]);
  monedas = signal<Moneda[]>([]);
  planes = signal<Plan[]>([]);

  // horario elegido automáticamente por (tour + punto principal)
  horarioSeleccionado = signal<Horario | null>(null);

  // precios por tipo
  preciosRef = signal<PrecioMap>({});

  // comisión % según tour + canal
  canalComisionPctSignal = signal<number>(0);
  canalComisionPct() { return this.canalComisionPctSignal(); }

  // código de moneda para UI
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

  // puntos de encuentro
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

  @ViewChild('fechaFp') fechaFp?: FlatpickrInputDirective;

  // guardamos la disponibilidad actual del tour seleccionado
  private disponibilidadActual: any = null;

  async ngOnInit(): Promise<void> {

    this.form = this.fb.group({
      // cabecera (corrige la sintaxis de disabled)
      SelectTour: [{ value: '', disabled: false }, Validators.required],
      Id_Plan: [{ value: '', disabled: false }],
      Fecha_Tour: [null, Validators.required],
      Id_Horario: [null],
      Idioma_Reserva: ['ESPAÑOL'],
      Id_Moneda: [{ value: 1, disabled: false }, Validators.required],

      // responsable
      Id_Canal: [1, Validators.required],
      Nombre_Reportante: ['', Validators.required],
      Telefono_Reportante: ['', [Validators.required, Validators.pattern(this.e164WithTenDigitsPattern)]],
      Observaciones: [''],

      // tipo
      Tipo_Reserva: ['Grupal', Validators.required],

      // colecciones
      Pasajeros: this.fb.array([]),


      // Suscribirse a WebSocket para actualizar cupos en el navbar en tiempo real

      // pagos
      FormaPago: ['Directo'],
      Abonos: this.fb.array([]),            // ahora será de grupos {Monto, Comprobante}
      ComisionInternacional: [0],

      // punto principal
      Id_Punto: [null, Validators.required],

      // comprobante de pago (dinámico)
      ComprobantePago: [null],
    });
    this.wsService.messages$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((msg: any) => {
      this.zone.run(() => {
        const fecha = this.form.get('Fecha_Tour')?.value;
        const tour = this.form.get('SelectTour')?.value;

        // Reservas que afectan cupos del tour/fecha actual
        if ((msg?.type === 'reservaCreada' || msg?.type === 'reservaActualizada') && msg?.Fecha_Tour === fecha && msg?.Id_Tour == tour) {
          this.CuposDisponiblesNavbar();
          this.verificarCuposDisponibles();
        }

        // Cambios de aforo del tour actual (si el evento trae fecha, intenta matchear)
        if (msg?.type === 'aforoActualizado' && msg?.Id_Tour == tour) {
          if (!msg?.Fecha || msg.Fecha === fecha) {
            this.CuposDisponiblesNavbar();
            this.verificarCuposDisponibles();
          }
        }
      });
    });
    try {
      this.isLoading.set(true);
      this.navbar.alert.set({
        title: 'Cargando datos...',
        loading: true,
        autoClose: false,
      });
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
        buttons: [
          { text: 'Reintentar', style: 'primary', onClick: () => { this.navbar.alert.set(null); this.ngOnInit(); } },
          { text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) },
        ],
      });
    } finally {
      this.navbar.alert.set(null);
      this.isLoading.set(false);
      this.cdr.markForCheck();
    }
  }

  // ===== Getters =====
  get pasajeros(): FormArray { return this.form.get('Pasajeros') as FormArray; }
  get abonos(): FormArray { return this.form.get('Abonos') as FormArray; }

  // ===== Abonos helpers =====
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

  // ====== Puntos: búsqueda (por texto) y selección ======
  async onPuntoSearch(ev: Event) {
    const term = (ev.target as HTMLInputElement)?.value?.trim() || '';
    if (term.length < 2) {
      this.puntoBusquedaResults.set([]);
      return;
    }
    try {
      const results = await firstValueFrom(this.reservasSvc.buscarPuntos(term));
      this.puntoBusquedaResults.set(results || []);
    } catch {
      this.puntoBusquedaResults.set([]);
      this.navbar.alert.set({
        type: 'error',
        title: 'Error buscando puntos',
        message: 'No fue posible obtener los puntos de encuentro.',
        autoClose: true,
      });
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

  // ====== Horario auto ======
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
        this.navbar.alert.set({
          type: 'warning',
          title: 'Sin horario',
          message: 'No se encontró horario para el punto principal con el tour seleccionado.',
          autoClose: true,
        });
      }
    } catch {
      this.horarioSeleccionado.set(null);
      this.form.get('Id_Horario')?.setValue(null);
      this.navbar.alert.set({
        type: 'error',
        title: 'Error al asignar horario',
        message: 'No fue posible obtener el horario del punto principal.',
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) }],
      });
    }
  }

  // ====== Cambios de Tour / Plan / Moneda ======
  async onTourChange() {
    const idTour = Number(this.form.get('SelectTour')?.value);
    this.form.patchValue({ Id_Plan: null, Id_Horario: null });
    this.horarioSeleccionado.set(null);
    this.preciosRef.set({});
    if (!idTour) return;

    try {
      const planes = await firstValueFrom(this.reservasSvc.getPlanesByTour(idTour));
      this.planes.set(planes || []);
      if (this.planes().length === 1) {
        this.form.get('Id_Plan')?.setValue(this.planes()[0].Id_Plan);
      }

      if (!this.form.get('Id_Moneda')?.value) {
        this.form.get('Id_Moneda')?.setValue(1, { emitEvent: false });
      }

      this.recalcularComisionesPorCanal();
      await this.fijarHorarioAutomatico();
      await this.onPlanMonedaChange(true);
      this.autollenarPrecios();
      this.recalcularTotales();

      // ===== Obtener disponibilidad y configurar datepicker =====
      try {
        const dispo = await firstValueFrom(this.reservasSvc.getDisponibilidadTour(idTour));
        this.disponibilidadActual = dispo || null;
        this.applyDisponibilidadToDatepicker();
      } catch (err) {
        this.disponibilidadActual = null;
        // si falla, no bloqueamos fechas
        this.fpOptionsFecha = { ...this.fpOptionsFecha, disable: [] };
      }

      const teniaInfantes = this.countByTipo('INFANTE') > 0;
      if (teniaInfantes && !this.tourRules.allowsPassengerType(idTour, 'INFANTE')) {
        this.removeInfantes();
        this.navbar.alert.set({
          type: 'warning',
          title: 'Infantes no permitidos',
          message: 'En este tour no se aceptan infantes. Han sido removidos.',
          autoClose: true,
        });
      }

      this.tourRules.resetSession();
    } catch {
      this.navbar.alert.set({
        type: 'error',
        title: 'Error al cambiar tour',
        message: 'No se pudieron cargar los datos del tour seleccionado.',
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) }],
      });
    }

    if (idTour === 5) {
      const ninos = this.countByTipo('NINO');
      const infantes = this.countByTipo('INFANTE');
      if (ninos > 0 && infantes > 0) {
        this.navbar.alert.set({
          type: 'info',
          title: 'Política de Niños e Infantes',
          message: 'En Hacienda Nápoles, los niños ≥5 van como ADULTOS y los infantes >1 año como NIÑOS.',
          autoClose: true,
        });
      } else if (infantes > 0) {
        this.navbar.alert.set({
          type: 'info',
          title: 'Política de Infantes',
          message: 'En Hacienda Nápoles, los infantes >1 año deben ser NIÑOS.',
          autoClose: true,
        });
      } else if (ninos > 0) {
        this.navbar.alert.set({
          type: 'info',
          title: 'Política de Niños',
          message: 'En Hacienda Nápoles, niños ≥5 años deben ir como ADULTOS.',
          autoClose: true,
        });
      }
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
      if (!soloCargar) this.autollenarPrecios();
      this.recalcularTotales();
    } catch {
      this.navbar.alert.set({
        type: 'error',
        title: 'Error al cargar precios',
        message: 'No fue posible obtener los precios para el plan/moneda.',
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) }],
      });
    }
  }

  // ====== Pasajeros ======
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
    this.autollenarPrecios();
    this.recalcularTotales();
  }

  agregarPasajero(tipo: 'ADULTO' | 'NINO' | 'INFANTE', omitirCalculos = false) {
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

    fg.get('DNI')?.valueChanges
      .pipe(
        debounceTime(800),
        distinctUntilChanged(),
        switchMap((dni: string) => {
          if (!dni || dni.trim().length < 3) {
            const ctrl = fg.get('DNI');
            if (ctrl?.errors?.['duplicated']) {
              const errs = { ...ctrl.errors };
              delete errs['duplicated'];
              ctrl.setErrors(Object.keys(errs).length ? errs : null);
            }
            return of(null);
          }
          const fecha = this.form.get('Fecha_Tour')?.value;
          if (!fecha) return of(null);
          return this.reservasSvc.verificarDniDuplicado(dni.trim(), fecha).pipe(
            catchError(() => of(null))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((resultado: any) => {
        if (!resultado) return;
        const ctrl = fg.get('DNI');
        if (resultado.exists && resultado.reserva) {
          if (ctrl) {
            const existing = ctrl.errors ? { ...ctrl.errors } : {};
            existing['duplicated'] = { reserva: resultado.reserva };
            ctrl.setErrors(existing);
          }
          const reserva = resultado.reserva;
          this.navbar.alert.set({
            type: 'warning',
            title: 'Pasajero duplicado',
            message: `El DNI ya está registrado en la reserva ${reserva.Id_Reserva} el ${this.form.get('Fecha_Tour')?.value}.`,
            autoClose: true
          });
        }
      });

    this.pasajeros.push(fg);

    this.tourRules.evaluateAlertsForPassenger(currentTourId, tipo);

    if (!omitirCalculos) {
      this.autollenarPrecios();
      this.recalcularTotales();
    }
  }

  eliminarPasajero(i: number) {
    this.pasajeros.removeAt(i);
    this.autollenarPrecios();
    this.recalcularTotales();
  }

  adultosInputValue(): number { return this.pasajeros.controls.filter(c => c.get('Tipo_Pasajero')?.value === 'ADULTO').length; }
  ninosInputValue(): number { return this.pasajeros.controls.filter(c => c.get('Tipo_Pasajero')?.value === 'NINO').length; }
  infantesInputValue(): number { return this.pasajeros.controls.filter(c => c.get('Tipo_Pasajero')?.value === 'INFANTE').length; }

  setCantidadPasajeros(tipo: 'ADULTO' | 'NINO' | 'INFANTE', val: any) {
    const currentTourId = Number(this.form.get('SelectTour')?.value);
    if (!this.tourRules.allowsPassengerType(currentTourId, tipo)) return;
    const n = Math.max(0, Number(val || 0));
    const cur = this.pasajeros.controls.filter(c => c.get('Tipo_Pasajero')?.value === tipo).length;

    if (n === cur) return;

    if (n > cur) {
      for (let i = 0; i < (n - cur); i++) this.agregarPasajero(tipo, true);
    } else {
      for (let i = cur - 1; i >= n; i--) {
        const idx = this.pasajeros.controls.findIndex(c => c.get('Tipo_Pasajero')?.value === tipo);
        if (idx >= 0) this.pasajeros.removeAt(idx);
      }
    }
    
    this.autollenarPrecios();
    this.recalcularTotales();
  }

  async autollenarPrecios() {
    const idTour = Number(this.form.get('SelectTour')?.value);
    const idCanal = Number(this.form.get('Id_Canal')?.value);

    // Si faltan referencias, limpiar comisiones y mantener precios actuales
    if (!idTour || !idCanal) {
      for (const ctrl of this.pasajeros.controls) {
        ctrl.get('Comision')?.setValue(0, { emitEvent: false });
        // PrecioRef = 0 pero NO tocar Precio_Pasajero si el usuario ya lo editó
        if (!ctrl.get('Precio_Pasajero')?.dirty) {
          ctrl.get('Precio_Pasajero')?.setValue(0, { emitEvent: false });
        }
        ctrl.get('PrecioRef')?.setValue(0, { emitEvent: false });
      }
      this.cdr.markForCheck();
      return;
    }

    try {
      const comisiones = await firstValueFrom(this.reservasSvc.getComisiones(idTour, idCanal));
      // preciosRef(): { ADULTO: number, NINO: number, INFANTE: number }
      const ref = this.preciosRef();

      for (const ctrl of this.pasajeros.controls) {
        const tipo = ctrl.get('Tipo_Pasajero')?.value as 'ADULTO' | 'NINO' | 'INFANTE';

        // Precio_Tour fijo (referencia)
        const precioTour = ref[tipo] ?? 0;
        ctrl.get('PrecioRef')?.setValue(precioTour, { emitEvent: false });

        // Inicializa Precio_Pasajero SOLO si el usuario no lo tocó
        if (!ctrl.get('Precio_Pasajero')?.dirty) {
          // Infante sin costo
          const inicial = precioTour;
          ctrl.get('Precio_Pasajero')?.setValue(inicial, { emitEvent: false });
        }

        // Comisión por pasajero (0 para infantes)
        const com = tipo === 'INFANTE' ? 0 : (comisiones[tipo] || 0);
        ctrl.get('Comision')?.setValue(com, { emitEvent: false });
      }
    } catch {
      // Si falla, setear comisiones a 0
      for (const ctrl of this.pasajeros.controls) {
        ctrl.get('Comision')?.setValue(0, { emitEvent: false });
      }
    }

    this.cdr.markForCheck();
  }

  private applyDisponibilidadToDatepicker() {
    const dispo = this.disponibilidadActual;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // helper: normaliza a “solo fecha”
    const onlyDate = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());

    const normalizeDiaToWeekday = (d: string) => {
      if (!d) return null;
      const s = String(d).trim().toLowerCase();
      switch (s) {
        case 'lunes': return 1;
        case 'martes': return 2;
        case 'miercoles':
        case 'miércoles': return 3;
        case 'jueves': return 4;
        case 'viernes': return 5;
        case 'sabado':
        case 'sábado': return 6;
        case 'domingo': return 0;
        default: return null;
      }
    };

    // Si no hay dispo: solo bloquea pasado
    if (!dispo) {
      this.fpOptionsFecha = { ...this.fpOptionsFecha, minDate: today, disable: [] };

      const fp = this.fechaFp?.instance;
      if (fp) {
        fp.set('minDate', today);
        fp.set('disable', []);
        fp.redraw();
      }

      this.cdr.markForCheck();
      return;
    }

    // modo
    const modoRaw = (dispo.Modo || 'TODO_EL_AÑO').toString().toUpperCase();
    const modoNorm = modoRaw.replace(/Ñ/g, 'N').replace(/Á/g, 'A').replace(/É/g, 'E').replace(/Í/g, 'I').replace(/Ó/g, 'O').replace(/Ú/g, 'U');

    const diasBaseSet = new Set<number>(
      (dispo.Dias_Base || [])
        .map((d: string) => normalizeDiaToWeekday(d))
        .filter((x: any) => x !== null)
    );

    const temporadas = Array.isArray(dispo.Temporadas)
      ? dispo.Temporadas.map((t: any) => ({
        inicio: t.Fecha_Inicio ? new Date(t.Fecha_Inicio) : null,
        fin: t.Fecha_Fin ? new Date(t.Fecha_Fin) : null,
        dias: (t.Dias || [])
          .map((d: string) => normalizeDiaToWeekday(d))
          .filter((x: any) => x !== null) as number[],
      }))
      : [];

    const isAllowed = (date: Date) => {
      const d = onlyDate(date);
      const wk = d.getDay();
      if (d < today) return false;
      for (const t of temporadas) {
        if (!t.inicio || !t.fin) continue;

        const ini = onlyDate(t.inicio);
        const fin = onlyDate(t.fin);

        if (d >= ini && d <= fin) {
          if (!t.dias || t.dias.length === 0) return true;
          return t.dias.includes(wk);
        }
      }

      if (modoNorm === 'SOLO_TEMPORADAS') return false;

      if (diasBaseSet.size > 0) return diasBaseSet.has(wk);

      // ❌ nunca permitir por defecto
      return false;
    };

    const disableFn = (date: Date) => !isAllowed(date);

    // 1) Actualiza options (por si tu template los usa)
    this.fpOptionsFecha = {
      ...this.fpOptionsFecha,
      minDate: today,
      disable: [disableFn],
    };

    // 2) 🔥 ACTUALIZA LA INSTANCIA YA CREADA (esto es lo que te faltaba)
    const fp = this.fechaFp?.instance;
    if (fp) {
      fp.set('minDate', today);
      fp.set('disable', [disableFn]);
      fp.redraw();
    }

    // 3) Limpia fecha inválida si quedó seleccionada/typed
    const cur = this.form.get('Fecha_Tour')?.value;
    if (cur) {
      // si viene como string en el formato interno, mejor validar con flatpickr si existe:
      const curDate = fp?.parseDate ? fp.parseDate(cur, 'Y-m-d') : new Date(cur);
      if (curDate && disableFn(curDate)) {
        this.form.get('Fecha_Tour')?.setValue(null);
        fp?.clear();
      }
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

  // Totales / pagos
  totalNeto(): number {
    // Suma lo que realmente se cobra (no la referencia)
    let sum = 0;
    for (const c of this.pasajeros.controls) {
      const precio = Number(c.get('Precio_Pasajero')?.value || 0);

      sum += precio;
    }
    return sum;
  }

  comisionTotal(): number {
    let sum = 0;
    for (const c of this.pasajeros.controls) {
      const comision = Number(c.get('Comision')?.value || 0);
      sum += comision;
    }
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

  // ====== Cupos ======
  async verificarCuposDisponibles(): Promise<void> {
    const Fecha = this.form.get('Fecha_Tour')?.value;
    const Id_Tour = this.form.get('SelectTour')?.value;
    const cant = this.pasajerosConAsiento();
    if (!Fecha || !Id_Tour) return;

    try {
      const data = await firstValueFrom(this.reservasSvc.verificarCupos(Fecha, Number(Id_Tour), cant));
      if (!data?.disponible) {
        this.navbar.alert.set({
          type: 'warning', title: 'Cupos insuficientes',
          message: `Solo hay ${data?.cuposDisponibles ?? 0} cupos disponibles para este tour.`,
          autoClose: false,
          buttons: [{ text: 'Entendido', style: 'secondary', onClick: () => this.navbar.alert.set(null) }],
        });
      }
    } catch {
      this.navbar.alert.set({
        type: 'error', title: 'Error al verificar cupos',
        message: 'No fue posible verificar los cupos disponibles.', autoClose: false,
        buttons: [
          { text: 'Reintentar', style: 'primary', onClick: () => { this.navbar.alert.set(null); this.verificarCuposDisponibles(); } },
          { text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) },
        ],
      });
    }
  }

  CuposDisponiblesNavbar(): void {
    const { Fecha_Tour, SelectTour, Tipo_Reserva } = this.form.value;
    const totalPasajeros = this.pasajerosConAsiento();
    if (Tipo_Reserva !== 'Grupal') { this.navbar.cuposInfo.set(null); return; }
    if (Fecha_Tour && SelectTour) {
      this.reservasSvc.verificarCupos(Fecha_Tour, SelectTour, totalPasajeros).subscribe({
        next: (data) => this.navbar.cuposInfo.set({ ...data }),
        error: () => this.navbar.cuposInfo.set(null)
      });
    } else {
      this.navbar.cuposInfo.set(null);
    }
  }

  // ====== Submit ======

  // Añade esto dentro de tu componente (CrearReservaComponent)
  private confirmarReserva(titulo: string, mensaje: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.navbar.alert.set({
        type: 'info',
        title: titulo,
        message: mensaje,
        autoClose: false,
        buttons: [
          {
            text: 'Cancelar',
            style: 'secondary',
            onClick: () => { this.navbar.alert.set(null); resolve(false); },
          },
          {
            text: 'Confirmar',
            style: 'primary',
            onClick: () => { this.navbar.alert.set(null); resolve(true); },
          },
        ],
      });
    });
  }

  async onSubmit(): Promise<void> {
    if (this.isSubmitting()) return;
    this.isSubmitting.set(true);
    this.openSummary = false;
    // ===== Helpers locales =====
    const confirmar = (titulo: string, mensaje: string): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
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

    // (Helpers transferidos a métodos privados de la clase)

    // ===== Validación del formulario ANTES de confirmar =====
    this.form.updateValueAndValidity({ emitEvent: false });
    if (this.form.invalid) {
      this.form.markAllAsTouched();

      // Detectar campos inválidos con nombres amigables
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
        : 'Hay campos inválidos en el formulario.';

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

    // WhatsApp verification removed — proceeding without check

    // Validar que haya al menos un pasajero
    if (this.pasajeros.length === 0) {
      this.navbar.alert.set({
        type: 'error',
        title: 'Sin pasajeros',
        message: 'Debes agregar al menos un pasajero para crear la reserva.',
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) }]
      });
      this.isSubmitting.set(false);
      return;
    }

    // ===== Verificar duplicados por DNI =====
    const dupCtrl = this.pasajeros.controls.find(c => c.get('DNI')?.errors?.['duplicated']);
    if (dupCtrl) {
      const dupErr = dupCtrl.get('DNI')?.errors?.['duplicated'];
      const reserva = dupErr?.reserva;
      const dniVal = dupCtrl.get('DNI')?.value;
      this.navbar.alert.set({
        type: 'error',
        title: 'Pasajero duplicado',
        message: `No es posible crear la reserva: el DNI ${dniVal} ya aparece en la reserva ${reserva?.Id_Reserva} (${reserva?.Nombre_Tour}) el ${this.form.get('Fecha_Tour')?.value}.`,
        autoClose: false,
        buttons: [
          { text: 'Ver reserva existente', style: 'primary', onClick: () => { this.navbar.alert.set(null); this.verReservaDuplicada(reserva?.Id_Reserva); } },
          { text: 'Corregir DNI', style: 'secondary', onClick: () => this.navbar.alert.set(null) }
        ]
      });
      this.isSubmitting.set(false);
      return;
    }

    // ===== Confirmación con resumen =====
    const tourNombre =
      this.tours().find(t => t.Id_Tour === Number(this.form.get('SelectTour')?.value))?.Nombre_Tour ?? '—';
    const fecha = this.form.get('Fecha_Tour')?.value ?? '—';
    const ad = this.pasajeros.controls.filter(c => c.get('Tipo_Pasajero')?.value === 'ADULTO').length;
    const ni = this.pasajeros.controls.filter(c => c.get('Tipo_Pasajero')?.value === 'NINO').length;
    const infa = this.pasajeros.controls.filter(c => c.get('Tipo_Pasajero')?.value === 'INFANTE').length;
    const totalNeto = this.totalNeto();

    const ok = await confirmar(
      '¿Todo listo?',
      `Vas a crear la reserva para ${tourNombre} para ${fecha}.
     Pasajeros: Adultos ${ad} • Niños ${ni} • Infantes ${infa}.
     Total neto: ${this.monedaCodigo()} ${totalNeto}.
     ¿Deseas continuar?`
    );

    if (!ok) {
      this.isSubmitting.set(false);
      return;
    }

    try {

      // ===== PASAJEROS =====
      const pax = this.pasajeros.controls.map(c => ({
        Nombre_Pasajero: c.get('Nombre_Pasajero')?.value || '',
        DNI: c.get('DNI')?.value || null,
        Telefono_Pasajero: c.get('Telefono_Pasajero')?.value || null,
        Tipo_Pasajero: c.get('Tipo_Pasajero')?.value,
        Id_Punto: (() => {
          const rawIndividual = c.get('Id_Punto')?.value ?? c.get('PuntoEncuentro')?.value;
          const parsedIndividual = rawIndividual !== null && rawIndividual !== undefined && rawIndividual !== ''
            ? Number(rawIndividual)
            : null;
          if (Number.isFinite(parsedIndividual as number)) return parsedIndividual;

          const rawGlobal = this.form.get('Id_Punto')?.value;
          const parsedGlobal = rawGlobal !== null && rawGlobal !== undefined && rawGlobal !== ''
            ? Number(rawGlobal)
            : null;
          return Number.isFinite(parsedGlobal as number) ? parsedGlobal : null;
        })(),
        Confirmacion: false,
        Precio_Tour: Number(c.get('PrecioRef')?.value || 0),         // fijo por tipo
        Precio_Pasajero: Number(c.get('Precio_Pasajero')?.value || 0),   // editable (input)
        Comision: Number(c.get('Comision')?.value || 0),          // 
      }));

      // ===== PAGOS + ARCHIVOS =====
      type PagoTipo = 'Pago Directo' | 'Pago Completo' | 'Abono';
      const pagos: Array<{ Monto: number; Tipo: PagoTipo; fileField?: string }> = [];
      const archivos: { completo?: File | null; abonos?: (File | null)[] } = { abonos: [] };

      const forma = this.form.get('FormaPago')?.value as 'Directo' | 'Completo' | 'Abono';
      let comprobanteCompletoFile: File | null = null;

      if (forma === 'Directo') {
        pagos.push({ Monto: totalNeto, Tipo: 'Pago Directo' });
      } else if (forma === 'Completo') {
        const file: File | null = this.form.get('ComprobantePago')?.value || null;
        pagos.push({ Monto: totalNeto, Tipo: 'Pago Completo', fileField: 'comprobante_pago' });
        archivos.completo = file;
        comprobanteCompletoFile = file;
      } else if (forma === 'Abono') {
        this.abonos.controls.forEach((g, i) => {
          const monto = Number(g.get('Monto')?.value || 0);
          const f: File | null = g.get('Comprobante')?.value || null;
          if (monto > 0) pagos.push({ Monto: monto, Tipo: 'Abono', fileField: `abono_${i}` });
          archivos.abonos!.push(f);
        });
      }

      // ===== CABECERA (con Estado calculado) =====
      const { estado, subestado, motivo } = this.resolverEstadoYMotivo(
        pax,
        forma,
        !!comprobanteCompletoFile
      );

      const cab = {
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
        Estado: estado, // <- persistimos el estado decidido
      };

      // ===== ENVÍO =====
      const payload = { cabeceraReserva: cab, pasajeros: pax, pagos };
      const res = await firstValueFrom(this.reservasSvc.crearReserva(payload, archivos));

      if (res?.Id_Reserva) {
        this.navbar.needsRefresh.set('reservas');

        const estadoTexto = subestado ? `${estado} ${subestado}` : estado;
        this.navbar.alert.set({
          type: 'success',
          title: 'Reserva creada',
          message: `
          La reserva ${res.Id_Reserva} ha sido generada correctamente.
          Estado: ${estadoTexto}.
        `,
          autoClose: false,
          buttons: [
            { text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) },
            { text: 'Ver Reserva', style: 'primary', onClick: () => { this.navbar.alert.set(null); this.navbar.cuposInfo.set(null); this.navbar.Id_Reserva.set(res.Id_Reserva); } },
          ],
        });

        // Limpiezas
        this.abonos.clear();
        this.pasajeros.clear();
        this.puntosSeleccionados.set([]);
        this.horarioSeleccionado.set(null);
        this.preciosRef.set({});
        this.navbar.cuposInfo.set(null);
        this.form.reset();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        this.openSummary = false;
        this.form.markAsPristine();
        this.cdr.markForCheck();
      } else {
        this.navbar.alert.set({
          type: 'error',
          title: 'Error al crear reserva',
          message: 'No se pudo crear la reserva. Revisa los datos e intenta nuevamente.',
          autoClose: false,
          buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) }],
        });
      }
    } catch (err) {
      console.error('Error al crear reserva:', err);
      this.navbar.alert.set({
        type: 'error',
        title: 'Error al crear reserva',
        message: 'Ocurrió un problema al enviar la reserva al servidor.',
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

  getPhoneError(controlName: string): string {
    const ctrl = this.form?.get(controlName);
    if (!ctrl) return 'Teléfono inválido.';
    if (ctrl.hasError('required')) return 'El teléfono es obligatorio.';
    if (ctrl.hasError('pattern')) {
      return "Debe iniciar con '+' y tener indicativo + exactamente 10 dígitos del número (ej: +573001234567).";
    }
    return 'Teléfono inválido.';
  }



  // utilidad
  seleccionarTexto(e: any) { e?.target?.select?.(); }
  horaSalida(): string { return this.horarioSeleccionado()?.HoraSalida || ''; }

  // ====== Files ======
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const ctrl = this.form.get('ComprobantePago');
    if (!input?.files?.length || !ctrl) return;

    const file = input.files[0];

    // Validación de tamaño
    if (file.size > 5 * 1024 * 1024) {
      this.navbar.alert.set({
        type: 'warning',
        title: 'Archivo muy grande',
        message: 'El máximo permitido es 5 MB.',
        autoClose: true,
      });
      ctrl.setValue(null);
      input.value = '';
      return;
    }

    // Validación de tipo
    const ok = /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (!ok) {
      this.navbar.alert.set({
        type: 'warning',
        title: 'Formato no permitido',
        message: 'Sólo PDF, JPG o PNG.',
        autoClose: true,
      });
      ctrl.setValue(null);
      input.value = '';
      return;
    }

    // Setea el File en el control
    ctrl.setValue(file);
    ctrl.markAsDirty();
    ctrl.updateValueAndValidity({ emitEvent: false });

    // Mostrar nombre del archivo en la interfaz
    this.navbar.alert.set({
      type: 'success',
      title: 'Archivo cargado',
      message: `Se ha cargado el comprobante: ${file.name}`,
      autoClose: true,
    });

    // Lógica adicional para Pago Completo
    if (this.form.get('FormaPago')?.value === 'Completo') {
      this.navbar.alert.set({
        type: 'success',
        title: 'Archivo cargado',
        message: `Se ha cargado el archivo: ${file.name}`,
        autoClose: true,
      });
    }
  }

  onAbonoFileSelected(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const abonoControl = this.abonos.at(index) as FormGroup;
    if (!input?.files?.length || !abonoControl) return;

    const file = input.files[0];

    // Validación de tamaño
    if (file.size > 5 * 1024 * 1024) {
      this.navbar.alert.set({
        type: 'warning',
        title: 'Archivo muy grande',
        message: 'El máximo permitido es 5 MB.',
        autoClose: true,
      });
      abonoControl.get('Comprobante')?.setValue(null);
      input.value = '';
      return;
    }

    // Validación de tipo
    const ok = /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (!ok) {
      this.navbar.alert.set({
        type: 'warning',
        title: 'Formato no permitido',
        message: 'Sólo PDF, JPG o PNG.',
        autoClose: true,
      });
      abonoControl.get('Comprobante')?.setValue(null);
      input.value = '';
      return;
    }

    // Setea el File en el control
    abonoControl.get('Comprobante')?.setValue(file);
    abonoControl.markAsDirty();
    abonoControl.updateValueAndValidity({ emitEvent: false });

    // Mostrar nombre del archivo en la interfaz
    this.navbar.alert.set({
      type: 'success',
      title: 'Archivo cargado',
      message: `Se ha cargado el archivo: ${file.name}`,
      autoClose: true,
    });
  }

  // ===================== Comprobante preview / actions =====================
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

  triggerComprobanteUpload() {
    const input = document.getElementById('ComprobantePago') as HTMLInputElement | null;
    input?.click();
  }

  deleteComprobante() {
    const ctrl = this.form.get('ComprobantePago');
    const currentValue: any = ctrl?.value;

    this.navbar.alert.set({
      type: 'warning',
      title: 'Eliminar comprobante',
      message: 'Esta acción eliminará el comprobante actual. ¿Deseas continuar?',
      autoClose: false,
      buttons: [
        { text: 'Cancelar', style: 'secondary', onClick: () => this.navbar.alert.set(null) },
        {
          text: 'Eliminar',
          style: 'primary',
          onClick: () => {
            this.navbar.alert.set(null);

            const idPago = Number(currentValue?.Id_Pago);
            const idReservaRaw = currentValue?.Id_Reserva || this.navbar.Id_Reserva?.();
            const idReserva = idReservaRaw ? String(idReservaRaw) : '';

            if (Number.isFinite(idPago) && idPago > 0 && idReserva) {
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
              title: 'Archivo eliminado',
              message: 'Se eliminó del formulario local. Guarda para persistir cambios.',
              autoClose: true,
            });
          },
        },
      ],
    });
  }

  private clearComprobanteLocalState(): void {
    const ctrl = this.form.get('ComprobantePago');
    if (ctrl) {
      ctrl.setValue(null);
      ctrl.markAsDirty();
      ctrl.updateValueAndValidity({ emitEvent: false });
    }

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

  private validarDatosPasajeros(pax: Array<any>) {
    let faltanNombre = 0;
    let faltanDni = 0;
    let hayTelefonoPasajero = false;

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

    return {
      ok: okNombres && okDni && hayTelefonoPasajero,
      okNombres,
      okDni,
      hayTelefonoPasajero,
      faltanNombre,
      faltanDni,
    };
  }

  private resolverEstadoYMotivo(
    pasajeros: Array<any>,
    formaPago: 'Directo' | 'Completo' | 'Abono',
    tieneComprobanteCompleto: boolean
  ): { estado: 'Confirmada' | 'Pendiente'; subestado: 'de datos' | 'de pago' | null; motivo: string } {

    const val = this.validarDatosPasajeros(pasajeros);

    // Falta información de pasajeros -> Pendiente de datos
    if (!val.ok) {
      const partes: string[] = [];
      if (!val.okNombres) partes.push(`faltan ${val.faltanNombre} nombre(s)`);
      if (!val.okDni) partes.push(`faltan ${val.faltanDni} DNI/pasaporte(s)`);
      if (!val.hayTelefonoPasajero) partes.push('no hay ningún teléfono de pasajero');
      const razon = `Faltan datos básicos de pasajeros: ${partes.join('; ')}.`;
      return { estado: 'Pendiente', subestado: 'de datos', motivo: razon };
    }

    // Datos OK -> evaluar pago
    if (formaPago === 'Directo') {
      return { estado: 'Confirmada', subestado: null, motivo: 'Pago directo y datos completos.' };
    }

    if (formaPago === 'Completo') {
      if (tieneComprobanteCompleto) {
        return { estado: 'Confirmada', subestado: null, motivo: 'Pago completo con comprobante y datos completos.' };
      } else {
        return { estado: 'Pendiente', subestado: 'de pago', motivo: 'Falta el comprobante del pago completo.' };
      }
    }

    // Abono: siempre pendiente de pago si los datos están completos
    return { estado: 'Pendiente', subestado: 'de pago', motivo: 'Se registró un abono. Falta completar el pago.' };
  }

  // ====== Verificación DNI (Refactorizado con switchMap) ======

  private verReservaDuplicada(idReserva: string) {

    this.navbar.Id_Reserva.set(idReserva);
  }

  duplicarReserva() {
    // No implementado en creación, pero requerido por el template compartido/estandarizado
    console.warn('duplicarReserva no está implementado en CrearReservaComponent');
  }

}



