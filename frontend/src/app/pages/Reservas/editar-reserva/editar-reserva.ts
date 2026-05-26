import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject, signal, computed, effect, Injector, runInInjectionContext } from '@angular/core';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from '../../../../environments/environment';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormArray, AbstractControl } from '@angular/forms';
import { firstValueFrom, of, from } from 'rxjs';
import { WebSocketService } from '../../../services/WebSocket/web-socket';
import {
  Reservas, Tour, Canal, Moneda, Plan, Horario, PrecioMap, Punto, ReservaHistorialCambio,
} from '../../../services/Reservas/reservas';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { DuplicarPanelComponent } from '../../../DynamicNavbar/duplicar-panel/duplicar-panel';
import { TourRulesService } from '../../../services/Reservas/tour-rules.service';
import { UppercaseInputDirective } from '../../../shared/directives/uppercase-input.directive';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { debounceTime, distinctUntilChanged, switchMap, catchError } from 'rxjs/operators';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { buscarPaisesOrigen, normalizarBusquedaPais } from '../../../shared/data/paises-origen';

@Component({
  selector: 'app-editar-reserva',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DecimalPipe, DatePipe, FlatpickrInputDirective, UppercaseInputDirective],
  templateUrl: './editar-reserva.html',
  styleUrls: ['./editar-reserva.css'],
})
export class EditarReservaComponent implements OnInit, OnDestroy {
  Number = Number;
  showDuplicate: boolean = true;
  openSummary = false;
  private readonly e164WithTenDigitsPattern = /^\+[1-9]\d{10,12}$/;
  private readonly permisosService = inject(PermisosService);
  activePaisOrigenIndex: number | null = null;

  toggleSummary(force?: boolean) {
    this.openSummary = typeof force === 'boolean' ? force : !this.openSummary;
  }

  private closeSummaryIfOpen(): void {
    if (this.openSummary) {
      this.openSummary = false;
    }
  }

  private getApiErrorMessage(error: any, fallback = 'No fue posible completar la operación.'): string {
    return (
      error?.error?.message ||
      error?.error?.error ||
      error?.error?.mensaje ||
      error?.message ||
      fallback
    );
  }

  private getFriendlyReservaErrorMessage(error: any): string {
    const raw = String(this.getApiErrorMessage(error));
    const normalized = raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    if (normalized.includes('fecha reservada') && normalized.includes('no puede ser pasada')) {
      return 'No puedes guardar esta reserva porque la fecha del tour ya pasó. Selecciona una fecha vigente o revisa la reserva solo como consulta.';
    }

    if (normalized.includes('fecha') && normalized.includes('pasada')) {
      return 'No puedes guardar cambios sobre una reserva con fecha pasada. Revisa la fecha del tour antes de continuar.';
    }

    if (normalized.includes('cupos') && (
      normalized.includes('insuficiente') ||
      normalized.includes('disponible') ||
      normalized.includes('supera') ||
      normalized.includes('sobrepasa')
    )) {
      return 'No hay cupos suficientes para guardar esta reserva. Ajusta la cantidad de pasajeros o selecciona otra fecha.';
    }

    if (normalized.includes('dni') && (
      normalized.includes('duplicado') ||
      normalized.includes('registrado') ||
      normalized.includes('existe')
    )) {
      return 'Uno de los pasajeros ya aparece registrado para esta fecha. Revisa el documento antes de continuar.';
    }

    if (normalized.includes('telefono') || normalized.includes('teléfono')) {
      return 'Revisa el teléfono ingresado. Debe tener el formato correcto, por ejemplo +573001234567.';
    }

    if (normalized.includes('correo') || normalized.includes('email')) {
      return 'Revisa el correo ingresado. Debe tener un formato válido.';
    }

    if (normalized.includes('punto') && normalized.includes('horario')) {
      return 'No se pudo asignar un horario para el punto de encuentro seleccionado. Elige otro punto o revisa la configuración del tour.';
    }

    if (normalized.includes('horario')) {
      return 'No se encontró un horario válido para esta reserva. Revisa el tour, la fecha y el punto de encuentro.';
    }

    if (
      normalized.includes('pago') ||
      normalized.includes('abono') ||
      normalized.includes('comprobante')
    ) {
      return 'Hay un problema con la información de pago. Revisa los abonos, comprobantes o la forma de pago antes de guardar.';
    }

    if (
      normalized.includes('inviabilidad logistica') ||
      normalized.includes('validacion logistica') ||
      normalized.includes('rutas distintas') ||
      normalized.includes('distancia maxima')
    ) {
      return 'La reserva tiene una inviabilidad logística. Revisa los puntos de encuentro seleccionados antes de guardar.';
    }

    if (
      normalized.includes('reserva no existe') ||
      normalized.includes('no encontrada') ||
      normalized.includes('no pudo encontrarse')
    ) {
      return 'La reserva ya no existe o no pudo encontrarse. Actualiza la página e intenta nuevamente.';
    }

    return raw;
  }

  private normalizarDni(dni: unknown): string {
    return String(dni ?? '').trim().replace(/\s+/g, '').toUpperCase();
  }

  private toUpperText(value: unknown): string {
    return String(value ?? '').trim().toLocaleUpperCase('es-CO');
  }

  private normalizarNacionalidad(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized.slice(0, 80) : null;
  }

  getPaisOrigenSuggestions(index: number): string[] {
    const raw = this.pasajeros.at(index)?.get('Nacionalidad')?.value ?? '';
    const current = normalizarBusquedaPais(raw);
    return buscarPaisesOrigen(raw).filter((item) => normalizarBusquedaPais(item) !== current);
  }

  showPaisOrigenSuggestions(index: number): boolean {
    return this.activePaisOrigenIndex === index && this.getPaisOrigenSuggestions(index).length > 0;
  }

  onPaisOrigenFocus(index: number): void {
    this.activePaisOrigenIndex = index;
  }

  onPaisOrigenBlur(): void {
    setTimeout(() => {
      this.activePaisOrigenIndex = null;
      this.cdr.markForCheck();
    }, 120);
  }

  selectPaisOrigen(index: number, value: string): void {
    this.pasajeros.at(index)?.get('Nacionalidad')?.setValue(value);
    this.activePaisOrigenIndex = null;
    this.cdr.markForCheck();
  }

  private limpiarErrorDni(pasajeroCtrl: AbstractControl, key: string): void {
    const dniCtrl = pasajeroCtrl.get('DNI');
    if (!dniCtrl?.errors?.[key]) return;

    const errors = { ...(dniCtrl.errors ?? {}) };
    delete errors[key];
    dniCtrl.setErrors(Object.keys(errors).length ? errors : null);
  }

  private validarDnisDuplicadosEnFormulario(): boolean {
    const vistos = new Map<string, number[]>();

    this.pasajeros.controls.forEach((ctrl, index) => {
      const dni = this.normalizarDni(ctrl.get('DNI')?.value);
      if (!dni) return;

      const arr = vistos.get(dni) ?? [];
      arr.push(index);
      vistos.set(dni, arr);
    });

    let hayDuplicados = false;

    this.pasajeros.controls.forEach((ctrl) => {
      const dniCtrl = ctrl.get('DNI');
      if (!dniCtrl) return;

      const errors = { ...(dniCtrl.errors ?? {}) };
      delete errors['duplicadoEnFormulario'];
      dniCtrl.setErrors(Object.keys(errors).length ? errors : null);
    });

    vistos.forEach((indexes) => {
      if (indexes.length <= 1) return;

      hayDuplicados = true;

      indexes.forEach((index) => {
        const dniCtrl = this.pasajeros.at(index).get('DNI');
        if (!dniCtrl) return;
        const errors = { ...(dniCtrl.errors ?? {}) };
        errors['duplicadoEnFormulario'] = true;
        dniCtrl.setErrors(errors);
        dniCtrl.markAsTouched();
      });
    });

    if (hayDuplicados) {
      this.navbar.showAlert({
        type: 'warning',
        title: 'DNI repetido en esta reserva',
        message: 'Hay pasajeros con el mismo documento dentro de la reserva actual. Corrige los DNI antes de guardar.',
        autoClose: false,
        buttons: [
          { text: 'Entendido', style: 'secondary', onClick: () => this.navbar.clearOverlay() }
        ]
      });
    }

    this.cdr.markForCheck();
    return !hayDuplicados;
  }

  private async validarDniPasajeroContraReservas(
    pasajeroCtrl: AbstractControl,
    options?: { silent?: boolean }
  ): Promise<boolean> {
    const dniCtrl = pasajeroCtrl.get('DNI');
    const dni = this.normalizarDni(dniCtrl?.value);
    const fecha = this.form.get('Fecha_Tour')?.value;

    if (!dni || dni.length < 5 || !fecha) {
      this.limpiarErrorDni(pasajeroCtrl, 'duplicadoEnBd');
      return true;
    }

    try {
      const res = await firstValueFrom(
        this.reservasSvc.verificarDniDuplicado(dni, fecha, this.reservaId() || undefined)
      );

      if (res?.exists) {
        const errors = { ...(dniCtrl?.errors ?? {}) };
        errors['duplicadoEnBd'] = { reserva: res.reserva };
        dniCtrl?.setErrors(errors);
        dniCtrl?.markAsTouched();

        if (!options?.silent) {
        const reserva = res.reserva;
          this.mostrarAlertaDniReservado(dni, reserva, { blocking: false });
        }

        this.cdr.markForCheck();
        return false;
      }

      this.limpiarErrorDni(pasajeroCtrl, 'duplicadoEnBd');
      this.cdr.markForCheck();
      return true;
    } catch (error) {
      if (!options?.silent) {
        this.showApiError(error, 'No se pudo validar el DNI');
      }
      return false;
    }
  }

  private async validarTodosLosDniAntesDeGuardar(): Promise<boolean> {
    const internosOk = this.validarDnisDuplicadosEnFormulario();
    if (!internosOk) return false;

    const dnisUnicos = new Map<string, AbstractControl>();

    for (const ctrl of this.pasajeros.controls) {
      const dni = this.normalizarDni(ctrl.get('DNI')?.value);
      if (!dni || dni.length < 5) continue;

      if (!dnisUnicos.has(dni)) {
        dnisUnicos.set(dni, ctrl);
      }
    }

    for (const ctrl of dnisUnicos.values()) {
      const ok = await this.validarDniPasajeroContraReservas(ctrl, { silent: true });
      if (!ok) {
        const dni = this.normalizarDni(ctrl.get('DNI')?.value);
        const reserva = ctrl.get('DNI')?.errors?.['duplicadoEnBd']?.reserva;

        this.mostrarAlertaDniReservado(dni, reserva, { blocking: true });

        this.cdr.markForCheck();
        return false;
      }
    }

    return true;
  }

  private conectarValidacionDniPasajero(fg: FormGroup): void {
    fg.get('DNI')?.valueChanges.pipe(
      debounceTime(700),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
      switchMap(() => {
        this.validarDnisDuplicadosEnFormulario();

        const fecha = this.form.get('Fecha_Tour')?.value;
        const dni = this.normalizarDni(fg.get('DNI')?.value);

        if (!fecha || !dni || dni.length < 5) {
          this.limpiarErrorDni(fg, 'duplicadoEnBd');
          return of(true);
        }

        return from(this.validarDniPasajeroContraReservas(fg, { silent: false }));
      })
    ).subscribe();
  }

  private async revalidarDnisPorCambioDeFecha(): Promise<void> {
    if (!this.form.get('Fecha_Tour')?.value) return;
    if (!this.pasajeros?.length) return;

    this.validarDnisDuplicadosEnFormulario();

    for (const ctrl of this.pasajeros.controls) {
      const dni = this.normalizarDni(ctrl.get('DNI')?.value);
      if (!dni || dni.length < 5) continue;

      await this.validarDniPasajeroContraReservas(ctrl, { silent: true });
    }

    const dupCtrl = this.pasajeros.controls.find(c => c.get('DNI')?.errors?.['duplicadoEnBd']);

    if (dupCtrl) {
      this.navbar.showAlert({
        type: 'warning',
        title: 'DNI con reserva existente',
        message: 'Al cambiar la fecha, uno o más pasajeros ya aparecen reservados para esa misma fecha. Revisa los campos marcados antes de guardar.',
        autoClose: false,
        buttons: [
          { text: 'Entendido', style: 'secondary', onClick: () => this.navbar.clearOverlay() }
        ]
      });
    }

    this.cdr.markForCheck();
  }

  private showApiError(error: any, title = 'No se pudo completar la operación'): void {
    const message = this.getFriendlyReservaErrorMessage(error);
    this.closeSummaryIfOpen();

    this.navbar.showAlert({
      type: 'error',
      title,
      message,
      autoClose: false,
      buttons: [
        {
          text: 'Cerrar',
          style: 'secondary',
          onClick: () => this.navbar.clearOverlay()
        }
      ]
    });
  }

  private mostrarAlertaDniReservado(dni: string, reserva?: any, options?: { blocking?: boolean }): void {
    const idReserva = reserva?.Id_Reserva || reserva?.idReserva || reserva?.id_reserva;
    const buttons: any[] = [];
    this.closeSummaryIfOpen();

    if (idReserva) {
      buttons.push({
        text: 'Ver reserva',
        style: 'primary',
        onClick: () => {
          this.navbar.alert.set(null);
          try { this.navbar.closePanel(); } catch {}
          this.navbar.Id_Reserva.set(String(idReserva));
        }
      });
    }

    buttons.push({
      text: options?.blocking ? 'Corregir DNI' : 'Entendido',
      style: 'secondary',
      onClick: () => this.navbar.alert.set(null)
    });

    this.navbar.alert.set({
      type: options?.blocking ? 'error' : 'warning',
      title: 'Pasajero ya reservado',
      message: idReserva
        ? `El documento ${dni} ya tiene una reserva para esta misma fecha: ${idReserva}. Puedes revisar la reserva existente o corregir el DNI.`
        : `El documento ${dni} ya tiene una reserva para esta misma fecha. Corrige el DNI o revisa la reserva existente.`,
      autoClose: false,
      buttons
    });
  }

  private tipoOcupaAsiento(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): boolean {
    return tipo !== 'INFANTE';
  }

  private esEdicionExistente(): boolean {
    return !!this.reservaId() && !this.isDuplicateMode;
  }

  private pasajerosConAsientoActual(): number {
    return this.pasajerosConAsiento();
  }

  private incrementoPasajerosConAsiento(): number {
    return Math.max(0, this.pasajerosConAsientoActual() - this.pasajerosConAsientoOriginal);
  }

  private puedeGuardarSinBloquearPorCupos(): boolean {
    return this.esEdicionExistente() && this.incrementoPasajerosConAsiento() === 0;
  }

  private mostrarAlertaIncrementoSinCupos(cupos: number): void {
    this.navbar.showAlert({
      type: 'warning',
      title: 'Cupos insuficientes',
      message: 'No hay cupos suficientes para agregar más pasajeros. Puedes guardar otros cambios sin aumentar la cantidad de pasajeros.',
      autoClose: false,
      buttons: [
        { text: 'Entendido', style: 'secondary', onClick: () => this.navbar.clearOverlay() }
      ]
    });
    this.cuposDisponiblesActuales.set(cupos);
    this.cuposValidosActuales.set(false);
  }

  private async refrescarCuposPorEvento(): Promise<void> {
    const ok = await this.verificarCuposDisponibles({ silent: true });
    // verificarCuposDisponibles ya actualiza navbar.cuposInfo directamente.

    if (!ok && !this.puedeGuardarSinBloquearPorCupos()) {
      this.navbar.showAlert({
        type: 'warning',
        title: 'Cupos actualizados',
        message: 'La disponibilidad cambió y ahora esta reserva supera los cupos disponibles. Ajusta los pasajeros antes de guardar.',
        autoClose: false,
        buttons: [
          { text: 'Entendido', style: 'secondary', onClick: () => this.navbar.clearOverlay() }
        ]
      });
    }
  }

  

  private wsService = inject(WebSocketService);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);
  private reservasSvc = inject(Reservas);
  private navbar = inject(DynamicIslandGlobalService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);
  public tourRules = inject(TourRulesService);

  // Estado
  isLoading = signal<boolean>(true);
  isSubmitting = signal<boolean>(false);
  cuposDisponiblesActuales = signal<number | null>(null);
  cuposValidosActuales = signal<boolean>(true);
  adultosCantidadInput = signal<number>(0);
  ninosCantidadInput = signal<number>(0);
  infantesCantidadInput = signal<number>(0);
  isSyncingPassengerCounts = signal<boolean>(false);
  reservaId = signal<string | null>(null);
  form!: FormGroup;
  private pasajerosConAsientoOriginal = 0;

  comprobantesAEliminar: number[] = [];
  comprobantesAReemplazar: number[] = [];
  private ultimoTotalConocido: number = 0;

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

  private getDefaultCanalId(): number {
    const canales = this.canales();

    const hotel = canales.find((c: any) =>
      String(c.Nombre_Canal || c.Nombre || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .includes('HOTEL')
    );

    return Number(hotel?.Id_Canal || 1);
  }

  private ensureDefaultCanal(): number {
    const ctrl = this.form.get('Id_Canal');
    const current = Number(ctrl?.value || 0);

    if (current) return current;

    const defaultCanalId = this.getDefaultCanalId();
    ctrl?.setValue(defaultCanalId, { emitEvent: false });
    return defaultCanalId;
  }

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
  private sincronizarPuntosPasajeros(): void {
    const puntos = this.puntosSeleccionados();
    const puntoPrincipal = puntos[0]?.Id_Punto ? Number(puntos[0].Id_Punto) : null;
    const idsValidos = new Set(
      puntos
        .map((p) => Number(p.Id_Punto))
        .filter((id) => Number.isFinite(id) && id > 0)
    );

    for (const ctrl of this.pasajeros.controls) {
      const idActual = Number(ctrl.get('Id_Punto')?.value || 0);

      if (!puntoPrincipal) {
        ctrl.get('Id_Punto')?.setValue(null, { emitEvent: false });
        continue;
      }

      if (puntos.length === 1) {
        ctrl.get('Id_Punto')?.setValue(puntoPrincipal, { emitEvent: false });
        continue;
      }

      if (!idActual || !idsValidos.has(idActual)) {
        ctrl.get('Id_Punto')?.setValue(puntoPrincipal, { emitEvent: false });
      }
    }
  }
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
      this.navbar.showAlert({
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

      PrecioAdulto: [0, [Validators.min(0)]],
      PrecioNino: [0, [Validators.min(0)]],
      PrecioInfante: [0, [Validators.min(0)]],
      ComisionAdulto: [0],
      ComisionNino: [0],
      ComisionInfante: [0],

      // Punto principal
      Id_Punto: [null, Validators.required],

      // Comprobante (pago completo)
      ComprobantePago: [null],
      PagoObservaciones: [''],
    });
    this.wsService.reservationEvents$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((msg: any) => {
        const fecha = this.form.get('Fecha_Tour')?.value;
        const tour = this.form.get('SelectTour')?.value;
        if ((msg?.type === 'reservaCreada' || msg?.type === 'reservaActualizada') && msg?.Fecha_Tour === fecha && msg?.Id_Tour == tour) {
          void this.refrescarCuposPorEvento();
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
      this.navbar.showAlert({
        type: 'error',
        title: 'Error cargando datos',
        message: 'No fue posible cargar Tours, Canales o Monedas.',
        autoClose: false,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.clearOverlay() }],
      });
    }

    // 2) leer parámetro de ruta (usa :Id_Reserva en tus rutas)
    const idParam = this.route.snapshot.paramMap.get('Id_Reserva') ?? this.route.snapshot.paramMap.get('id');
    const id = idParam;

    if (!id) {
      this.isLoading.set(false);
      this.navbar.showAlert({
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

    // Escuchar cambios en FormaPago para conversión manual
    this.form.get('FormaPago')?.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef),
      distinctUntilChanged()
    ).subscribe(nuevaForma => {
      if (nuevaForma === 'Abono') {
        this.verificarConversionCompletoAAbono(this.ultimoTotalConocido, true);
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
      const idCanalReserva = data?.Cabecera?.Id_Canal ?? data?.Id_Canal ?? null;
      // Cabecera
      this.form.patchValue({
        SelectTour: data?.Cabecera?.Id_Tour ?? data?.Id_Tour ?? '',
        Id_Plan: data?.Cabecera?.Id_Plan ?? data?.Id_Plan ?? '',
        Fecha_Tour: data?.Cabecera?.Fecha_Tour ?? data?.FechaReserva ?? '',
        Id_Horario: data?.Cabecera?.Id_Horario ?? data?.Id_Horario ?? '',
        Idioma_Reserva: data?.Cabecera?.Idioma_Reserva ?? data?.IdiomaReserva ?? 'ESPAÑOL',
        Id_Moneda: data?.Cabecera?.Id_Moneda ?? data?.Id_Moneda ?? 1,
        Id_Canal: idCanalReserva,
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
      if (!Number(idCanalReserva || 0)) this.ensureDefaultCanal();

      const listaPax = data?.Pasajeros ?? data?.Detalle?.Pasajeros ?? [];
      const puntoPrincipalCabecera = this.parsePuntoId(data?.Cabecera?.Id_Punto ?? data?.Id_Punto ?? null);



      // Planes y preciosRef para poder calcular totales/sidebar
      const idTour = Number(this.form.get('SelectTour')?.value);
      if (idTour) {
        const planes = await firstValueFrom(this.reservasSvc.getPlanesByTour(idTour));
        this.planes.set(planes || []);
        await this.onPlanMonedaChange(true); // solo cargar preciosRef
      }

      // Puntos seleccionados: usar hasta 3 únicos desde pasajeros + principal de cabecera
      const idsPuntosReserva = this.extraerIdsPuntosReserva(puntoPrincipalCabecera, listaPax);
      await this.hidratarPuntosSeleccionados(idsPuntosReserva);

      const principalCargado = this.puntosSeleccionados()[0] ?? null;
      this.form.get('Id_Punto')?.setValue(principalCargado?.Id_Punto ?? null, { emitEvent: false });
      this.sincronizarPuntosPasajeros();
      this.evaluarConflictoRutasEnTiempoReal();

      // Horario auto
      await this.fijarHorarioAutomatico();

      // Pasajeros: reconstruir EXACTO desde DB y marcar precios como dirty
      this.pasajeros.clear();
      const puntoPrincipalForm = this.parsePuntoId(this.form.get('Id_Punto')?.value);
      const idsPuntosActivos = new Set(this.puntosSeleccionados().map((p) => Number(p.Id_Punto)));
      for (const p of listaPax) {
        const puntoPasajero = this.parsePuntoId(p.Id_Punto);
        const puntoPasajeroValido = puntoPasajero && idsPuntosActivos.has(puntoPasajero)
          ? puntoPasajero
          : null;
        const fg = this.fb.group({
          Tipo_Pasajero: [p.Tipo_Pasajero ?? p.TipoPasajero ?? 'ADULTO', Validators.required],
          Nombre_Pasajero: [p.Nombre_Pasajero ?? p.NombrePasajero ?? ''],
          DNI: [p.DNI ?? p.IdPas ?? ''],
          Nacionalidad: [p.Nacionalidad ?? p.nacionalidad ?? '', [Validators.maxLength(80)]],
          Telefono_Pasajero: [p.Telefono_Pasajero ?? p.TelefonoPasajero ?? '', [Validators.pattern(/^(\+[1-9]\d{10,12})?$/)]],
          Id_Punto: [puntoPasajeroValido ?? puntoPrincipalForm ?? null],
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
      this.sincronizarPuntosPasajeros();

      this.syncCantidadInputsFromFormArray();
      this.pasajerosConAsientoOriginal = this.pasajerosConAsiento();

      // Hidratar controles globales con el primer pasajero existente de cada tipo
      const primerosPorTipo = new Map<string, any>();
      for (const ctrl of this.pasajeros.controls) {
        const tipo = ctrl.get('Tipo_Pasajero')?.value as 'ADULTO' | 'NINO' | 'INFANTE';
        if (!primerosPorTipo.has(tipo)) primerosPorTipo.set(tipo, ctrl);
      }

      const adulto = primerosPorTipo.get('ADULTO');
      const nino = primerosPorTipo.get('NINO');
      const infante = primerosPorTipo.get('INFANTE');

      if (adulto) {
        this.form.get('PrecioAdulto')?.setValue(adulto.get('Precio_Pasajero')?.value ?? 0, { emitEvent: false });
        this.form.get('ComisionAdulto')?.setValue(adulto.get('Comision')?.value ?? 0, { emitEvent: false });
      }
      if (nino) {
        this.form.get('PrecioNino')?.setValue(nino.get('Precio_Pasajero')?.value ?? 0, { emitEvent: false });
        this.form.get('ComisionNino')?.setValue(nino.get('Comision')?.value ?? 0, { emitEvent: false });
      }
      if (infante) {
        this.form.get('PrecioInfante')?.setValue(infante.get('Precio_Pasajero')?.value ?? 0, { emitEvent: false });
        this.form.get('ComisionInfante')?.setValue(infante.get('Comision')?.value ?? 0, { emitEvent: false });
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
          this.form.get('PagoObservaciones')?.setValue(pagoCompleto.Observaciones || '');
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
            Id_Pago: [abono.Id_Pago || null],
            Monto: [abono.Monto || 0],
            Comprobante: [null], // No se puede rehidratar el archivo
            SoporteUrl: [abono.Ruta_Comprobante || abono.SoporteUrl || null],
            Fecha_Pago: [abono.Fecha || abono.Fecha_Pago || ''],
            Observaciones: [abono.Observaciones || '']
          });
          this.abonos.push(fg);
        }
      }



      // Activar verificación de cupos y comisiones después de llenar el formulario
      await this.refrescarCuposPorEvento();
      await this.recalcularComisionesPorCanal();

      this.ultimoTotalConocido = this.totalNeto() + Number(this.form.get('ComisionInternacional')?.value || 0);

      this.cdr.markForCheck();
    } catch (error) {
      this.showApiError(error, 'Error al cargar reserva');
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

  private parsePuntoId(raw: any): number | null {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private extraerIdsPuntosReserva(puntoPrincipal: number | null, pasajeros: Array<any>): number[] {
    const vistos = new Set<number>();
    const ids: number[] = [];

    const pushUnique = (idRaw: any) => {
      const id = this.parsePuntoId(idRaw);
      if (id !== null && !vistos.has(id)) {
        vistos.add(id);
        ids.push(id);
      }
    };

    // Mantiene el principal primero para conservar la semántica actual del formulario.
    pushUnique(puntoPrincipal);
    for (const p of pasajeros || []) pushUnique(p?.Id_Punto);

    return ids.slice(0, 3);
  }

  private async hidratarPuntosSeleccionados(ids: number[]): Promise<void> {
    if (!Array.isArray(ids) || ids.length === 0) {
      this.puntosSeleccionados.set([]);
      return;
    }

    const puntos = await Promise.all(
      ids.map(async (id) => {
        try {
          return await firstValueFrom(this.reservasSvc.getPuntoById(id));
        } catch {
          return {
            Id_Punto: id,
            NombrePunto: `Punto ${id} (no disponible)`,
            ruta: null,
          } as Punto;
        }
      })
    );

    this.puntosSeleccionados.set((puntos || []).filter(Boolean).slice(0, 3));
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
      Id_Pago: [null],
      Monto: [0],
      Comprobante: [null], // File
      SoporteUrl: [null],
      Fecha_Pago: [''],
      Observaciones: [''],
    });
  }
  agregarAbono() { this.abonos.push(this.crearAbonoGroup()); }
  eliminarAbono(i: number) {
    const fg = this.abonos.at(i);
    const idPago = fg.get('Id_Pago')?.value;
    if (idPago) this.comprobantesAEliminar.push(idPago);
    this.abonos.removeAt(i);
  }
  eliminarComprobanteAbono(i: number) {
    const fg = this.abonos.at(i);
    const idPago = fg.get('Id_Pago')?.value;
    if (idPago && fg.get('SoporteUrl')?.value) {
      this.comprobantesAEliminar.push(idPago);
    }
    fg.get('Comprobante')?.setValue(null);
    fg.get('SoporteUrl')?.setValue(null);
  }
  totalAbonos(): number {
    return this.abonos.controls.reduce((acc, g: any) =>
      acc + Number(g.get('Monto')?.value || 0), 0);
  }
  get abonosValidos(): boolean {
    const total = this.totalNeto() + Number(this.form.get('ComisionInternacional')?.value || 0);
    return this.totalAbonos() <= total;
  }

  // ===================== Puntos: búsqueda / selección =====================
  puntoBusquedaTerm = signal<string>('');

  async onPuntoSearch(ev: Event) {
    const term = (ev.target as HTMLInputElement)?.value?.trim() || '';
    this.puntoBusquedaTerm.set(term);
    if (term.length < 2) { this.puntoBusquedaResults.set([]); return; }
    try {
      const results = await firstValueFrom(this.reservasSvc.buscarPuntos(term));
      this.puntoBusquedaResults.set(results || []);
    } catch {
      this.puntoBusquedaResults.set([]);
      this.navbar.showAlert({ type: 'error', title: 'Error buscando puntos', message: 'No fue posible obtener los puntos de encuentro.', autoClose: true });
    }
  }

  resaltarCoincidencia(texto: string): string {
    const term = this.puntoBusquedaTerm().trim();
    if (!term) return texto;
    const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${safeTerm})`, 'gi');
    return texto.replace(regex, '<strong class="text-highlight">$1</strong>');
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
    this.sincronizarPuntosPasajeros();
    this.evaluarConflictoRutasEnTiempoReal();
    await this.fijarHorarioAutomatico();
    await this.verificarCuposDisponibles({ silent: true });
  }
  async eliminarPunto(p: Punto) {
    this.puntosSeleccionados.update(arr => arr.filter(x => x.Id_Punto !== p.Id_Punto));
    const principal = this.puntosSeleccionados()[0] || null;
    this.form.get('Id_Punto')?.setValue(principal?.Id_Punto ?? null);
    this.sincronizarPuntosPasajeros();
    if (!principal) {
      this.horarioSeleccionado.set(null);
      this.form.get('Id_Horario')?.setValue(null);
    } else {
      await this.fijarHorarioAutomatico();
    }
    this.evaluarConflictoRutasEnTiempoReal();
    await this.verificarCuposDisponibles({ silent: true });
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
        this.navbar.showAlert({ type: 'warning', title: 'Sin horario', message: 'No se encontró horario para el punto principal con el tour seleccionado.', autoClose: true });
      }
    } catch {
      this.horarioSeleccionado.set(null);
      this.form.get('Id_Horario')?.setValue(null);
      this.navbar.showAlert({ type: 'error', title: 'Error al asignar horario', message: 'No fue posible obtener el horario del punto principal.', autoClose: false });
    }
  }

  // ===================== Cambios Tour/Plan/Moneda =====================
  async onTourChange() {
    const idTour = Number(this.form.get('SelectTour')?.value);
    this.form.patchValue({ Id_Plan: null, Id_Horario: null }, { emitEvent: false });
    this.horarioSeleccionado.set(null);
    this.preciosRef.set({});
    if (!idTour) {
      this.cuposDisponiblesActuales.set(null);
      this.cuposValidosActuales.set(true);
      this.navbar.cuposInfo.set(null);
      return;
    }

    try {
      this.ensureDefaultCanal();

      const planes = await firstValueFrom(this.reservasSvc.getPlanesByTour(idTour));
      this.planes.set(planes || []);
      if (this.planes().length === 1) this.form.get('Id_Plan')?.setValue(this.planes()[0].Id_Plan, { emitEvent: false });

      if (!this.form.get('Id_Moneda')?.value) this.form.get('Id_Moneda')?.setValue(1, { emitEvent: false });

      await this.recalcularComisionesPorCanal();
      await this.fijarHorarioAutomatico();
      await this.onPlanMonedaChange(true);
      // IMPORTANTE: en edición, respeta precios traídos (no llames autollenar si no quieres pisar)
      this.recalcularTotales();

      const teniaInfantes = this.countByTipo('INFANTE') > 0;
      if (teniaInfantes && !this.tourRules.allowsPassengerType(idTour, 'INFANTE')) {
        this.removeInfantes();
        this.navbar.showAlert({ type: 'warning', title: 'Infantes no permitidos', message: 'En este tour no se aceptan infantes. Han sido removidos.', autoClose: true });
      }

      this.tourRules.resetSession();
      await this.verificarCuposDisponibles({ silent: false });
      await this.revalidarDnisPorCambioDeFecha();
      this.cdr.markForCheck();

    } catch (error) {
      this.showApiError(error, 'Error al cambiar tour');
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
        await this.autollenarPrecios();
      }
      this.recalcularTotales();
    } catch (error) {
      this.showApiError(error, 'Error al cargar precios');
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
  private precioControlPorTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): string {
    switch (tipo) {
      case 'ADULTO': return 'PrecioAdulto';
      case 'NINO': return 'PrecioNino';
      case 'INFANTE': return 'PrecioInfante';
    }
  }

  private comisionControlPorTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): string {
    switch (tipo) {
      case 'ADULTO': return 'ComisionAdulto';
      case 'NINO': return 'ComisionNino';
      case 'INFANTE': return 'ComisionInfante';
    }
  }

  private precioGlobalPorTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): number {
    return Number(this.form.get(this.precioControlPorTipo(tipo))?.value || 0);
  }

  private comisionGlobalPorTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): number {
    return Number(this.form.get(this.comisionControlPorTipo(tipo))?.value || 0);
  }

  private getCantidadInputSignal(tipo: 'ADULTO' | 'NINO' | 'INFANTE') {
    switch (tipo) {
      case 'ADULTO': return this.adultosCantidadInput;
      case 'NINO': return this.ninosCantidadInput;
      case 'INFANTE': return this.infantesCantidadInput;
    }
  }

  private syncCantidadInputsFromFormArray(): void {
    this.adultosCantidadInput.set(this.countByTipo('ADULTO'));
    this.ninosCantidadInput.set(this.countByTipo('NINO'));
    this.infantesCantidadInput.set(this.countByTipo('INFANTE'));
  }

  private findLastPassengerIndexByTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): number {
    for (let i = this.pasajeros.length - 1; i >= 0; i--) {
      if (this.pasajeros.at(i)?.get('Tipo_Pasajero')?.value === tipo) return i;
    }
    return -1;
  }

  private removeInfantes(): void {
    for (let i = this.pasajeros.length - 1; i >= 0; i--) {
      if (this.pasajeros.at(i)?.get('Tipo_Pasajero')?.value === 'INFANTE') this.pasajeros.removeAt(i);
    }
    this.recalcularTotales();
    this.syncCantidadInputsFromFormArray();
  }

  actualizarPreciosComisionesPorTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE') {
    const precio = this.precioGlobalPorTipo(tipo);
    const comision = this.comisionGlobalPorTipo(tipo);

    for (const ctrl of this.pasajeros.controls) {
      if (ctrl.get('Tipo_Pasajero')?.value === tipo) {
        ctrl.get('Precio_Pasajero')?.setValue(precio, { emitEvent: false });
        ctrl.get('Comision')?.setValue(comision, { emitEvent: false });
        ctrl.get('Precio_Pasajero')?.markAsDirty();
        ctrl.get('Comision')?.markAsDirty();
      }
    }

    this.recalcularTotales();
    this.cdr.markForCheck();
  }

  private async puedeAgregarPasajero(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): Promise<boolean> {
    if (!this.tipoOcupaAsiento(tipo)) return true;

    const Fecha = this.form.get('Fecha_Tour')?.value;
    const Id_Tour = this.form.get('SelectTour')?.value;

    if (!Fecha || !Id_Tour) {
      this.navbar.showAlert({
        type: 'warning',
        title: 'Datos incompletos',
        message: 'Selecciona tour y fecha antes de agregar pasajeros.',
        autoClose: true
      });
      return false;
    }

    const cantidadSimulada = this.pasajerosConAsiento() + 1;

    try {
      const data = await firstValueFrom(
        this.reservasSvc.verificarCupos(Fecha, Number(Id_Tour), cantidadSimulada, this.reservaId() || undefined)
      );

      const disponible = !!data?.disponible;
      const cupos = Number(data?.cuposDisponibles ?? 0);

      this.cuposDisponiblesActuales.set(cupos);
      this.cuposValidosActuales.set(disponible);
      this.navbar.cuposInfo.set({ ...data });

      if (!disponible) {
        this.navbar.showAlert({
          type: 'warning',
          title: 'Cupos insuficientes',
          message: cupos <= 0
            ? 'Este tour ya no tiene cupos disponibles para la fecha seleccionada.'
            : `Solo quedan ${cupos} cupos disponibles. No puedes superar esa cantidad.`,
          autoClose: false,
          buttons: [
            { text: 'Entendido', style: 'secondary', onClick: () => this.navbar.clearOverlay() }
          ]
        });
        return false;
      }

      this.cdr.markForCheck();
      return true;
    } catch (error) {
      this.cuposValidosActuales.set(false);
      this.showApiError(error, 'Error al verificar cupos');
      return false;
    }
  }

  private async puedeAjustarCantidadPasajeros(tipo: 'ADULTO' | 'NINO' | 'INFANTE', target: number): Promise<boolean> {
    if (!this.tipoOcupaAsiento(tipo)) return true;

    const Fecha = this.form.get('Fecha_Tour')?.value;
    const Id_Tour = this.form.get('SelectTour')?.value;

    if (!Fecha || !Id_Tour) {
      this.navbar.showAlert({
        type: 'warning',
        title: 'Datos incompletos',
        message: 'Selecciona tour y fecha antes de agregar pasajeros.',
        autoClose: true
      });
      return false;
    }

    const otrosConAsiento = this.pasajeros.controls.filter(c => {
      const t = c.get('Tipo_Pasajero')?.value as 'ADULTO' | 'NINO' | 'INFANTE';
      return t !== tipo && this.tipoOcupaAsiento(t);
    }).length;

    const cantidadFinalConAsiento = otrosConAsiento + (this.tipoOcupaAsiento(tipo) ? target : 0);

    if (this.esEdicionExistente() && cantidadFinalConAsiento <= this.pasajerosConAsientoOriginal) {
      this.cuposValidosActuales.set(true);
      return true;
    }

    try {
      const data = await firstValueFrom(
        this.reservasSvc.verificarCupos(
          Fecha,
          Number(Id_Tour),
          cantidadFinalConAsiento,
          this.reservaId() || undefined
        )
      );

      const disponible = !!data?.disponible;
      const cupos = Number(data?.cuposDisponibles ?? 0);

      this.cuposDisponiblesActuales.set(cupos);
      this.cuposValidosActuales.set(disponible);
      this.navbar.cuposInfo.set({ ...data });

      if (!disponible) {
        this.mostrarAlertaIncrementoSinCupos(cupos);
        return false;
      }

      return true;
    } catch (error) {
      this.showApiError(error, 'Error al verificar cupos');
      return false;
    }
  }

  async agregarPasajero(
    tipo: 'ADULTO' | 'NINO' | 'INFANTE',
    omitirCalculos = false,
    options?: { skipCuposCheck?: boolean }
  ): Promise<boolean> {
    const currentTourId = Number(this.form.get('SelectTour')?.value);
    if (!this.tourRules.allowsPassengerType(currentTourId, tipo)) return false;

    if (!options?.skipCuposCheck && this.tipoOcupaAsiento(tipo)) {
      const puede = await this.puedeAgregarPasajero(tipo);
      if (!puede) return false;
    }

    const principalPunto = this.form.get('Id_Punto')?.value ?? null;
    const precioInicial = this.precioGlobalPorTipo(tipo);
    const comisionInicial = this.comisionGlobalPorTipo(tipo);

    const fg = this.fb.group({
      Tipo_Pasajero: [tipo, Validators.required],
      Nombre_Pasajero: [''],
      DNI: [''],
      Nacionalidad: ['', [Validators.maxLength(80)]],
      Telefono_Pasajero: ['', [Validators.pattern(/^(\+[1-9]\d{10,12})?$/)]],
      Id_Punto: [principalPunto],
      Confirmacion: [false],
      PrecioRef: [this.preciosRef()[tipo] ?? 0],
      Precio_Pasajero: [precioInicial, [Validators.min(0)]],
      Comision: [comisionInicial],
    });

    this.conectarValidacionDniPasajero(fg);

    this.pasajeros.push(fg);
    this.sincronizarPuntosPasajeros();
    this.tourRules.evaluateAlertsForPassenger(currentTourId, tipo);

    if (!omitirCalculos) {
      this.recalcularTotales();
    }

    this.syncCantidadInputsFromFormArray();

    return true;
  }

  eliminarPasajero(i: number) {
    const currentTourId = Number(this.form.get('SelectTour')?.value);
    const tipo = this.pasajeros.at(i)?.get('Tipo_Pasajero')?.value;
    this.pasajeros.removeAt(i);
    this.recalcularTotales();
    this.syncCantidadInputsFromFormArray();
    this.validarDnisDuplicadosEnFormulario();
    if (tipo === 'NINO') this.tourRules.evaluateAlertsForPassenger(currentTourId, tipo);
  }

  adultosInputValue(): number { return this.adultosCantidadInput(); }
  ninosInputValue(): number { return this.ninosCantidadInput(); }
  infantesInputValue(): number { return this.infantesCantidadInput(); }

  onCantidadInputChange(tipo: 'ADULTO' | 'NINO' | 'INFANTE', value: any): void {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    this.getCantidadInputSignal(tipo).set(safe);
  }

  async commitCantidadPasajeros(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): Promise<void> {
    const target = this.getCantidadInputSignal(tipo)();
    await this.setCantidadPasajeros(tipo, target);
    this.syncCantidadInputsFromFormArray();
    await this.verificarCuposDisponibles({ silent: true });
    this.cdr.markForCheck();
  }

  async setCantidadPasajeros(tipo: 'ADULTO' | 'NINO' | 'INFANTE', val: any): Promise<void> {
    const currentTourId = Number(this.form.get('SelectTour')?.value);
    if (!this.tourRules.allowsPassengerType(currentTourId, tipo)) return;

    const n = Math.max(0, Math.floor(Number(val || 0)));
    const cur = this.countByTipo(tipo);

    if (n === cur) {
      this.syncCantidadInputsFromFormArray();
      return;
    }

    this.isSyncingPassengerCounts.set(true);
    this.cdr.markForCheck();

    try {
      if (n > cur) {
        const ok = await this.puedeAjustarCantidadPasajeros(tipo, n);
        if (!ok) return;

        for (let i = 0; i < (n - cur); i++) {
          const agregado = await this.agregarPasajero(tipo, true, { skipCuposCheck: true });
          if (!agregado) break;
        }
      } else {
        for (let i = cur - 1; i >= n; i--) {
          const idx = this.findLastPassengerIndexByTipo(tipo);
          if (idx >= 0) this.pasajeros.removeAt(idx);
        }
      }

      this.recalcularTotales();
      this.syncCantidadInputsFromFormArray();
      this.validarDnisDuplicadosEnFormulario();
      if (tipo === 'NINO') this.tourRules.evaluateAlertsForPassenger(currentTourId, tipo);
    } finally {
      this.isSyncingPassengerCounts.set(false);
      this.syncCantidadInputsFromFormArray();
      this.cdr.markForCheck();
    }
  }

  async autollenarPrecios() {
    const idTour = Number(this.form.get('SelectTour')?.value);
    const idCanal = this.ensureDefaultCanal();
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

      this.form.patchValue({
        PrecioAdulto: Number(ref.ADULTO || 0),
        PrecioNino: Number(ref.NINO || 0),
        PrecioInfante: Number(ref.INFANTE || 0),
        ComisionAdulto: Number(comisiones.ADULTO || 0),
        ComisionNino: Number(comisiones.NINO || 0),
        ComisionInfante: 0,
      }, { emitEvent: false });

      for (const ctrl of this.pasajeros.controls) {
        const tipo = ctrl.get('Tipo_Pasajero')?.value as 'ADULTO' | 'NINO' | 'INFANTE';

        ctrl.get('PrecioRef')?.setValue(Number(ref[tipo] || 0), { emitEvent: false });
        ctrl.get('Precio_Pasajero')?.setValue(this.precioGlobalPorTipo(tipo), { emitEvent: false });
        ctrl.get('Comision')?.setValue(this.comisionGlobalPorTipo(tipo), { emitEvent: false });
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
    const idCanal = this.ensureDefaultCanal();
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
  recalcularTotales() {
    const nuevoTotal = this.totalNeto() + Number(this.form.get('ComisionInternacional')?.value || 0);

    if (this.ultimoTotalConocido > 0 && nuevoTotal !== this.ultimoTotalConocido) {
      this.verificarConversionCompletoAAbono(this.ultimoTotalConocido, false);
    }

    this.ultimoTotalConocido = nuevoTotal;
  }

  private verificarConversionCompletoAAbono(montoOriginal: number, manual: boolean = false) {
    const comprobantePago = this.form.get('ComprobantePago')?.value;

    if (comprobantePago) {
      if (!manual && this.form.get('FormaPago')?.value !== 'Abono') {
        this.form.get('FormaPago')?.setValue('Abono', { emitEvent: false });
      }

      const fg = this.crearAbonoGroup();
      fg.get('Monto')?.setValue(montoOriginal);

      if (comprobantePago instanceof File) {
        fg.get('Comprobante')?.setValue(comprobantePago);
      } else {
        fg.get('Id_Pago')?.setValue(comprobantePago.Id_Pago);
        fg.get('SoporteUrl')?.setValue(comprobantePago.SoporteUrl);
      }

      this.abonos.push(fg);

      this.form.get('ComprobantePago')?.setValue(null, { emitEvent: false });

      if (!manual) {
        this.navbar.showAlert({
          type: 'info',
          title: 'Cambio a Abonos',
          message: 'El total ha cambiado. El pago completo se convirtió en abono. Puedes agregar más abonos o ajustar.',
          autoClose: true
        });
      } else {
        this.navbar.showAlert({
          type: 'success',
          title: 'Conversión exitosa',
          message: 'El comprobante anterior ha sido movido a tu primer abono.',
          autoClose: true
        });
      }
      this.cdr.markForCheck();
    }
  }

  // ===================== Cupos =====================
  async verificarCuposDisponibles(options?: { silent?: boolean }): Promise<boolean> {
    const Fecha = this.form.get('Fecha_Tour')?.value;
    const Id_Tour = this.form.get('SelectTour')?.value;
    const cant = this.pasajerosConAsiento();
    const Id_Reserva = this.reservaId();
    if (!Fecha || !Id_Tour) {
      this.cuposValidosActuales.set(true);
      this.cuposDisponiblesActuales.set(null);
      this.navbar.cuposInfo.set(null);
      return true;
    }

    try {
      const data = await firstValueFrom(this.reservasSvc.verificarCupos(Fecha, Number(Id_Tour), cant, Id_Reserva));
      const disponible = !!data?.disponible;
      const cupos = Number(data?.cuposDisponibles ?? 0);
      const puedeGuardarSinAumentar = this.puedeGuardarSinBloquearPorCupos();
      const cuposValidos = disponible || puedeGuardarSinAumentar;

      this.cuposDisponiblesActuales.set(cupos);
      this.cuposValidosActuales.set(cuposValidos);
      this.navbar.cuposInfo.set({ ...data });

      if (!disponible && !puedeGuardarSinAumentar && !options?.silent) {
        this.mostrarAlertaIncrementoSinCupos(cupos);
      }
      this.cdr.markForCheck();
      return cuposValidos;
    } catch (error) {
      this.cuposValidosActuales.set(false);
      this.navbar.cuposInfo.set(null);
      this.showApiError(error, 'Error al verificar cupos');
      return false;
    }
  }

  CuposDisponiblesNavbar(): void {
    const { Fecha_Tour, SelectTour, Tipo_Reserva } = this.form.value;
    const totalPasajeros = this.pasajerosConAsiento();
    const Id_Reserva = this.reservaId();
    if (Tipo_Reserva !== 'Grupal') {
      this.navbar.cuposInfo.set(null);
      this.cuposDisponiblesActuales.set(null);
      this.cuposValidosActuales.set(true);
      return;
    }
    if (Fecha_Tour && SelectTour) {
      this.reservasSvc.verificarCupos(Fecha_Tour, SelectTour, totalPasajeros, Id_Reserva).subscribe({
        next: (data) => {
          const cupos = Number(data?.cuposDisponibles ?? 0);
          const disponible = !!data?.disponible || this.puedeGuardarSinBloquearPorCupos();
          this.cuposDisponiblesActuales.set(cupos);
          this.cuposValidosActuales.set(disponible);
          this.navbar.cuposInfo.set({ ...data });
        },
        error: () => {
          this.navbar.cuposInfo.set(null);
          this.cuposDisponiblesActuales.set(null);
          this.cuposValidosActuales.set(false);
        }
      });
    } else {
      this.navbar.cuposInfo.set(null);
      this.cuposDisponiblesActuales.set(null);
      this.cuposValidosActuales.set(true);
    }
  }

  // ===================== Guardado (ACTUALIZAR) =====================
  private confirmar(titulo: string, mensaje: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.closeSummaryIfOpen();
      this.navbar.showConfirm(
        titulo,
        mensaje,
        [
          { text: 'Cancelar', style: 'secondary', onClick: () => { this.navbar.clearOverlay(); resolve(false); } },
          { text: 'Confirmar', style: 'primary', onClick: () => { this.navbar.clearOverlay(); resolve(true); } },
        ]
      );
    });
  }

  get puedeCancelarReserva(): boolean {
    const estado = String(this.originalReserva?.Cabecera?.Estado ?? this.originalReserva?.Estado ?? '').trim().toLowerCase();
    return !!this.reservaId() && !['cancelada', 'cancelado', 'completada', 'completado'].includes(estado);
  }

  get canDeleteReserva(): boolean {
    return this.permisosService.tienePermiso('RESERVAS.ELIMINAR');
  }

  get canUpdateReserva(): boolean {
    return this.permisosService.tienePermiso('RESERVAS.ACTUALIZAR');
  }

  async cancelarReserva(): Promise<void> {
    const id = this.reservaId();
    if (!id || !this.puedeCancelarReserva) return;

    this.closeSummaryIfOpen();

    const ok = await this.confirmar(
      'Cancelar reserva',
      `¿Deseas cancelar la reserva #${id}? La información no se eliminará y quedará sólo para consulta futura.`
    );
    if (!ok) return;

    this.isSubmitting.set(true);
    try {
      await firstValueFrom(this.reservasSvc.cancelarReserva(id));
      this.navbar.successToast('Reserva cancelada', `La reserva #${id} quedó en estado Cancelada.`);
      this.form.markAsPristine();
      this.router.navigate(['/Reservas/VerReservas']);
    } catch (err) {
      this.showApiError(err, 'No se pudo cancelar la reserva');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async eliminarReserva(): Promise<void> {
    const id = this.reservaId();
    if (!id || !this.canDeleteReserva) return;

    this.closeSummaryIfOpen();

    const ok = await this.confirmar(
      'Eliminar reserva',
      `¿Deseas eliminar la reserva #${id}? Esta acción eliminará el registro de forma permanente.`
    );
    if (!ok) return;

    this.isSubmitting.set(true);
    try {
      await firstValueFrom(this.reservasSvc.deleteReserva(id));
      this.navbar.needsRefresh.set('reservas');
      this.navbar.successToast('Reserva eliminada', `La reserva #${id} fue eliminada correctamente.`);
      this.router.navigate(['/Reservas/VerReservas']);
    } catch (err) {
      this.showApiError(err, 'No se pudo eliminar la reserva');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // Mostrar diálogo con opciones (retorna la key del botón pulsado)
  private confirmarOpciones(titulo: string, mensaje: string, opciones: Array<{ key: string; text: string; style?: string }>): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.closeSummaryIfOpen();
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
              this.navbar.showAlert({ type: 'warning', title: 'Fecha inválida', message: 'La fecha debe ser distinta a la original.', autoClose: true });
              return;
            }

            const okRestricciones = await this.confirmarRestriccionesAntesDeDuplicar(targetTourId);
            if (!okRestricciones) return;

            await this.crearReservaDuplicada({
              Id_Tour: targetTourId,
              Fecha_Tour: targetFecha,
              Observaciones: typeof Observaciones === 'string' ? this.toUpperText(Observaciones) : null
            });
          }
        }
      });

      this.CuposDisponiblesNavbar();
      this.cdr.markForCheck();
    } catch (e) {
      console.error('Error preparando duplicación', e);
      this.navbar.showAlert({ type: 'error', title: 'Error', message: 'No fue posible preparar la duplicación.', autoClose: false });
    }
  }

  private async crearReservaDuplicada(overrides: { Id_Tour: number; Fecha_Tour: string; Observaciones?: string | null }): Promise<void> {
    try {
      const targetTourId = overrides.Id_Tour;

      let pax = this.pasajeros.controls.map(c => ({
        Nombre_Pasajero: this.toUpperText(c.get('Nombre_Pasajero')?.value),
        DNI: this.normalizarDni(c.get('DNI')?.value) || null,
        Nacionalidad: this.normalizarNacionalidad(c.get('Nacionalidad')?.value),
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

      const idCanal = this.ensureDefaultCanal();
      let comisionesGlobal = {};
      try {
        comisionesGlobal = await firstValueFrom(this.reservasSvc.getComisiones(targetTourId, idCanal)) || {};
      } catch { }

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
        Idioma_Reserva: this.toUpperText(this.form.get('Idioma_Reserva')?.value),
        Telefono_Reportante: this.form.get('Telefono_Reportante')?.value,
        Nombre_Reportante: this.toUpperText(this.form.get('Nombre_Reportante')?.value),
        Observaciones: this.buildDuplicatedObservaciones(overrides.Observaciones),
        Id_Tour: targetTourId,
        Id_Punto: Id_Punto,
        Estado: 'Pendiente',
      };

      const payload: any = {
        cabeceraReserva: cab,
        pasajeros: pax,
        pagos: [],
        esDuplicado: true,
        Id_Reserva_Origen: this.reservaId(),
      };

      const res = await firstValueFrom(this.reservasSvc.crearReserva(payload, { abonos: [] }));
      const rAny: any = res as any;
      const nuevoId = rAny?.Id_Reserva ?? rAny?.id ?? rAny?.reservaId ?? null;

      if (!nuevoId) {
        this.navbar.showAlert({ type: 'success', title: 'Reserva creada', message: 'Reserva duplicada correctamente.', autoClose: true });
        return;
      }

      let extraMsg = '';
      if (removeInfantesCount > 0) extraMsg += `\nNota: Se removieron ${removeInfantesCount} infantes no permitidos.`;
      if (adaptadosCount > 0) extraMsg += `\nNota: Se reajustaron tarifas de ${adaptadosCount} menores por política del tour.`;

      this.navbar.showAlert({
        type: 'success',
        title: 'Reserva duplicada con éxito',
        message: `ID de nueva reserva: ${nuevoId}${extraMsg}`,
        autoClose: false,
        buttons: [
          { text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.clearOverlay() },
          { text: 'Ver Reserva', style: 'primary', onClick: () => { this.navbar.clearOverlay(); this.abrirReservaEnNavbar(String(nuevoId)); } }
        ]
      });

    } catch (err) {
      console.error(err);
      this.navbar.showAlert({ type: 'error', title: 'Error', message: 'No fue posible crear la reserva duplicada. Verifica tu conexión.', autoClose: false });
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

    this.navbar.clearOverlay();
    this.navbar.cuposInfo.set(null);
    this.navbar.Id_Reserva.set(idReserva);

  }

  private buildDuplicatedObservaciones(observacionExtra?: string | null): string {
    const originalObs = this.toUpperText(this.form.get('Observaciones')?.value);
    const extraObs = this.toUpperText(observacionExtra);
    const duplicateNote = `Duplicado desde Reserva #${this.reservaId() || 'N/A'}.`;
    return [originalObs, extraObs, duplicateNote].filter(Boolean).join('\n');
  }

  async onSubmit(): Promise<void> {
    if (this.isSubmitting()) return;
    this.closeSummaryIfOpen();
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
      this.closeSummaryIfOpen();

      this.navbar.showAlert({
        type: 'error',
        title: 'Campos requeridos incompletos',
        message: msg,
        autoClose: true,
        buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.clearOverlay() }]
      });
      this.isSubmitting.set(false);
      return;
    }

    if (this.tieneConflictoLogistico()) {
      this.closeSummaryIfOpen();
      this.navbar.showAlert({
        type: 'error',
        title: 'Inviabilidad logística',
        message: this.mensajeInviabilidadLogistica() || 'Corrige los puntos de encuentro antes de guardar.',
        autoClose: false,
        buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.clearOverlay() }]
      });
      this.isSubmitting.set(false);
      return;
    }

    const dnisOk = await this.validarTodosLosDniAntesDeGuardar();
    if (!dnisOk) {
      this.closeSummaryIfOpen();
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

    const cuposOk = await this.verificarCuposDisponibles({ silent: false });
    if (!cuposOk) {
      this.isSubmitting.set(false);
      return;
    }

    try {
      this.sincronizarPuntosPasajeros();
      // Pasajeros payload
      const pax = this.pasajeros.controls.map(c => ({
        Nombre_Pasajero: this.toUpperText(c.get('Nombre_Pasajero')?.value),
        DNI: this.normalizarDni(c.get('DNI')?.value) || null,
        Nacionalidad: this.normalizarNacionalidad(c.get('Nacionalidad')?.value),
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
        pagoCompleto.Observaciones = this.form.get('PagoObservaciones')?.value || null;

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
          const soporteUrl = g.get('SoporteUrl')?.value;
          if (monto > 0) {
            const pagoAbono: any = {
              Monto: monto,
              Tipo: 'Abono',
              Fecha: g.get('Fecha_Pago')?.value || null,
              Fecha_Pago: g.get('Fecha_Pago')?.value || null,
              Observaciones: g.get('Observaciones')?.value || null
            };
            if (cmpVal instanceof File) {
              pagoAbono.fileField = `abono_${i}`;
              archivos.abonos!.push(cmpVal);
              tieneComprobanteOUrl = true;
            } else if (cmpVal?.SoporteUrl || soporteUrl) {
              pagoAbono.SoporteUrl = cmpVal?.SoporteUrl || soporteUrl;
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
        Idioma_Reserva: this.toUpperText(this.form.get('Idioma_Reserva')?.value),
        Telefono_Reportante: this.form.get('Telefono_Reportante')?.value,
        Nombre_Reportante: this.toUpperText(this.form.get('Nombre_Reportante')?.value),
        Observaciones: this.toUpperText(this.form.get('Observaciones')?.value),
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
      this.showApiError(err, 'Error al actualizar reserva');
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
      this.navbar.showAlert({ type: 'warning', title: 'Archivo muy grande', message: 'El máximo permitido es 5 MB.', autoClose: true });
      ctrl.setValue(null); input.value = ''; return;
    }
    const ok = /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (!ok) {
      this.navbar.showAlert({ type: 'warning', title: 'Formato no permitido', message: 'Sólo PDF, JPG o PNG.', autoClose: true });
      ctrl.setValue(null); input.value = ''; return;
    }

    const currentVal: any = ctrl.value;
    if (currentVal && !currentVal.name && currentVal.Id_Pago) {
      this.comprobantesAReemplazar.push(currentVal.Id_Pago);
    }

    ctrl.setValue(file);
    ctrl.markAsDirty();
    ctrl.updateValueAndValidity({ emitEvent: false });
    this.navbar.showAlert({ type: 'success', title: 'Archivo cargado', message: `Se ha cargado el comprobante: ${file.name}`, autoClose: true });
  }

  onAbonoFileSelected(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const abonoControl = this.abonos.at(index) as FormGroup;
    if (!input?.files?.length || !abonoControl) return;
    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) {
      this.navbar.showAlert({ type: 'warning', title: 'Archivo muy grande', message: 'El máximo permitido es 5 MB.', autoClose: true });
      abonoControl.get('Comprobante')?.setValue(null); input.value = ''; return;
    }
    const ok = /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (!ok) {
      this.navbar.showAlert({ type: 'warning', title: 'Formato no permitido', message: 'Sólo PDF, JPG o PNG.', autoClose: true });
      abonoControl.get('Comprobante')?.setValue(null); input.value = ''; return;
    }

    const idPago = abonoControl.get('Id_Pago')?.value;
    const url = abonoControl.get('SoporteUrl')?.value;
    if (idPago && url) {
      this.comprobantesAReemplazar.push(idPago);
      abonoControl.get('SoporteUrl')?.setValue(null);
    }

    abonoControl.get('Comprobante')?.setValue(file);
    abonoControl.markAsDirty();
    abonoControl.updateValueAndValidity({ emitEvent: false });
    this.navbar.showAlert({ type: 'success', title: 'Archivo cargado', message: `Se ha cargado el archivo: ${file.name}`, autoClose: true });
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
      this.navbar.showAlert({
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

    this.navbar.showConfirm(
      'Eliminar comprobante',
      'Esta acción eliminará el comprobante actual. ¿Deseas continuar?',
      [
        { text: 'Cancelar', style: 'secondary', onClick: () => this.navbar.clearOverlay() },
        {
          text: 'Eliminar',
          style: 'primary',
          onClick: () => {
            this.navbar.clearOverlay();

            if (Number.isFinite(idPago) && idPago > 0) {
              this.comprobantesAEliminar.push(idPago);
            }

            this.clearComprobanteLocalState();
            this.navbar.showAlert({
              type: 'info',
              title: 'Comprobante eliminado',
              message: 'El comprobante fue removido del formulario. Guarda para persistir los cambios.',
              autoClose: true,
            });
          },
        },
      ],
      { type: 'warning' }
    );
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

  ngOnDestroy(): void {
    if (this.navbar?.cuposInfo) this.navbar.cuposInfo.set(null);
    this.navbar?.clearOverlay?.();
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

