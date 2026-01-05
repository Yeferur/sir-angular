import { Component, OnInit, ChangeDetectorRef, inject, signal, computed, effect } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from '../../../../environments/environment';
import { ActivatedRoute } from '@angular/router';
import { CommonModule, DecimalPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { WebSocketService } from '../../../services/WebSocket/web-socket';
import {
  Reservas, Tour, Canal, Moneda, Plan, Horario, PrecioMap, Punto,
} from '../../../services/Reservas/reservas';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { DuplicarPanelComponent } from '../../../DynamicNavbar/duplicar-panel/duplicar-panel';

@Component({
  selector: 'app-editar-reserva',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DecimalPipe],
  templateUrl: './editar-reserva.html',
  styleUrls: ['./editar-reserva.css'],
})
export class EditarReservaComponent implements OnInit {

  openSummary = false;

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

  // Estado
  isLoading = signal<boolean>(true);
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

  // Puntos de encuentro (chips + búsqueda)
  puntosSeleccionados = signal<Punto[]>([]);
  puntoBusquedaResults = signal<Punto[]>([]);

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
      Indicativo: ['+57'],
      Telefono_Reportante: ['', [Validators.required, Validators.pattern(/^\d{10}$/)]],
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
    this.wsService.messages$.subscribe((msg: any) => {
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

    // Además, escuchar cambios en los parámetros de la ruta si Angular reutiliza el componente
    this.route.paramMap.subscribe(pm => {
      const newId = pm.get('Id_Reserva') ?? pm.get('id');
      if (newId && newId !== this.reservaId()) {
        this.reservaId.set(newId);
        this.cargarReservaExistente(newId).then(() => this.cdr.markForCheck());
      }
    });

    // React to Id_Reserva changes from the Dynamic Navbar: if user clicks "Editar" there,
    // the navbar service will set Id_Reserva; when it changes, reload this editor with the new id.
    effect(() => {
      const navId = this.navbar.Id_Reserva();
      if (navId && navId !== this.reservaId()) {
        // load new reservation into the editor
        this.reservaId.set(navId);
        this.cargarReservaExistente(navId).then(() => this.cdr.markForCheck());
      }
    });

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
        Indicativo: data?.Cabecera?.Indicativo ?? data?.Indicativo ?? '+57',
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
          Telefono_Pasajero: [p.Telefono_Pasajero ?? p.TelefonoPasajero ?? ''],
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
          this.form.get('ComprobantePago')?.setValue(null); // No se puede rehidratar el archivo
          this.form.get('ComprobantePago')?.patchValue({ SoporteUrl: pagoCompleto.Ruta_Comprobante || pagoCompleto.SoporteUrl || null });
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

      // Políticas específicas (igual que crear)
      if (this.isRioClaroTour()) {
        const teniaInfantes = this.countByTipo('INFANTE') > 0;
        if (teniaInfantes) {
          this.removeInfantes();
          this.navbar.alert.set({ type: 'warning', title: 'Infantes no permitidos', message: 'En Río Claro no se aceptan infantes (menores de 5 años). Han sido removidos.', autoClose: true });
        }
        this.maybeShowNinosAgeReminder();
      }
      if (this.isHaciendaNapolesTour()) this.maybeShowHNChildrenPolicyOnce(); else { this.hnNinosPolicyShown = false; this.hnInfantesPolicyShown = false; }

    } catch {
      this.navbar.alert.set({ type: 'error', title: 'Error al cambiar tour', message: 'No se pudieron cargar los datos del tour seleccionado.', autoClose: false });
    }

    if (idTour === 5) {
      const ninos = this.countByTipo('NINO');
      const infantes = this.countByTipo('INFANTE');
      if (ninos > 0 && infantes > 0) this.navbar.alert.set({ type: 'info', title: 'Política de Niños e Infantes', message: 'En Hacienda Nápoles, los niños ≥5 van como ADULTOS y los infantes >1 año como NIÑOS.', autoClose: true });
      else if (infantes > 0) this.navbar.alert.set({ type: 'info', title: 'Política de Infantes', message: 'En Hacienda Nápoles, los infantes >1 año deben ser NIÑOS.', autoClose: true });
      else if (ninos > 0) this.navbar.alert.set({ type: 'info', title: 'Política de Niños', message: 'En Hacienda Nápoles, niños ≥5 años deben ir como ADULTOS.', autoClose: true });
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
  private hnNinosPolicyShown = false;
  private hnInfantesPolicyShown = false;
  isHaciendaNapolesTour(): boolean { return Number(this.form?.get('SelectTour')?.value) === 5; }
  private maybeShowHNChildrenPolicyOnce(): void {
    if (!this.isHaciendaNapolesTour()) { this.hnNinosPolicyShown = false; this.hnInfantesPolicyShown = false; return; }
    const ninos = this.countByTipo('NINO');
    const infantes = this.countByTipo('INFANTE');
    if (ninos > 0 && !this.hnNinosPolicyShown) { this.hnNinosPolicyShown = true; this.navbar.alert.set({ type: 'info', title: 'Política de Niños', message: 'Niños ≥5 van como ADULTOS.', autoClose: true }); }
    if (infantes > 0 && !this.hnInfantesPolicyShown) { this.hnInfantesPolicyShown = true; this.navbar.alert.set({ type: 'info', title: 'Política de Infantes', message: 'Infantes >1 año van como NIÑOS.', autoClose: true }); }
    if (ninos > 0 && infantes > 0) this.navbar.alert.set({ type: 'info', title: 'Niños e Infantes', message: 'Niños ≥5 → ADULTOS; infantes >1 → NIÑOS.', autoClose: true });
    if (ninos === 0 && infantes === 0) { this.hnNinosPolicyShown = false; this.hnInfantesPolicyShown = false; }
  }
  private ninosAlertShown = false;
  isRioClaroTour(): boolean { return Number(this.form?.get('SelectTour')?.value) === 1; }
  private countByTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): number {
    return this.pasajeros.controls.filter(c => c.get('Tipo_Pasajero')?.value === tipo).length;
  }
  private removeInfantes(): void {
    for (let i = this.pasajeros.length - 1; i >= 0; i--) {
      if (this.pasajeros.at(i)?.get('Tipo_Pasajero')?.value === 'INFANTE') this.pasajeros.removeAt(i);
    }
    this.recalcularTotales();
  }
  private maybeShowNinosAgeReminder(): void {
    if (!this.isRioClaroTour()) { this.ninosAlertShown = false; return; }
    const ninos = this.countByTipo('NINO');
    if (ninos > 0 && !this.ninosAlertShown) {
      this.ninosAlertShown = true;
      this.navbar.alert.set({ type: 'info', title: 'Recuerda', message: 'Para este tour, los niños deben tener 5+ años.', autoClose: true });
    }
    if (ninos === 0) this.ninosAlertShown = false;
  }

  agregarPasajero(tipo: 'ADULTO' | 'NINO' | 'INFANTE') {
    if (tipo === 'INFANTE' && this.isRioClaroTour()) return;
    const principalPunto = this.form.get('Id_Punto')?.value ?? null;
    const fg = this.fb.group({
      Tipo_Pasajero: [tipo, Validators.required],
      Nombre_Pasajero: [''],
      DNI: [''],
      Indicativo_Pasajero: ['+57'],
      Telefono_Pasajero: [''],
      Id_Punto: [principalPunto],
      Confirmacion: [false],
      PrecioRef: [0],
      Precio_Pasajero: [0, [Validators.min(0)]],
      Comision: [0],
    });
    this.pasajeros.push(fg);
    if (this.isHaciendaNapolesTour()) this.maybeShowHNChildrenPolicyOnce();
    if (tipo === 'NINO') this.maybeShowNinosAgeReminder?.();
    // Solo para NUEVOS: autollenar referencia inicial
    this.autollenarPrecios();
    this.recalcularTotales();
  }

  eliminarPasajero(i: number) {
    const tipo = this.pasajeros.at(i)?.get('Tipo_Pasajero')?.value;
    this.pasajeros.removeAt(i);
    this.recalcularTotales();
    if (tipo === 'NINO') this.maybeShowHNChildrenPolicyOnce();
    if (tipo === 'NINO') this.maybeShowNinosAgeReminder?.();
  }

  adultosInputValue(): number { return this.countByTipo('ADULTO'); }
  ninosInputValue(): number { return this.countByTipo('NINO'); }
  infantesInputValue(): number { return this.countByTipo('INFANTE'); }

  setCantidadPasajeros(tipo: 'ADULTO' | 'NINO' | 'INFANTE', val: any) {
    if (tipo === 'INFANTE' && this.isRioClaroTour()) return;
    const n = Math.max(0, Number(val || 0));
    const cur = this.countByTipo(tipo);

    if (n > cur) for (let i = 0; i < (n - cur); i++) this.agregarPasajero(tipo);
    else if (n < cur) {
      for (let i = cur - 1; i >= n; i--) {
        const idx = this.pasajeros.controls.findIndex(c => c.get('Tipo_Pasajero')?.value === tipo);
        if (idx >= 0) this.pasajeros.removeAt(idx);
      }
      this.recalcularTotales();
    }
    if (tipo === 'NINO') this.maybeShowHNChildrenPolicyOnce();
    if (tipo === 'NINO') this.maybeShowNinosAgeReminder?.();
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
    // Forzar que el usuario escoja una nueva fecha (no permitir misma fecha)
    // Preparar datos y abrir panel en la Dynamic Navbar para seleccionar Tour/Fecha
    this.openSummary = false;
    try {
      // Ajustes previos: no copiar archivos, quitar confirmaciones
      this.abonos.clear();
      this.form.get('ComprobantePago')?.setValue(null);
      for (const fg of this.pasajeros.controls) fg.get('Confirmacion')?.setValue(false);

      // Ajustes para Hacienda Nápoles (tipo mapping permanece)
      if (this.isHaciendaNapolesTour()) {
        for (const ctrl of this.pasajeros.controls) {
          const tipo = ctrl.get('Tipo_Pasajero')?.value;
          if (tipo === 'NINO') ctrl.get('Tipo_Pasajero')?.setValue('ADULTO');
          else if (tipo === 'INFANTE') ctrl.get('Tipo_Pasajero')?.setValue('NINO');
        }
        this.maybeShowHNChildrenPolicyOnce();
      }

      // Si destino es Río Claro y hay infantes, pedir confirmación para eliminar o cancelar
      if (Number(this.form.get('SelectTour')?.value) === 1 && this.countByTipo('INFANTE') > 0) {
        const quitar = await this.confirmarOpciones('Infantes detectados', 'Hay pasajeros tipo INFANTE y Río Claro no los permite. ¿Eliminar infantes o cancelar duplicación?', [
          { key: 'eliminar', text: 'Eliminar infantes' },
          { key: 'cancelar', text: 'Cancelar' }
        ]);
        if (!quitar || quitar === 'cancelar') return;
        if (quitar === 'eliminar') this.removeInfantes();
      }

      // Asegurar punto principal está seteado
      const principal = this.puntosSeleccionados()[0] ?? null;
      this.form.get('Id_Punto')?.setValue(principal?.Id_Punto ?? null);

      // Abrir panel de duplicación en la barra dinámica
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

            // Cerrar el panel primero para que los alerts no queden detrás del panel
            this.navbar.closePanel();
            await Promise.resolve(); // deja respirar el render

            // 1) Validar fecha distinta (SIN tocar form)
            const origFecha =
              this.originalReserva?.Cabecera?.Fecha_Tour ??
              this.originalReserva?.FechaReserva ??
              this.form.get('Fecha_Tour')?.value;

            const origFechaNorm = String(origFecha || '').slice(0, 10);

            if (!targetFecha || targetFecha === origFechaNorm) {
              this.navbar.alert.set({
                type: 'warning',
                title: 'Fecha inválida',
                message: 'La fecha debe ser distinta a la original.',
                autoClose: true
              });
              return;
            }

            // 2) Restricciones (preguntas) usando los pasajeros actuales (SIN tocar form)
            const okRestricciones = await this.confirmarRestriccionesAntesDeDuplicar(targetTourId);
            if (!okRestricciones) return;

            // 3) Crear duplicada (SIN tocar form original)
            await this.crearReservaDuplicada({
              Id_Tour: targetTourId,
              Fecha_Tour: targetFecha,
              Observaciones: typeof Observaciones === 'string' ? Observaciones.trim() : null
              
            });
            console.log('Duplicando reserva a', { Id_Tour: targetTourId, Fecha_Tour: targetFecha, Observaciones });
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

      // 1) Construir pax desde el form, pero clonados
      let pax = this.pasajeros.controls.map(c => ({
        Nombre_Pasajero: c.get('Nombre_Pasajero')?.value || '',
        DNI: c.get('DNI')?.value || null,
        Telefono_Pasajero: c.get('Telefono_Pasajero')?.value || null,
        Tipo_Pasajero: c.get('Tipo_Pasajero')?.value,
        Id_Punto: c.get('Id_Punto')?.value || this.form.get('Id_Punto')?.value || null,
        Confirmacion: false, // duplicada arranca en false
        Precio_Tour: Number(c.get('PrecioRef')?.value || 0),
        Precio_Pasajero: Number(c.get('Precio_Pasajero')?.value || 0),
        Comision: Number(c.get('Comision')?.value || 0),
      }));

      // 2) Aplicar restricciones SOLO a pax (no al form)
      const ninos = pax.filter(p => p.Tipo_Pasajero === 'NINO').length;
      const infantes = pax.filter(p => p.Tipo_Pasajero === 'INFANTE').length;

      // Río Claro: eliminar infantes (ya confirmado antes)
      if (targetTourId === 1 && infantes > 0) {
        pax = pax.filter(p => p.Tipo_Pasajero !== 'INFANTE');
      }

      // Hacienda Nápoles: mapear (ya confirmado antes)
      if (targetTourId === 5 && (ninos > 0 || infantes > 0)) {
        pax = pax.map(p => {
          if (p.Tipo_Pasajero === 'NINO') return { ...p, Tipo_Pasajero: 'ADULTO' };
          if (p.Tipo_Pasajero === 'INFANTE') return { ...p, Tipo_Pasajero: 'NINO' };
          return p;
        });
      }

      // 3) Cabecera SIN usar SelectTour/Fecha del form
      // Determinar punto principal y recalcular Id_Horario para el tour destino
      const principal = this.puntosSeleccionados()[0] ?? null;
      const Id_Punto = principal?.Id_Punto ?? this.form.get('Id_Punto')?.value ?? null;
      let horarioId = this.form.get('Id_Horario')?.value || null;
      if (Id_Punto) {
        try {
          const horario = await firstValueFrom(this.reservasSvc.getHorarioPorPunto(Id_Punto, targetTourId));
          if (horario?.Id_Horario) horarioId = horario.Id_Horario;
        } catch (e) {
          console.warn('No se pudo recalcular horario para punto/tour destino', e);
        }
      }

      const cab = {
        Tipo_Reserva: this.form.get('Tipo_Reserva')?.value,
        Id_Horario: horarioId,
        Fecha_Tour: overrides.Fecha_Tour,
        Id_Canal: this.form.get('Id_Canal')?.value,
        Idioma_Reserva: this.form.get('Idioma_Reserva')?.value,
        Telefono_Reportante: this.form.get('Telefono_Reportante')?.value,
        Nombre_Reportante: this.form.get('Nombre_Reportante')?.value,
        Observaciones: overrides.Observaciones ?? this.form.get('Observaciones')?.value,
        Id_Tour: targetTourId,
        Id_Punto: Id_Punto,
      };

      // 4) Total del payload (sumando pax)
      const totalNeto = pax.reduce((acc, p) => acc + Number(p.Precio_Pasajero || 0), 0);

      const payload: any = {
        cabeceraReserva: cab,
        pasajeros: pax,
        pagos: [{ Monto: totalNeto, Tipo: 'Pago Directo' }]
      };
      console.log('Payload duplicada:', payload);
      const res = await firstValueFrom(this.reservasSvc.crearReserva(payload, { abonos: [] }));

      const rAny: any = res as any;
      const nuevoId =
        rAny?.Id_Reserva ?? rAny?.id ?? rAny?.reservaId ?? rAny?.data?.Id_Reserva ?? null;

      if (!nuevoId) {
        this.navbar.alert.set({ type: 'success', title: 'Reserva creada', message: 'Reserva duplicada correctamente.', autoClose: true });
        return;
      }

      // 5) Mostrar alert con botón que ABRE PANEL (NO navegar)
      this.navbar.alert.set({
        type: 'success',
        title: 'Reserva creada',
        message: `Reserva duplicada: ${nuevoId}`,
        autoClose: false,
        buttons: [
          { text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) },
          { text: 'Ver Reserva', style: 'primary', onClick: () => { this.navbar.alert.set(null); this.abrirReservaEnNavbar(String(nuevoId)); } }
        ]
      });

    } catch (err) {
      console.error(err);
      this.navbar.alert.set({
        type: 'error',
        title: 'Error',
        message: 'No fue posible crear la reserva duplicada.',
        autoClose: false
      });
    }
  }


  private async confirmarRestriccionesAntesDeDuplicar(targetTourId: number): Promise<boolean> {
    const ninos = this.countByTipo('NINO');
    const infantes = this.countByTipo('INFANTE');
    const hayMenores = (ninos + infantes) > 0;

    // Aviso general de edades (una sola vez)
    if (hayMenores) {
      this.navbar.alert.set({
        type: 'warning',
        title: 'Verifica edades',
        message: 'Hay NIÑOS/INFANTES. Verifica que cumplan la edad mínima del tour.',
        autoClose: true
      });
    }

    // Río Claro (1): no permite INFANTE
    if (targetTourId === 1 && infantes > 0) {
      const decision = await this.confirmarOpciones(
        'Infantes no permitidos',
        `Este tour NO permite INFANTES. Actualmente tienes ${infantes} infante(s). Desea eliminarlos y continuar o cancelar la duplicación?`,
        [
          { key: 'eliminar', text: 'Eliminar', style: 'primary' },
        ]
      );
      if (decision !== 'eliminar') return false;

      // OJO: esto modifica el form (pasajeros). Si NO quieres tocar el form original,
      // NO borres aquí. En vez de eso, lo haremos en el payload (abajo).
      // Así que solo confirmamos y seguimos.
      return true;
    }

    // Hacienda Nápoles (5): sugerir ajuste, pero preguntar
    if (targetTourId === 5 && (ninos > 0 || infantes > 0)) {
      const decision = await this.confirmarOpciones(
        'Política: Hacienda Nápoles',
        `Tienes ${ninos} niño(s) y ${infantes} infante(s).\n` +
        `¿Deseas aplicar el ajuste sugerido (NIÑO→ADULTO, INFANTE→NIÑO) o cancelar?`,
        [
          { key: 'ajustar', text: 'Aplicar ajuste', style: 'primary' },
        ]
      );
      if (decision !== 'ajustar') return false;
      return true;
    }

    return true;
  }

  private abrirReservaEnNavbar(idReserva: string) {

    this.navbar.alert.set(null);
this.navbar.cuposInfo.set(null);
    this.navbar.Id_Reserva.set(idReserva);

  }

  async onSubmit(): Promise<void> {
    // Validación
    this.form.updateValueAndValidity({ emitEvent: false });
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.navbar.alert.set({ type: 'warning', title: 'Formulario incompleto', message: 'Revisa los campos obligatorios antes de guardar.', autoClose: true });
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
    if (!ok) return;

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

      if (forma === 'Directo') {
        pagos.push({ Monto: totalNeto, Tipo: 'Pago Directo' });
      } else if (forma === 'Completo') {
        const file: File | null = this.form.get('ComprobantePago')?.value || null;
        if (file) {
          pagos.push({ Monto: totalNeto, Tipo: 'Pago Completo', fileField: 'comprobante_pago' });
          archivos.completo = file;
          comprobanteCompletoFile = file;
        }
      } else if (forma === 'Abono') {
        this.abonos.controls.forEach((g, i) => {
          const monto = Number(g.get('Monto')?.value || 0);
          const f: File | null = g.get('Comprobante')?.value || null;
          if (monto > 0) {
            pagos.push({ Monto: monto, Tipo: 'Abono', fileField: `abono_${i}` });
            archivos.abonos!.push(f);
          }
        });
      }

      // Estado sugerido (opcional)
      const { estado, subestado } = this.resolverEstadoYMotivo(pax, forma, !!comprobanteCompletoFile);

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

      if (res?.success) {
        // Si guardamos una duplicación como nueva, salir del modo duplicado
        if (this.isDuplicateMode) this.isDuplicateMode = false;
        const estadoTexto = subestado ? `${estado} ${subestado}` : estado;
        this.navbar.alert.set({
          type: 'success',
          title: 'Reserva actualizada',
          message: `La reserva ${this.reservaId()} ha sido actualizada correctamente. Estado: ${estadoTexto}.`,
          autoClose: false,
          buttons: [
            { text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) },
            { text: 'Ver Reserva', style: 'primary', onClick: () => { this.navbar.alert.set(null); this.navbar.cuposInfo.set(null); this.navbar.Id_Reserva.set(String(this.reservaId()!)); } },
          ],
        });
        this.cdr.markForCheck();
      } else {
        this.navbar.alert.set({
          type: 'error',
          title: 'No se pudo actualizar',
          message: 'Revisa los datos e intenta nuevamente.',
          autoClose: false,
          buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) }],
        });
      }
    } catch (err) {
      console.error('Error al actualizar reserva:', err);
      this.navbar.alert.set({
        type: 'error',
        title: 'Error al actualizar',
        message: 'Ocurrió un problema al enviar los cambios al servidor.',
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) }],
      });
    }
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

  // ===================== Comprobante preview / actions =====================
  previewVisible = signal(false);
  previewUrl = signal<SafeResourceUrl | null>(null);

  viewComprobante(url: string | null) {
    if (!url) return;
    // ensure absolute path
    let href: string;
    if (url.startsWith('http')) href = url;
    else {
      const apiBase = (environment.apiUrl || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
      // make sure url begins with a slash
      const pathPart = url.startsWith('/') ? url : `/${url}`;
      href = `${apiBase}${pathPart}`;
    }
    // Open preview inside Dynamic Navbar
    this.navbar.openPreview(href, 'Vista previa del comprobante');
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
    // Clear the comprobante on the form; caller should save to persist change
    this.form.get('ComprobantePago')?.setValue(null);
    this.form.get('ComprobantePago')?.markAsDirty();
    this.navbar.alert.set({ type: 'info', title: 'Comprobante eliminado', message: 'El comprobante fue removido del formulario. Guarda para persistir.', autoClose: true });
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
