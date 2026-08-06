import {
  Component, OnInit, OnDestroy, ChangeDetectorRef, inject, signal,
  computed, NgZone, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from '../../../../environments/environment';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  ReactiveFormsModule, FormBuilder, FormGroup, Validators,
  FormArray, AbstractControl
} from '@angular/forms';
import { firstValueFrom, of, from } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError } from 'rxjs/operators';
import { WebSocketService } from '../../../services/WebSocket/web-socket';
import { DatepickerComponent } from '../../../shared/datepicker/datepicker';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { isTourDateAvailable, toDateOnly } from '../../../shared/utils/calendar-date';
import {
  Reservas, Tour, Canal, Moneda, Plan, Horario, PrecioMap, Punto,
} from '../../../services/Reservas/reservas';
import { SirDrawerService } from '../../../services/Drawer/drawer.service';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { UiStateService } from '../../../services/ui-state.service';
import { TourRulesService } from '../../../services/Reservas/tour-rules.service';
import { UppercaseInputDirective } from '../../../shared/directives/uppercase-input.directive';
import { buscarPaisesOrigen, normalizarBusquedaPais } from '../../../shared/data/paises-origen';
import { CuposStripComponent } from '../../../components/cupos/cupos-strip';
import type { CuposStripInfo } from '../../../components/cupos/cupos-strip';
import {
  getReservaPassengerInsertIndex,
  normalizeReservaPassengerType,
  reservaPassengerTypeLabel,
  sortReservaPassengerControls,
  type ReservaPassengerType,
} from '../reserva-passengers.utils';

// ── Descriptor de cada step del wizard ──────────────────────────────
interface WizardStep {
  id: string;
  label: string;
}

interface SubmitValidationIssue {
  message: string;
  step: number;
  focusId?: string;
}

@Component({
  selector: 'app-crear-reserva',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, DecimalPipe,
    DatepickerComponent, UppercaseInputDirective, CuposStripComponent, LoadingStateComponent
  ],
  templateUrl: './crear-reserva.html',
  styleUrls: ['../reserva-shared.css'],
})
export class CrearReservaComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly drawer = inject(SirDrawerService);

  // ═══════════════════════════════════════════════════════════════════
  // WIZARD STATE
  // ═══════════════════════════════════════════════════════════════════

  readonly wizardSteps: WizardStep[] = [
    { id: 'viaje',         label: 'Viaje'         },
    { id: 'responsable',   label: 'Responsable'    },
    { id: 'configuracion', label: 'Configuración'  },
    { id: 'pasajeros',     label: 'Pasajeros'      },
    { id: 'pago',          label: 'Pago'           },
    { id: 'resumen',       label: 'Resumen'        },
  ];

  currentStep = 0;
  goingBack = false;
  /** El paso más alto que el usuario ha llegado a completar */
  maxReachedStep = 0;
  /**
   * true SOLO durante el frame de entrada de un nuevo paso.
   * Se apaga después de la animación para que re-renders del mismo
   * paso no vuelvan a disparar la animación CSS.
   */
  panelAnimating = false;

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

  // ─── Modos de configuración (paso 2) ───────────────────────────────
  // Cada dimensión puede ser 'global' (se aplica igual a todos los pax)
  // o 'individual' (aparece como input en cada tarjeta de pasajero).
  modoNacionalidad: 'global' | 'individual' = 'global';
  modoPrecio:       'global' | 'individual' = 'global';
  modoComision:     'global' | 'individual' = 'global';
  modoPlan:         'global' | 'individual' = 'global';

  setModoNacionalidad(m: 'global' | 'individual'): void {
    this.modoNacionalidad = m;
    if (m === 'global') this.aplicarNacionalidadGlobal();
  }

  setModoPrecio(m: 'global' | 'individual'): void {
    this.modoPrecio = m;
    if (m === 'global') this.aplicarPreciosGlobales();
  }

  setModoComision(m: 'global' | 'individual'): void {
    this.modoComision = m;
    if (m === 'global') this.aplicarComisionesGlobales();
  }

  setModoPlan(m: 'global' | 'individual'): void {
    this.modoPlan = m;
    if (m === 'global') this.aplicarPlanGlobal();
  }

  /** Aplica el plan global del form a todos los pasajeros */
  private aplicarPlanGlobal(): void {
    const id = this.form.get('Id_Plan')?.value ?? null;
    for (const ctrl of this.pasajeros.controls) {
      ctrl.get('Id_Plan')?.setValue(id, { emitEvent: false });
    }
    this.cdr.markForCheck();
  }

  private aplicarPreciosGlobales(): void {
    this.actualizarPrecioGlobalPorTipo('ADULTO');
    this.actualizarPrecioGlobalPorTipo('NINO');
    this.actualizarPrecioGlobalPorTipo('INFANTE');
  }

  private aplicarComisionesGlobales(): void {
    this.actualizarComisionGlobalPorTipo('ADULTO');
    this.actualizarComisionGlobalPorTipo('NINO');
    this.actualizarComisionGlobalPorTipo('INFANTE');
  }

  /** Aplica la nacionalidad global a todos los pasajeros */
  private aplicarNacionalidadGlobal(): void {
    const val = String(this.form.get('NacionalidadGlobal')?.value ?? '').trim() || null;
    for (const ctrl of this.pasajeros.controls) {
      ctrl.get('Nacionalidad')?.setValue(val, { emitEvent: false });
    }
    this.cdr.markForCheck();
  }

  // ─── Autocomplete nacionalidad global ──────────────────────────────
  getPaisOrigenSuggestionsGlobal(): string[] {
    const raw = this.form.get('NacionalidadGlobal')?.value ?? '';
    const current = normalizarBusquedaPais(raw);
    return buscarPaisesOrigen(raw).filter(item => normalizarBusquedaPais(item) !== current);
  }

  selectPaisOrigenGlobal(value: string): void {
    this.form.get('NacionalidadGlobal')?.setValue(value);
    this.activePaisOrigenIndex = null;
    // Si está en modo global, aplica inmediatamente a todos
    if (this.modoNacionalidad === 'global') this.aplicarNacionalidadGlobal();
    this.cdr.markForCheck();
  }

  // ─── Navegación ────────────────────────────────────────────────────
  /** ¿Puede el usuario navegar directamente a este step? */
  canNavigateToStep(index: number): boolean {
    return index <= this.maxReachedStep || index <= this.currentStep;
  }

  goToStep(index: number): void {
    if (!this.canNavigateToStep(index)) return;
    if (index === this.currentStep) return;
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
    // Al pasar de configuración (paso 2) a pasajeros (paso 3),
    // sincronizamos todos los valores globales pendientes
    if (this.currentStep === 2) this.aplicarConfiguracionGlobal();

    if (this.currentStep < this.wizardSteps.length - 1) {
      this.currentStep++;
      this.maxReachedStep = Math.max(this.maxReachedStep, this.currentStep);
      this.triggerPanelAnimation(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  prevStep(): void {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.triggerPanelAnimation(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /**
   * Aplica TODOS los valores globales a los pasajeros existentes
   * justo antes de entrar al paso 3. El global siempre manda.
   */
  private aplicarConfiguracionGlobal(): void {
    if (this.modoNacionalidad === 'global') this.aplicarNacionalidadGlobal();
    if (this.modoPlan === 'global') this.aplicarPlanGlobal();
    this.sincronizarPuntosPasajeros();
    if (this.modoPrecio === 'global') this.aplicarPreciosGlobales();
    if (this.modoComision === 'global') this.aplicarComisionesGlobales();
  }

  /** ¿Puede el asesor avanzar desde el step indicado? */
  canAdvanceFromStep(step: number): boolean {
    switch (step) {
      case 0: // Viaje
        return !!(
          this.form?.get('SelectTour')?.valid &&
          this.form?.get('Fecha_Tour')?.valid
        );
      case 1: // Responsable
        return !!(
          this.form?.get('Nombre_Reportante')?.valid &&
          this.form?.get('Telefono_Reportante')?.valid
        );
      case 2: // Configuración — requiere al menos un punto
        return (
          (this.planes().length <= 1 || !!this.form?.get('Id_Plan')?.value) &&
          this.puntosSeleccionados().length > 0 &&
          !this.tieneConflictoLogisticoActual()
        );
      case 3: // Pasajeros — al menos uno
        return this.pasajeros.length > 0;
      case 4: // Pago
        return this.abonosValidos;
      case 5: // Resumen — siempre puede submit
        return true;
      default:
        return true;
    }
  }

  /** Marca como touched los campos del paso actual para mostrar errores */
  private markCurrentStepTouched(): void {
    switch (this.currentStep) {
      case 0:
        this.form.get('SelectTour')?.markAsTouched();
        this.form.get('Fecha_Tour')?.markAsTouched();
        break;
      case 1:
        this.form.get('Nombre_Reportante')?.markAsTouched();
        this.form.get('Telefono_Reportante')?.markAsTouched();
        break;
      case 2:
        this.form.get('Id_Plan')?.markAsTouched();
        this.form.get('Id_Punto')?.markAsTouched();
        this.alertService.showModal({
          type: 'warning',
          title: 'Paso incompleto',
          message: this.planes().length > 1 && !this.form.get('Id_Plan')?.value
            ? 'Selecciona un plan antes de continuar.'
            : this.puntosSeleccionados().length === 0
            ? 'Selecciona al menos un punto de encuentro antes de continuar.'
            : 'Corrige la inviabilidad logística antes de continuar.',
          buttons: [{ text: 'Entendido', style: 'secondary', onClick: () => this.alertService.closeModal() }],
        });
        break;
      case 3:
        this.alertService.showModal({
          type: 'warning',
          title: 'Sin pasajeros',
          message: 'Agrega al menos un pasajero antes de continuar.',
          buttons: [{ text: 'Entendido', style: 'secondary', onClick: () => this.alertService.closeModal() }],
        });
        break;
      case 4:
        this.alertService.showModal({
          type: 'warning',
          title: 'Abonos inválidos',
          message: 'Los abonos no pueden superar el total a pagar.',
          buttons: [{ text: 'Entendido', style: 'secondary', onClick: () => this.alertService.closeModal() }],
        });
        break;
    }
  }

  /** ¿El step tiene algún error visible? */
  stepHasError(step: number): boolean {
    if (step > this.currentStep) return false;
    switch (step) {
      case 0:
        return !!(
          (this.form?.get('SelectTour')?.touched && this.form?.get('SelectTour')?.invalid) ||
          (this.form?.get('Fecha_Tour')?.touched && this.form?.get('Fecha_Tour')?.invalid)
        );
      case 1:
        return !!(
          (this.form?.get('Nombre_Reportante')?.touched && this.form?.get('Nombre_Reportante')?.invalid) ||
          (this.form?.get('Telefono_Reportante')?.touched && this.form?.get('Telefono_Reportante')?.invalid)
        );
      case 2:
        return this.tieneConflictoLogisticoActual();
      case 4:
        return !this.abonosValidos;
      default:
        return false;
    }
  }

  // ── Helpers de display para el resumen ─────────────────────────────

  nombreTourSeleccionado(): string {
    const id = Number(this.form?.get('SelectTour')?.value);
    return this.tours().find(t => t.Id_Tour === id)?.Nombre_Tour ?? '—';
  }

  nombrePlanSeleccionado(): string {
    const id = this.form?.get('Id_Plan')?.value;
    return this.planes().find(p => p.Id_Plan === id)?.Nombre_Plan ?? '—';
  }

  nombreCanalSeleccionado(): string {
    const id = Number(this.form?.get('Id_Canal')?.value);
    return this.canales().find(c => c.Id_Canal === id)?.Nombre_Canal ?? '—';
  }

  nombrePuntoPorId(id: any): string {
    const punto = this.puntosSeleccionados().find(p => Number(p.Id_Punto) === Number(id));
    return punto?.NombrePunto ?? '—';
  }

  formaPagoLabel(): string {
    switch (this.form?.get('FormaPago')?.value) {
      case 'Directo': return 'Pago en el punto';
      case 'Completo': return 'Ya pagó (pago completo)';
      case 'Abono': return `Abonos (${this.abonos.length} registrado(s))`;
      default: return '—';
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // RESTO DEL COMPONENTE (igual que antes, sin cambios lógicos)
  // ═══════════════════════════════════════════════════════════════════

  private readonly e164WithTenDigitsPattern = /^\+[1-9]\d{10,12}$/;
  activePaisOrigenIndex: number | null = null;

  // openSummary: ya no aplica en wizard pero lo conservamos para no romper referencias
  openSummary = false;
  toggleSummary(force?: boolean) {
    this.openSummary = typeof force === 'boolean' ? force : !this.openSummary;
  }
  private closeSummaryIfOpen(): void {
    if (this.openSummary) this.openSummary = false;
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
    const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    if (normalized.includes('fecha reservada') && normalized.includes('no puede ser pasada'))
      return 'No puedes guardar esta reserva porque la fecha del tour ya pasó. Selecciona una fecha vigente.';
    if (normalized.includes('fecha') && normalized.includes('pasada'))
      return 'No puedes guardar cambios sobre una reserva con fecha pasada.';
    if (normalized.includes('cupos') && (normalized.includes('insuficiente') || normalized.includes('disponible') || normalized.includes('supera')))
      return 'No hay cupos suficientes. Ajusta la cantidad de pasajeros o selecciona otra fecha.';
    if (normalized.includes('dni') && (normalized.includes('duplicado') || normalized.includes('registrado') || normalized.includes('existe')))
      return 'Uno de los pasajeros ya aparece registrado para esta fecha. Revisa el documento.';
    if (normalized.includes('telefono') || normalized.includes('teléfono'))
      return 'Revisa el teléfono ingresado. Debe tener el formato correcto, por ejemplo +573001234567.';
    if (normalized.includes('correo') || normalized.includes('email'))
      return 'Revisa el correo ingresado. Debe tener un formato válido.';
    if (normalized.includes('punto') && normalized.includes('horario'))
      return 'No se pudo asignar un horario para el punto de encuentro seleccionado.';
    if (normalized.includes('horario'))
      return 'No se encontró un horario válido. Revisa el tour, la fecha y el punto de encuentro.';
    if (normalized.includes('pago') || normalized.includes('abono') || normalized.includes('comprobante'))
      return 'Hay un problema con la información de pago. Revisa los abonos o comprobantes.';
    if (normalized.includes('inviabilidad logistica') || normalized.includes('rutas distintas') || normalized.includes('distancia maxima'))
      return 'La reserva tiene una inviabilidad logística. Revisa los puntos de encuentro.';
    if (normalized.includes('reserva no existe') || normalized.includes('no encontrada'))
      return 'La reserva ya no existe. Actualiza la página e intenta nuevamente.';

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
    return buscarPaisesOrigen(raw).filter(item => normalizarBusquedaPais(item) !== current);
  }

  showPaisOrigenSuggestions(index: number): boolean {
    return this.activePaisOrigenIndex === index && this.getPaisOrigenSuggestions(index).length > 0;
  }

  onPaisOrigenFocus(index: number): void { this.activePaisOrigenIndex = index; }

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

    this.pasajeros.controls.forEach(ctrl => {
      const dniCtrl = ctrl.get('DNI');
      if (!dniCtrl) return;
      const errors = { ...(dniCtrl.errors ?? {}) };
      delete errors['duplicadoEnFormulario'];
      dniCtrl.setErrors(Object.keys(errors).length ? errors : null);
    });

    vistos.forEach(indexes => {
      if (indexes.length <= 1) return;
      hayDuplicados = true;
      indexes.forEach(index => {
        const dniCtrl = this.pasajeros.at(index).get('DNI');
        if (!dniCtrl) return;
        const errors = { ...(dniCtrl.errors ?? {}) };
        errors['duplicadoEnFormulario'] = true;
        dniCtrl.setErrors(errors);
        dniCtrl.markAsTouched();
      });
    });

    if (hayDuplicados) {
      this.alertService.showModal({
        type: 'warning',
        title: 'DNI repetido en esta reserva',
        message: 'Hay pasajeros con el mismo documento dentro de la reserva actual. Corrige los DNI antes de guardar.',
        buttons: [{ text: 'Entendido', style: 'secondary', onClick: () => this.alertService.closeModal() }],
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
      const res = await firstValueFrom(this.reservasSvc.verificarDniDuplicado(dni, fecha, undefined));

      if (res?.exists) {
        const errors = { ...(dniCtrl?.errors ?? {}) };
        errors['duplicadoEnBd'] = { reserva: res.reserva };
        dniCtrl?.setErrors(errors);
        dniCtrl?.markAsTouched();

        if (!options?.silent) {
          this.mostrarAlertaDniReservado(dni, res.reserva, { blocking: false });
        }

        this.cdr.markForCheck();
        return false;
      }

      this.limpiarErrorDni(pasajeroCtrl, 'duplicadoEnBd');
      this.cdr.markForCheck();
      return true;
    } catch (error) {
      if (!options?.silent) this.showApiError(error, 'No se pudo validar el DNI');
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
      if (!dnisUnicos.has(dni)) dnisUnicos.set(dni, ctrl);
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
      this.alertService.showModal({
        type: 'warning',
        title: 'DNI con reserva existente',
        message: 'Al cambiar la fecha, uno o más pasajeros ya aparecen reservados para esa misma fecha. Revisa los campos marcados.',
        buttons: [{ text: 'Entendido', style: 'secondary', onClick: () => this.alertService.closeModal() }],
      });
    }

    this.cdr.markForCheck();
  }

  private showApiError(error: any, title = 'No se pudo completar la operación'): void {
    const message = this.getFriendlyReservaErrorMessage(error);
    this.alertService.showModal({
      type: 'error',
      title,
      message,
      buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.alertService.closeModal() }],
    });
  }

  private mostrarAlertaDniReservado(dni: string, reserva?: any, options?: { blocking?: boolean }): void {
    const idReserva = reserva?.Id_Reserva || reserva?.idReserva || reserva?.id_reserva;
    const buttons: any[] = [];

    if (idReserva) {
      buttons.push({
        text: 'Ver reserva',
        style: 'primary',
        onClick: () => {
          this.alertService.closeModal();
          this.drawer.openReserva(idReserva);
        },
      });
    }

    buttons.push({
      text: options?.blocking ? 'Corregir DNI' : 'Entendido',
      style: 'secondary',
      onClick: () => this.alertService.closeModal(),
    });

    this.alertService.showModal({
      type: options?.blocking ? 'error' : 'warning',
      title: 'Pasajero ya reservado',
      message: idReserva
        ? `El documento ${dni} ya tiene una reserva para esta misma fecha: ${idReserva}. Puedes revisar la reserva existente o corregir el DNI.`
        : `El documento ${dni} ya tiene una reserva para esta misma fecha. Corrige el DNI o revisa la reserva existente.`,
      buttons,
    });
  }

  private tipoOcupaAsiento(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): boolean {
    return tipo !== 'INFANTE';
  }

  private async refrescarCuposPorEvento(): Promise<void> {
    const ok = await this.verificarCuposDisponibles({ silent: true });
    if (!ok) {
      this.alertService.showModal({
        type: 'warning',
        title: 'Cupos actualizados',
        message: 'La disponibilidad cambió y ahora esta reserva supera los cupos disponibles. Ajusta los pasajeros antes de guardar.',
        buttons: [{ text: 'Entendido', style: 'secondary', onClick: () => this.alertService.closeModal() }],
      });
    }
  }

  async verificarCuposDisponibles(options?: { silent?: boolean }): Promise<boolean> {
    const Fecha = this.form.get('Fecha_Tour')?.value;
    const Id_Tour = this.form.get('SelectTour')?.value;
    const cant = this.pasajerosConAsiento();
    if (!Fecha || !Id_Tour) {
      this.cuposValidosActuales.set(true);
      this.cuposDisponiblesActuales.set(null);
      this.cuposStripInfo.set(null);
      return true;
    }

    try {
      const data = await firstValueFrom(this.reservasSvc.verificarCupos(Fecha, Number(Id_Tour), cant));
      const disponible = !!data?.disponible;
      const cupos = Number(data?.cuposDisponibles ?? 0);

      this.cuposDisponiblesActuales.set(cupos);
      this.cuposValidosActuales.set(disponible);
      this.cuposStripInfo.set({ ...data });

      if (!disponible && !options?.silent) {
        this.alertService.showModal({
          type: 'warning',
          title: 'Cupos insuficientes',
          message: cupos <= 0
            ? 'Este tour no tiene cupos disponibles para la fecha seleccionada.'
            : `Solo hay ${cupos} cupos disponibles. Ajusta la cantidad de pasajeros.`,
          buttons: [{ text: 'Entendido', style: 'secondary', onClick: () => this.alertService.closeModal() }],
        });
      }

      this.cdr.markForCheck();
      return disponible;
    } catch (error) {
      this.cuposValidosActuales.set(false);
      this.cuposStripInfo.set(null);
      this.showApiError(error, 'Error al verificar cupos');
      this.cdr.markForCheck();
      return false;
    }
  }

  // ── Injecciones ────────────────────────────────────────────────────
  private wsService = inject(WebSocketService);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);
  private reservasSvc = inject(Reservas);
  private alertService = inject(SirAlertService);
  private uiState = inject(UiStateService);
  private zone = inject(NgZone);
  private destroyRef = inject(DestroyRef);
  tourRules = inject(TourRulesService);

  // ── Signals ────────────────────────────────────────────────────────
  isLoading = signal<boolean>(true);
  initialLoadError = signal<string>('');
  isSubmitting = signal<boolean>(false);
  cuposDisponiblesActuales = signal<number | null>(null);
  cuposValidosActuales = signal<boolean>(true);
  cuposStripInfo = signal<CuposStripInfo | null>(null);
  adultosCantidadInput = signal<number>(0);
  ninosCantidadInput = signal<number>(0);
  infantesCantidadInput = signal<number>(0);
  isSyncingPassengerCounts = signal<boolean>(false);
  form!: FormGroup;

  Number = Number;

  tours = signal<Tour[]>([]);
  canales = signal<Canal[]>([]);
  monedas = signal<Moneda[]>([]);
  planes = signal<Plan[]>([]);
  horarioSeleccionado = signal<Horario | null>(null);
  preciosRef = signal<PrecioMap>({});
  canalComisionPctSignal = signal<number>(0);
  canalComisionPct() { return this.canalComisionPctSignal(); }

  monedaCodigo = computed(() => {
    const id = this.form?.get('Id_Moneda')?.value;
    const m = this.monedas().find(x => x.Id_Moneda === Number(id));
    return m?.Codigo || 'COP';
  });

  private getDefaultCanalId(): number {
    const canales = this.canales();
    const hotel = canales.find((c: any) =>
      String(c.Nombre_Canal || c.Nombre || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase().includes('HOTEL')
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

  private getSelectedCanalId(): number {
    return Number(this.form.get('Id_Canal')?.value || 0);
  }

  private canalSeleccionadoTieneComision(): boolean {
    const idCanal = this.getSelectedCanalId();
    if (!idCanal) return false;
    const canal = this.canales().find((item) => Number(item.Id_Canal) === idCanal);
    return Boolean(Number(canal?.Tiene_Comision || 0));
  }

  private aplicarComisionesCanalSeleccionado(comisiones?: Partial<Record<'ADULTO' | 'NINO' | 'INFANTE', number>>): void {
    const adulto = Math.floor(Number(comisiones?.ADULTO || 0));
    const nino = Math.floor(Number(comisiones?.NINO || 0));

    this.form.patchValue({
      ComisionAdulto: adulto,
      ComisionNino: nino,
      ComisionInfante: 0,
    }, { emitEvent: false });

    for (const ctrl of this.pasajeros.controls) {
      const tipo = ctrl.get('Tipo_Pasajero')?.value as 'ADULTO' | 'NINO' | 'INFANTE';
      const comision = tipo === 'ADULTO' ? adulto : tipo === 'NINO' ? nino : 0;
      ctrl.get('Comision')?.setValue(comision, { emitEvent: false });
    }
  }

  isRioClaroTour(): boolean {
    const idTour = Number(this.form?.get('SelectTour')?.value || 0);
    if (!idTour) return false;
    const tour = this.tours().find(t => Number(t.Id_Tour) === idTour);
    if (!tour) return idTour === 1;
    const nombre = String((tour as any).Nombre_Tour || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const abreviacion = String((tour as any).Abreviacion || '').toUpperCase();
    return idTour === 1 || nombre.includes('RIO CLARO') || abreviacion === 'TRC';
  }

  // ── Puntos ─────────────────────────────────────────────────────────
  puntosSeleccionados = signal<Punto[]>([]);
  puntoBusquedaResults = signal<Punto[]>([]);

  private sincronizarPuntosPasajeros(): void {
    const puntos = this.puntosSeleccionados();
    const puntoPrincipal = puntos[0]?.Id_Punto ? Number(puntos[0].Id_Punto) : null;
    const idsValidos = new Set(puntos.map(p => Number(p.Id_Punto)).filter(id => Number.isFinite(id) && id > 0));

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
        .map(p => this.normalizarRutaLogistica((p as any)?.ruta))
        .filter(r => r !== '' && r !== '0' && r !== 'PENDIENTE')
    );
    return Array.from(rutas);
  });

  distanciaMaximaPuntosLogisticosKm = computed(() => {
    const puntos = this.puntosSeleccionados().filter(p => {
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
    if (this.tieneConflictoRutasLogisticas()) mensajes.push('Los puntos seleccionados pertenecen a rutas distintas.');
    if (this.tieneConflictoDistanciaLogistica()) mensajes.push(`La distancia máxima entre puntos supera 6 km (${this.distanciaMaximaPuntosLogisticosKm().toFixed(1)} km).`);
    return mensajes.join(' ');
  });

  tieneConflictoLogisticoActual(): boolean { return this.tieneConflictoLogistico(); }

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
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private evaluarConflictoRutasEnTiempoReal(): void {
    const hayConflicto = this.tieneConflictoLogistico();
    if (hayConflicto && !this.conflictoRutasNotificado()) {
      this.alertService.showModal({
        type: 'warning',
        title: 'Inviabilidad logística detectada',
        message: this.mensajeInviabilidadLogistica() || 'Los puntos seleccionados no cumplen la validación logística.',
      });
    }
    this.conflictoRutasNotificado.set(hayConflicto);
  }

  private disponibilidadActual: any = null;
  readonly fechaTourDateFilter = (date: Date): boolean => this.isFechaTourHabilitada(date);

  // ── ngOnInit ───────────────────────────────────────────────────────
  async ngOnInit(): Promise<void> {

    this.form = this.fb.group({
      SelectTour:          [{ value: '', disabled: false }, Validators.required],
      Id_Plan:             [{ value: null, disabled: false }],
      Fecha_Tour:          [null, Validators.required],
      Id_Horario:          [null],
      Idioma_Reserva:      ['ESPAÑOL'],
      Id_Moneda:           [{ value: 1, disabled: false }, Validators.required],
      Id_Canal:            [null, Validators.required],
      Nombre_Reportante:   ['', Validators.required],
      Telefono_Reportante: ['', [Validators.required, Validators.pattern(this.e164WithTenDigitsPattern)]],
      Observaciones:       [''],
      Tipo_Reserva:        ['Grupal', Validators.required],
      Pasajeros:           this.fb.array([]),
      FormaPago:           ['Directo'],
      Abonos:              this.fb.array([]),
      ComisionInternacional: [0],
      PrecioAdulto:        [0, [Validators.min(0)]],
      PrecioNino:          [0, [Validators.min(0)]],
      PrecioInfante:       [0, [Validators.min(0)]],
      ComisionAdulto:      [0],
      ComisionNino:        [0],
      ComisionInfante:     [0],
      Id_Punto:            [null, Validators.required],
      ComprobantePago:     [null],
      PagoObservaciones:   [''],
      NacionalidadGlobal:  [''],
    });

    // WebSocket cupos
    this.wsService.reservationEvents$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((msg: any) => {
        this.zone.run(() => {
          const fecha = this.form.get('Fecha_Tour')?.value;
          const tour = this.form.get('SelectTour')?.value;

          if ((msg?.type === 'reservaCreada' || msg?.type === 'reservaActualizada') && msg?.Fecha_Tour === fecha && msg?.Id_Tour == tour) {
            void this.refrescarCuposPorEvento();
          }
          if (msg?.type === 'aforoActualizado' && msg?.Id_Tour == tour) {
            if (!msg?.Fecha || msg.Fecha === fecha) void this.refrescarCuposPorEvento();
          }
        });
      });

    await this.loadInitialData();
  }

  retryInitialLoad(): void {
    void this.loadInitialData();
  }

  private async loadInitialData(): Promise<void> {
    this.initialLoadError.set('');
    this.isLoading.set(true);

    try {
      const [tours, canales, monedas] = await Promise.all([
        firstValueFrom(this.reservasSvc.getTours()),
        firstValueFrom(this.reservasSvc.getCanales()),
        firstValueFrom(this.reservasSvc.getMonedas()),
      ]);
      this.tours.set(tours || []);
      this.canales.set(canales || []);
      this.ensureDefaultCanal();
      this.monedas.set(monedas || []);
    } catch {
      this.initialLoadError.set('No pudimos cargar la información necesaria. Intenta nuevamente.');
    } finally {
      this.isLoading.set(false);
      this.cdr.markForCheck();
    }
  }

  // ── Getters ────────────────────────────────────────────────────────
  get pasajeros(): FormArray { return this.form.get('Pasajeros') as FormArray; }
  get abonos(): FormArray { return this.form.get('Abonos') as FormArray; }

  // ── Abonos helpers ─────────────────────────────────────────────────
  private crearAbonoGroup(): FormGroup {
    return this.fb.group({
      Monto:        [0],
      Comprobante:  [null],
      Fecha_Pago:   [''],
      Observaciones: [''],
    });
  }

  agregarAbono() { this.abonos.push(this.crearAbonoGroup()); }
  eliminarAbono(i: number) { this.abonos.removeAt(i); }

  totalAbonos(): number {
    return this.abonos.controls.reduce((acc, g: any) => acc + Number(g.get('Monto')?.value || 0), 0);
  }

  get abonosValidos(): boolean {
    const total = this.totalNeto() + Number(this.form.get('ComisionInternacional')?.value || 0);
    return this.totalAbonos() <= total;
  }

  // ── Puntos: búsqueda y selección ───────────────────────────────────
  async onPuntoSearch(ev: Event) {
    const term = (ev.target as HTMLInputElement)?.value?.trim() || '';
    if (term.length < 2) { this.puntoBusquedaResults.set([]); return; }
    try {
      const results = await firstValueFrom(this.reservasSvc.buscarPuntos(term));
      this.puntoBusquedaResults.set(results || []);
    } catch {
      this.puntoBusquedaResults.set([]);
      this.alertService.showModal({
        type: 'error',
        title: 'Error buscando puntos',
        message: 'No fue posible obtener los puntos de encuentro.',
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
    this.sincronizarPuntosPasajeros();
    this.evaluarConflictoRutasEnTiempoReal();
    await this.fijarHorarioAutomatico();
    await this.verificarCuposDisponibles({ silent: false });
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
    await this.verificarCuposDisponibles({ silent: false });
  }

  // ── Horario automático ─────────────────────────────────────────────
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
        this.alertService.showModal({
          type: 'warning',
          title: 'Sin horario',
          message: 'No se encontró horario para el punto principal con el tour seleccionado.',
        });
      }
    } catch (error) {
      this.horarioSeleccionado.set(null);
      this.form.get('Id_Horario')?.setValue(null);
      this.showApiError(error, 'Error al asignar horario');
    }
  }

  // ── Cambios Tour / Plan / Moneda ───────────────────────────────────
  async onTourChange() {
    const idTour = Number(this.form.get('SelectTour')?.value);
    this.form.patchValue({ Id_Horario: null }, { emitEvent: false });
    this.horarioSeleccionado.set(null);
    this.planes.set([]);
    this.configurePlanControl([]);
    this.preciosRef.set({});
    if (!idTour) {
      this.cuposDisponiblesActuales.set(null);
      this.cuposValidosActuales.set(true);
      this.CuposDisponiblesNavbar();
      return;
    }

    try {
      this.ensureDefaultCanal();
      await this.recargarPlanesDisponibles(idTour);

      if (!this.form.get('Id_Moneda')?.value) {
        this.form.get('Id_Moneda')?.setValue(1, { emitEvent: false });
      }

      await this.fijarHorarioAutomatico();
      await this.onPlanMonedaChange(false);
      await this.recalcularComisionesPorCanal();
      await this.autollenarPrecios();
      this.recalcularTotales();

      try {
        const dispo = await firstValueFrom(this.reservasSvc.getDisponibilidadTour(idTour));
        this.disponibilidadActual = dispo || null;
        this.applyDisponibilidadToDatepicker();
      } catch {
        this.disponibilidadActual = null;
      }

      const teniaInfantes = this.countByTipo('INFANTE') > 0;
      if (teniaInfantes && !this.tourRules.allowsPassengerType(idTour, 'INFANTE')) {
        this.removeInfantes();
        this.alertService.showModal({
          type: 'warning',
          title: 'Infantes no permitidos',
          message: 'En este tour no se aceptan infantes. Han sido removidos.',
        });
      }

      this.tourRules.resetSession();
      await this.verificarCuposDisponibles({ silent: false });
      await this.revalidarDnisPorCambioDeFecha();
      this.cdr.markForCheck();
    } catch (error) {
      this.showApiError(error, 'Error al cambiar tour');
    }

    if (idTour === 5) {
      const ninos = this.countByTipo('NINO');
      const infantes = this.countByTipo('INFANTE');
      if (ninos > 0 && infantes > 0) {
        this.alertService.showModal({ type: 'info', title: 'Política de Niños e Infantes', message: 'En Hacienda Nápoles, los niños mayores de 5 años van como ADULTOS y los infantes mayores de 1 año como NIÑOS.' });
      } else if (infantes > 0) {
        this.alertService.showModal({ type: 'info', title: 'Política de Infantes', message: 'En Hacienda Nápoles, los infantes mayores de 1 año deben ser NIÑOS.' });
      } else if (ninos > 0) {
        this.alertService.showModal({ type: 'info', title: 'Política de Niños', message: 'En Hacienda Nápoles, niños mayores de 5 años deben ir como ADULTOS.' });
      }
    }
  }

  async onFechaTourChange() {
    try {
      const idTour = Number(this.form.get('SelectTour')?.value);
      if (idTour) {
        await this.recargarPlanesDisponibles(idTour);
        await this.onPlanMonedaChange(false);
      }
      await this.verificarCuposDisponibles({ silent: false });
      await this.revalidarDnisPorCambioDeFecha();
      this.cdr.markForCheck();
    } catch (error) {
      this.showApiError(error, 'Error al cambiar fecha');
    }
  }

  private configurePlanControl(planes: Plan[]) {
    const planCtrl = this.form.get('Id_Plan');
    if (!planCtrl) return;

    if (planes.length > 1) {
      planCtrl.setValidators([Validators.required]);
      planCtrl.setValue(planes[0].Id_Plan, { emitEvent: false });
    } else if (planes.length === 1) {
      planCtrl.clearValidators();
      planCtrl.setValue(planes[0].Id_Plan, { emitEvent: false });
    } else {
      planCtrl.clearValidators();
      planCtrl.setValue(null, { emitEvent: false });
    }

    planCtrl.updateValueAndValidity({ emitEvent: false });
  }

  private async recargarPlanesDisponibles(idTour: number): Promise<void> {
    const fecha = this.fechaTourSeleccionada();
    const planes = await firstValueFrom(this.reservasSvc.getPlanesByTour(idTour, fecha || undefined));
    this.planes.set(planes || []);
    this.configurePlanControl(this.planes());

    if (fecha && this.planes().length === 0) {
      this.preciosRef.set({});
      this.alertService.showModal({
        type: 'error',
        title: 'Sin planes disponibles',
        message: 'No hay planes disponibles para esta fecha.',
        buttons: [{ text: 'Entendido', style: 'secondary', onClick: () => this.alertService.closeModal() }],
      });
    }
  }

  private fechaTourSeleccionada(): string | null {
    const fecha = String(this.form.get('Fecha_Tour')?.value || '').trim();
    return fecha || null;
  }

  async onPlanMonedaChange(soloCargar = false) {
    const Id_Tour = Number(this.form.get('SelectTour')?.value);
    const Id_Plan = this.form.get('Id_Plan')?.value || null;
    const Id_Moneda = this.form.get('Id_Moneda')?.value || null;
    const fecha = this.fechaTourSeleccionada();
    if (!Id_Tour || !Id_Moneda) return;

    if (this.planes().length > 1 && !Id_Plan) {
      this.preciosRef.set({});
      if (!soloCargar) await this.autollenarPrecios();
      this.recalcularTotales();
      return;
    }

    try {
      const precios = await firstValueFrom(this.reservasSvc.getPrecios({ Id_Tour, Id_Plan, Id_Moneda, fecha: fecha || undefined }));
      this.preciosRef.set(precios || {});
      if (!soloCargar) await this.autollenarPrecios();
      this.recalcularTotales();
    } catch (error) {
      this.showApiError(error, 'Error al cargar precios');
    }
  }

  // ── Pasajeros ──────────────────────────────────────────────────────
  displayTipo(t: string | null | undefined): string {
    switch ((t || '').toUpperCase()) {
      case 'NINO': return 'NIÑO';
      case 'ADULTO': return 'ADULTO';
      case 'INFANTE': return 'INFANTE';
      default: return (t || '').toString().toUpperCase();
    }
  }

  tipoIndex(i: number): number {
    const ctrl = this.pasajeros.at(i);
    if (!ctrl) return i + 1;
    const tipo = normalizeReservaPassengerType(ctrl.get('Tipo_Pasajero')?.value);
    const mismos = this.pasajeros.controls.filter(
      c => normalizeReservaPassengerType(c.get('Tipo_Pasajero')?.value) === tipo
    );
    return mismos.indexOf(ctrl) + 1;
  }

  private countByTipo(tipo: ReservaPassengerType): number {
    return this.pasajeros.controls.filter(
      c => normalizeReservaPassengerType(c.get('Tipo_Pasajero')?.value) === tipo
    ).length;
  }

  private precioControlPorTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): string {
    return tipo === 'ADULTO' ? 'PrecioAdulto' : tipo === 'NINO' ? 'PrecioNino' : 'PrecioInfante';
  }

  private comisionControlPorTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): string {
    return tipo === 'ADULTO' ? 'ComisionAdulto' : tipo === 'NINO' ? 'ComisionNino' : 'ComisionInfante';
  }

  private precioGlobalPorTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): number {
    return Number(this.form.get(this.precioControlPorTipo(tipo))?.value || 0);
  }

  private comisionGlobalPorTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): number {
    return Number(this.form.get(this.comisionControlPorTipo(tipo))?.value || 0);
  }

  private getCantidadInputSignal(tipo: 'ADULTO' | 'NINO' | 'INFANTE') {
    return tipo === 'ADULTO' ? this.adultosCantidadInput : tipo === 'NINO' ? this.ninosCantidadInput : this.infantesCantidadInput;
  }

  private syncCantidadInputsFromFormArray(): void {
    this.adultosCantidadInput.set(this.countByTipo('ADULTO'));
    this.ninosCantidadInput.set(this.countByTipo('NINO'));
    this.infantesCantidadInput.set(this.countByTipo('INFANTE'));
  }

  private reorderPassengerFormArray(): void {
    const ordered = sortReservaPassengerControls(this.pasajeros.controls);
    const isAlreadySorted = ordered.every((ctrl, index) => this.pasajeros.at(index) === ctrl);
    if (isAlreadySorted) return;

    this.pasajeros.clear();
    for (const ctrl of ordered) this.pasajeros.push(ctrl);
    this.syncCantidadInputsFromFormArray();
  }

  private findLastPassengerIndexByTipo(tipo: ReservaPassengerType): number {
    for (let i = this.pasajeros.length - 1; i >= 0; i--) {
      if (normalizeReservaPassengerType(this.pasajeros.at(i)?.get('Tipo_Pasajero')?.value) === tipo) return i;
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

  private async puedeAjustarCantidadPasajeros(tipo: ReservaPassengerType, target: number): Promise<boolean> {
    if (!this.tipoOcupaAsiento(tipo)) return true;

    const Fecha = this.form.get('Fecha_Tour')?.value;
    const Id_Tour = this.form.get('SelectTour')?.value;

    if (!Fecha || !Id_Tour) {
      this.alertService.showModal({ type: 'warning', title: 'Datos incompletos', message: 'Selecciona tour y fecha antes de agregar pasajeros.' });
      return false;
    }

    const otrosConAsiento = this.pasajeros.controls.filter(c => {
      const t = normalizeReservaPassengerType(c.get('Tipo_Pasajero')?.value);
      return t !== tipo && this.tipoOcupaAsiento(t);
    }).length;

    const cantidadFinalConAsiento = otrosConAsiento + (this.tipoOcupaAsiento(tipo) ? target : 0);

    try {
      const data = await firstValueFrom(this.reservasSvc.verificarCupos(Fecha, Number(Id_Tour), cantidadFinalConAsiento));
      const disponible = !!data?.disponible;
      const cupos = Number(data?.cuposDisponibles ?? 0);

      this.cuposDisponiblesActuales.set(cupos);
      this.cuposValidosActuales.set(disponible);
      this.cuposStripInfo.set({ ...data });

      if (!disponible) {
        this.alertService.showModal({
          type: 'warning',
          title: 'Cupos insuficientes',
          message: cupos <= 0 ? 'Este tour no tiene cupos para la fecha seleccionada.' : `Solo hay ${cupos} cupos disponibles.`,
          buttons: [{ text: 'Entendido', style: 'secondary', onClick: () => this.alertService.closeModal() }],
        });
        return false;
      }
      return true;
    } catch (error) {
      this.showApiError(error, 'Error al verificar cupos');
      return false;
    }
  }

  private async puedeAgregarPasajero(tipo: ReservaPassengerType): Promise<boolean> {
    if (!this.tipoOcupaAsiento(tipo)) return true;

    const Fecha = this.form.get('Fecha_Tour')?.value;
    const Id_Tour = this.form.get('SelectTour')?.value;

    if (!Fecha || !Id_Tour) {
      this.alertService.showModal({ type: 'warning', title: 'Datos incompletos', message: 'Selecciona tour y fecha antes de agregar pasajeros.' });
      return false;
    }

    const cantidadSimulada = this.pasajerosConAsiento() + 1;

    try {
      const data = await firstValueFrom(this.reservasSvc.verificarCupos(Fecha, Number(Id_Tour), cantidadSimulada));
      const disponible = !!data?.disponible;
      const cupos = Number(data?.cuposDisponibles ?? 0);

      this.cuposDisponiblesActuales.set(cupos);
      this.cuposValidosActuales.set(disponible);

      if (!disponible) {
        this.alertService.showModal({
          type: 'warning',
          title: 'Cupos insuficientes',
          message: cupos <= 0 ? 'Este tour ya no tiene cupos para la fecha seleccionada.' : `Solo quedan ${cupos} cupos disponibles.`,
          buttons: [{ text: 'Entendido', style: 'secondary', onClick: () => this.alertService.closeModal() }],
        });
        return false;
      }
      return true;
    } catch (error) {
      this.showApiError(error, 'Error al verificar cupos');
      return false;
    }
  }

  async agregarPasajero(
    tipo: ReservaPassengerType,
    omitirCalculos = false,
    options?: { skipCuposCheck?: boolean }
  ): Promise<boolean> {
    const currentTourId = Number(this.form.get('SelectTour')?.value);
    if (!this.tourRules.allowsPassengerType(currentTourId, tipo)) return false;

    const Fecha = this.form.get('Fecha_Tour')?.value;
    const Id_Tour = this.form.get('SelectTour')?.value;

    if (!Id_Tour) {
      this.alertService.showModal({ type: 'warning', title: 'Datos incompletos', message: 'Selecciona un tour antes de agregar pasajeros.' });
      return false;
    }

    if (!Fecha) {
      this.alertService.showModal({ type: 'warning', title: 'Datos incompletos', message: 'Selecciona la fecha del tour antes de agregar pasajeros.' });
      return false;
    }

    if (!options?.skipCuposCheck && this.tipoOcupaAsiento(tipo)) {
      const puede = await this.puedeAgregarPasajero(tipo);
      if (!puede) return false;
    }

    const principalPunto = this.puntosSeleccionados()[0]?.Id_Punto ?? null;

    const precioInicial = this.precioGlobalPorTipo(tipo);
    const comisionInicial = this.comisionGlobalPorTipo(tipo);

    // Herencia de valores globales en el momento de creación
    const planInicial = this.form.get('Id_Plan')?.value ?? null;
    const nacionalidadInicial = this.modoNacionalidad === 'global'
      ? (String(this.form.get('NacionalidadGlobal')?.value ?? '').trim() || null)
      : null;

    const fg = this.fb.group({
      Tipo_Pasajero:     [tipo, Validators.required],
      Nombre_Pasajero:   [''],
      DNI:               [''],
      Nacionalidad:      [nacionalidadInicial, [Validators.maxLength(80)]],
      Telefono_Pasajero: [''],
      Id_Plan:           [planInicial],
      Id_Punto:          [principalPunto],
      Confirmacion:      [false],
      PrecioRef:         [this.preciosRef()[tipo] ?? 0],
      Precio_Pasajero:   [precioInicial, [Validators.min(0)]],
      Comision:          [comisionInicial],
    });

    this.conectarValidacionDniPasajero(fg);
    this.syncPassengerPhoneValidator(fg);
    const insertIndex = getReservaPassengerInsertIndex(this.pasajeros.controls, tipo);
    this.pasajeros.insert(insertIndex, fg);
    this.sincronizarPuntosPasajeros();
    this.reorderPassengerFormArray();

    this.tourRules.evaluateAlertsForPassenger(currentTourId, tipo);

    if (!omitirCalculos) this.recalcularTotales();

    this.syncCantidadInputsFromFormArray();
    return true;
  }

  eliminarPasajero(i: number) {
    this.pasajeros.removeAt(i);
    this.recalcularTotales();
    this.syncCantidadInputsFromFormArray();
    this.validarDnisDuplicadosEnFormulario();
  }

  adultosInputValue(): number { return this.adultosCantidadInput(); }
  ninosInputValue(): number { return this.ninosCantidadInput(); }
  infantesInputValue(): number { return this.infantesCantidadInput(); }

  onCantidadInputChange(tipo: 'ADULTO' | 'NINO' | 'INFANTE', value: any): void {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    this.getCantidadInputSignal(tipo).set(safe);
  }

  async commitCantidadPasajeros(tipo: ReservaPassengerType): Promise<void> {
    const target = this.getCantidadInputSignal(tipo)();
    await this.setCantidadPasajeros(tipo, target);
    this.syncCantidadInputsFromFormArray();
    await this.verificarCuposDisponibles({ silent: true });
    this.cdr.markForCheck();
  }

  async setCantidadPasajeros(tipo: ReservaPassengerType, val: any): Promise<void> {
    const currentTourId = Number(this.form.get('SelectTour')?.value);
    if (!this.tourRules.allowsPassengerType(currentTourId, tipo)) return;

    const n = Math.max(0, Math.floor(Number(val || 0)));
    const cur = this.countByTipo(tipo);

    if (n === cur) { this.syncCantidadInputsFromFormArray(); return; }

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
      this.reorderPassengerFormArray();
      this.syncCantidadInputsFromFormArray();
      this.validarDnisDuplicadosEnFormulario();
    } finally {
      this.isSyncingPassengerCounts.set(false);
      this.syncCantidadInputsFromFormArray();
      this.cdr.markForCheck();
    }
  }

  async autollenarPrecios() {
    const idTour = Number(this.form.get('SelectTour')?.value);
    const idCanal = this.getSelectedCanalId();

    if (!idTour) {
      for (const ctrl of this.pasajeros.controls) {
        ctrl.get('Comision')?.setValue(0, { emitEvent: false });
        if (!ctrl.get('Precio_Pasajero')?.dirty) ctrl.get('Precio_Pasajero')?.setValue(0, { emitEvent: false });
        ctrl.get('PrecioRef')?.setValue(0, { emitEvent: false });
      }
      this.aplicarComisionesCanalSeleccionado();
      this.cdr.markForCheck();
      return;
    }

    const ref = this.preciosRef();
    this.form.patchValue({
      PrecioAdulto: Number(ref.ADULTO || 0),
      PrecioNino: Number(ref.NINO || 0),
      PrecioInfante: Number(ref.INFANTE || 0),
    }, { emitEvent: false });

    for (const ctrl of this.pasajeros.controls) {
      const tipo = ctrl.get('Tipo_Pasajero')?.value as 'ADULTO' | 'NINO' | 'INFANTE';
      if (!ctrl.get('Id_Plan')?.dirty) ctrl.get('Id_Plan')?.setValue(this.form.get('Id_Plan')?.value ?? null, { emitEvent: false });
      ctrl.get('PrecioRef')?.setValue(ref[tipo] ?? 0, { emitEvent: false });
      ctrl.get('Precio_Pasajero')?.setValue(this.precioGlobalPorTipo(tipo), { emitEvent: false });
    }

    if (!idCanal || !this.canalSeleccionadoTieneComision()) {
      this.aplicarComisionesCanalSeleccionado();
      this.cdr.markForCheck();
      return;
    }

    try {
      const comisiones = await firstValueFrom(this.reservasSvc.getComisiones(idTour, idCanal));
      this.aplicarComisionesCanalSeleccionado(comisiones);
    } catch {
      this.aplicarComisionesCanalSeleccionado();
    }

    this.cdr.markForCheck();
  }

  private applyDisponibilidadToDatepicker() {
    const cur = this.form.get('Fecha_Tour')?.value;
    const curDate = this.parseDateOnly(cur);
    if (curDate && !this.isFechaTourHabilitada(curDate)) {
      this.form.get('Fecha_Tour')?.setValue(null);
    }

    this.cdr.markForCheck();
  }

  get fechaTourMinDate(): string {
    return toDateOnly(new Date()) || '';
  }

  private isFechaTourHabilitada(date: Date): boolean {
    const d = toDateOnly(date);
    if (!d) return false;
    if (d < this.fechaTourMinDate) return false;
    if (!this.disponibilidadActual) return true;
    return isTourDateAvailable(d, this.disponibilidadActual);
  }

  private parseDateOnly(value: unknown): Date | null {
    const ymd = toDateOnly(value);
    if (!ymd) return null;
    const [y, m, d] = ymd.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  pasajerosConAsiento(): number {
    return this.pasajeros.controls.filter(c => {
      const t = normalizeReservaPassengerType(c.get('Tipo_Pasajero')?.value);
      return t === 'ADULTO' || t === 'NINO';
    }).length;
  }

  async recalcularComisionesPorCanal() {
    const idTour = Number(this.form.get('SelectTour')?.value);
    const idCanal = this.getSelectedCanalId();
    if (!idTour || !idCanal || !this.canalSeleccionadoTieneComision()) {
      this.aplicarComisionesCanalSeleccionado();
      this.cdr.markForCheck();
      return;
    }
    try {
      const comisiones = await firstValueFrom(this.reservasSvc.getComisiones(idTour, idCanal));
      this.aplicarComisionesCanalSeleccionado(comisiones);
    } catch {
      this.aplicarComisionesCanalSeleccionado();
    }
    this.cdr.markForCheck();
  }

  actualizarPreciosComisionesPorTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): void {
    this.actualizarPrecioGlobalPorTipo(tipo);
    this.actualizarComisionGlobalPorTipo(tipo);
  }

  actualizarPrecioGlobalPorTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): void {
    const precio = this.precioGlobalPorTipo(tipo);

    for (const ctrl of this.pasajeros.controls) {
      if (ctrl.get('Tipo_Pasajero')?.value === tipo && this.modoPrecio === 'global') {
        ctrl.get('Precio_Pasajero')?.setValue(precio, { emitEvent: false });
        ctrl.get('Precio_Pasajero')?.markAsDirty();
      }
    }

    this.recalcularTotales();
    this.cdr.markForCheck();
  }

  actualizarComisionGlobalPorTipo(tipo: 'ADULTO' | 'NINO' | 'INFANTE'): void {
    const comision = this.comisionGlobalPorTipo(tipo);

    for (const ctrl of this.pasajeros.controls) {
      if (ctrl.get('Tipo_Pasajero')?.value === tipo && this.modoComision === 'global') {
        ctrl.get('Comision')?.setValue(comision, { emitEvent: false });
        ctrl.get('Comision')?.markAsDirty();
      }
    }

    this.recalcularTotales();
    this.cdr.markForCheck();
  }

  // ── Totales ────────────────────────────────────────────────────────
  totalNeto(): number {
    return this.pasajeros.controls.reduce((sum, c) => sum + Number(c.get('Precio_Pasajero')?.value || 0), 0);
  }

  totalPorTipo(tipo: ReservaPassengerType): number {
    return this.pasajeros.controls
      .filter((control) => normalizeReservaPassengerType(control.get('Tipo_Pasajero')?.value) === tipo)
      .reduce((total, control) => total + Number(control.get('Precio_Pasajero')?.value || 0), 0);
  }

  resumenTiposPasajero(): string {
    return (['ADULTO', 'NINO', 'INFANTE'] as ReservaPassengerType[])
      .map((tipo) => ({ tipo, cantidad: this.countByTipo(tipo) }))
      .filter(({ cantidad }) => cantidad > 0)
      .map(({ tipo, cantidad }) => `${cantidad} ${reservaPassengerTypeLabel(tipo).toLocaleLowerCase('es-CO')}${cantidad === 1 ? '' : 's'}`)
      .join(' · ');
  }

  comisionTotal(): number {
    return this.pasajeros.controls.reduce((sum, c) => sum + Number(c.get('Comision')?.value || 0), 0);
  }

  pendientePorPagar(): number {
    const forma = this.form.get('FormaPago')?.value;
    const total = this.totalNeto() + Number(this.form.get('ComisionInternacional')?.value || 0);
    if (forma === 'Abono') return Math.max(0, total - this.totalAbonos());
    if (forma === 'Completo') return 0;
    return total;
  }

  recalcularTotales() { /* getters reactivos */ }

  // ── Cupos Navbar ───────────────────────────────────────────────────
  CuposDisponiblesNavbar(): void {
    const { Fecha_Tour, SelectTour, Tipo_Reserva } = this.form.value;
    if (Tipo_Reserva !== 'Grupal') { this.cuposStripInfo.set(null); return; }
    if (Fecha_Tour && SelectTour) {
      this.reservasSvc.verificarCupos(Fecha_Tour, SelectTour, this.pasajerosConAsiento()).subscribe({
        next: data => {
          this.cuposDisponiblesActuales.set(Number(data?.cuposDisponibles ?? 0));
          this.cuposValidosActuales.set(!!data?.disponible);
          this.cuposStripInfo.set({ ...data });
        },
        error: () => this.cuposStripInfo.set(null),
      });
    } else {
      this.cuposStripInfo.set(null);
      this.cuposDisponiblesActuales.set(null);
      this.cuposValidosActuales.set(true);
    }
  }

  // ── Submit ─────────────────────────────────────────────────────────
  private confirmarReserva(titulo: string, mensaje: string): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      this.alertService.confirm(titulo, mensaje, () => resolve(true), () => resolve(false));
    });
  }

  private parsePuntoId(raw: unknown): number | null {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private syncPrincipalPointControl(): void {
    const puntos = this.puntosSeleccionados();
    const ctrl = this.form.get('Id_Punto');
    if (!ctrl) return;

    if (!puntos.length) {
      ctrl.setValue(null, { emitEvent: false });
      return;
    }

    const actual = this.parsePuntoId(ctrl.value);
    const sigueVisible = puntos.some((p) => Number(p.Id_Punto) === actual);
    if (!sigueVisible) {
      ctrl.setValue(puntos[0]?.Id_Punto ?? null, { emitEvent: false });
    }
  }

  private syncPassengerPhoneValidator(ctrl: AbstractControl | null): void {
    const tipo = normalizeReservaPassengerType(ctrl?.get('Tipo_Pasajero')?.value);
    const telefonoCtrl = ctrl?.get('Telefono_Pasajero');
    if (!telefonoCtrl) return;

    if (tipo === 'ADULTO') {
      telefonoCtrl.setValidators([Validators.required, Validators.pattern(this.e164WithTenDigitsPattern)]);
    } else {
      telefonoCtrl.clearValidators();
    }

    telefonoCtrl.updateValueAndValidity({ emitEvent: false });
  }

  private syncPassengerPhoneValidators(): void {
    for (const passengerCtrl of this.pasajeros.controls) {
      this.syncPassengerPhoneValidator(passengerCtrl);
    }
  }

  private focusValidationTarget(step: number, focusId?: string): void {
    if (this.currentStep !== step) {
      this.currentStep = step;
      this.maxReachedStep = Math.max(this.maxReachedStep, step);
      this.triggerPanelAnimation(false);
      this.cdr.markForCheck();
    }

    setTimeout(() => {
      const element = focusId ? document.getElementById(focusId) : null;
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if ('focus' in element) {
          (element as HTMLElement).focus();
        }
        return;
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 80);
  }

  private getPassengerValidationIssue(): SubmitValidationIssue | null {
    if (!this.form.get('Pasajeros')?.invalid) return null;

    const counters: Record<ReservaPassengerType, number> = {
      ADULTO: 0,
      NINO: 0,
      INFANTE: 0,
    };

    for (let i = 0; i < this.pasajeros.length; i++) {
      const ctrl = this.pasajeros.at(i);
      const tipo = normalizeReservaPassengerType(ctrl.get('Tipo_Pasajero')?.value);
      counters[tipo] += 1;
      const prefix = `${reservaPassengerTypeLabel(tipo)} ${counters[tipo]}`;

      if (ctrl.get('Tipo_Pasajero')?.hasError('required')) {
        return { message: `${prefix}: falta tipo de pasajero`, step: 3, focusId: `crear-pasajero-${i}-nombre` };
      }

      if (ctrl.get('DNI')?.errors?.['duplicadoEnFormulario']) {
        return { message: `${prefix}: documento repetido en esta reserva`, step: 3, focusId: `crear-pasajero-${i}-dni` };
      }

      if (ctrl.get('DNI')?.errors?.['duplicadoEnBd']) {
        return { message: `${prefix}: ese DNI o pasaporte ya tiene reserva para esta fecha`, step: 3, focusId: `crear-pasajero-${i}-dni` };
      }

      if (tipo === 'ADULTO') {
        const telefonoCtrl = ctrl.get('Telefono_Pasajero');
        const telefono = String(telefonoCtrl?.value ?? '').trim();
        if (telefonoCtrl?.hasError('required')) {
          return { message: `${prefix}: el teléfono es obligatorio`, step: 3, focusId: `crear-pasajero-${i}-telefono` };
        }
        if (telefonoCtrl?.hasError('pattern') && telefono) {
          return { message: `${prefix}: el teléfono debe tener formato +573001234567`, step: 3, focusId: `crear-pasajero-${i}-telefono` };
        }
      }

      if (ctrl.get('Nacionalidad')?.errors?.['required']) {
        return { message: `${prefix}: falta país de origen`, step: 3, focusId: `crear-pasajero-${i}-nacionalidad` };
      }

      if (ctrl.get('Nacionalidad')?.errors?.['maxlength']) {
        return { message: `${prefix}: el país de origen supera la longitud permitida`, step: 3, focusId: `crear-pasajero-${i}-nacionalidad` };
      }

      if (ctrl.get('Precio_Pasajero')?.errors?.['min']) {
        return { message: `${prefix}: el precio no puede ser negativo`, step: 3, focusId: `crear-pasajero-${i}-precio` };
      }
    }

    return { message: 'Revisa los datos de los pasajeros.', step: 3, focusId: 'crear-pasajero-card-0' };
  }

  private getSubmitValidationIssue(): SubmitValidationIssue | null {
    this.syncPrincipalPointControl();
    this.sincronizarPuntosPasajeros();
    this.reorderPassengerFormArray();
    this.syncPassengerPhoneValidators();
    this.form.updateValueAndValidity({ emitEvent: false });

    const puntoPrincipal = this.parsePuntoId(this.form.get('Id_Punto')?.value);
    const puntos = this.puntosSeleccionados();
    const principalValido = puntoPrincipal !== null && puntos.some((p) => Number(p.Id_Punto) === puntoPrincipal);
    if (!principalValido) {
      this.form.get('Id_Punto')?.markAsTouched();
      return {
        message: 'Selecciona un punto principal de encuentro',
        step: 2,
        focusId: 'crear-punto-busqueda',
      };
    }

    const passengerIssue = this.getPassengerValidationIssue();
    if (passengerIssue) return passengerIssue;

    if (!this.form.invalid) return null;

    const invalid = Object.keys(this.form.controls).filter(
      (key) => key !== 'Pasajeros' && this.form.get(key)?.invalid
    );
    const friendly: Record<string, string> = {
      SelectTour: 'Tour',
      Fecha_Tour: 'Fecha del Tour',
      Id_Plan: 'Plan',
      Id_Moneda: 'Moneda',
      Id_Canal: 'Canal',
      Nombre_Reportante: 'Nombre del reportante',
      Telefono_Reportante: 'Teléfono del reportante',
      Tipo_Reserva: 'Tipo de reserva',
      Id_Punto: 'Selecciona un punto principal de encuentro',
    };

    if (!invalid.length) return null;

    const first = invalid[0];
    return {
      message: friendly[first] || `Revisa el campo ${first}`,
      step: first === 'SelectTour' || first === 'Fecha_Tour' ? 0 : first === 'Nombre_Reportante' || first === 'Telefono_Reportante' ? 1 : 2,
    };
  }

  async onSubmit(): Promise<void> {
    if (this.isSubmitting()) return;
    this.isSubmitting.set(true);

    const validationIssue = this.getSubmitValidationIssue();
    if (validationIssue) {
      this.form.markAllAsTouched();
      this.alertService.showModal({
        type: 'error', title: 'Campos requeridos incompletos', message: validationIssue.message,
        buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.alertService.closeModal() }],
      });
      this.focusValidationTarget(validationIssue.step, validationIssue.focusId);
      this.isSubmitting.set(false);
      return;
    }

    if (this.tieneConflictoLogistico()) {
      this.alertService.showModal({
        type: 'error', title: 'Inviabilidad logística',
        message: this.mensajeInviabilidadLogistica() || 'Corrige los puntos de encuentro antes de guardar.',
        buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.alertService.closeModal() }],
      });
      this.isSubmitting.set(false);
      return;
    }

    if (this.pasajeros.length === 0) {
      this.alertService.showModal({
        type: 'error', title: 'Sin pasajeros',
        message: 'Debes agregar al menos un pasajero para crear la reserva.',
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.alertService.closeModal() }],
      });
      this.isSubmitting.set(false);
      return;
    }

    const tourNombre = this.tours().find(t => t.Id_Tour === Number(this.form.get('SelectTour')?.value))?.Nombre_Tour ?? '—';
    const fecha = this.form.get('Fecha_Tour')?.value ?? '—';
    const ad = this.pasajeros.controls.filter(c => c.get('Tipo_Pasajero')?.value === 'ADULTO').length;
    const ni = this.pasajeros.controls.filter(c => c.get('Tipo_Pasajero')?.value === 'NINO').length;
    const infa = this.pasajeros.controls.filter(c => c.get('Tipo_Pasajero')?.value === 'INFANTE').length;
    const totalNeto = this.totalNeto();

    const dnisOk = await this.validarTodosLosDniAntesDeGuardar();
    if (!dnisOk) { this.isSubmitting.set(false); return; }

    const ok = await this.confirmarReserva(
      '¿Todo listo?',
      `Vas a crear la reserva para ${tourNombre} el ${fecha}.\nPasajeros: Adultos ${ad} · Niños ${ni} · Infantes ${infa}.\nTotal neto: ${this.monedaCodigo()} ${totalNeto}.\n¿Deseas continuar?`
    );

    if (!ok) { this.isSubmitting.set(false); return; }

    const cuposOk = await this.verificarCuposDisponibles({ silent: false });
    if (!cuposOk) { this.isSubmitting.set(false); return; }

    try {
      this.reorderPassengerFormArray();
      this.syncPrincipalPointControl();
      this.sincronizarPuntosPasajeros();

      const pax = this.pasajeros.controls.map(c => ({
        Nombre_Pasajero: this.toUpperText(c.get('Nombre_Pasajero')?.value),
        DNI: this.normalizarDni(c.get('DNI')?.value) || null,
        Nacionalidad: this.normalizarNacionalidad(c.get('Nacionalidad')?.value),
        Telefono_Pasajero: c.get('Telefono_Pasajero')?.value || null,
        Tipo_Pasajero: normalizeReservaPassengerType(c.get('Tipo_Pasajero')?.value),
        Id_Plan: c.get('Id_Plan')?.value ?? this.form.get('Id_Plan')?.value ?? null,
        Id_Punto: (() => {
          const rawIndividual = c.get('Id_Punto')?.value ?? c.get('PuntoEncuentro')?.value;
          const parsedIndividual = rawIndividual != null && rawIndividual !== '' ? Number(rawIndividual) : null;
          if (Number.isFinite(parsedIndividual as number)) return parsedIndividual;
          const rawGlobal = this.form.get('Id_Punto')?.value;
          const parsedGlobal = rawGlobal != null && rawGlobal !== '' ? Number(rawGlobal) : null;
          return Number.isFinite(parsedGlobal as number) ? parsedGlobal : null;
        })(),
        Confirmacion: false,
        Precio_Tour: Number(c.get('PrecioRef')?.value || 0),
        Precio_Pasajero: Number(c.get('Precio_Pasajero')?.value || 0),
        Comision: Number(c.get('Comision')?.value || 0),
      }));

      type PagoTipo = 'Pago Directo' | 'Pago Completo' | 'Abono';
      const pagos: Array<{ Monto: number; Tipo: PagoTipo; fileField?: string }> = [];
      const archivos: { completo?: File | null; abonos?: (File | null)[] } = { abonos: [] };

      const forma = this.form.get('FormaPago')?.value as 'Directo' | 'Completo' | 'Abono';
      let comprobanteCompletoFile: File | null = null;

      if (forma === 'Directo') {
        pagos.push({ Monto: totalNeto, Tipo: 'Pago Directo' });
      } else if (forma === 'Completo') {
        const file: File | null = this.form.get('ComprobantePago')?.value || null;
        pagos.push({ Monto: totalNeto, Tipo: 'Pago Completo', fileField: 'comprobante_pago', Observaciones: this.toUpperText(this.form.get('PagoObservaciones')?.value) || null } as any);
        archivos.completo = file;
        comprobanteCompletoFile = file;
      } else if (forma === 'Abono') {
        this.abonos.controls.forEach((g, i) => {
          const monto = Number(g.get('Monto')?.value || 0);
          const f: File | null = g.get('Comprobante')?.value || null;
          if (monto > 0) {
            pagos.push({ Monto: monto, Tipo: 'Abono', fileField: `abono_${i}`, Fecha_Pago: g.get('Fecha_Pago')?.value || null, Observaciones: this.toUpperText(g.get('Observaciones')?.value) || null } as any);
          }
          archivos.abonos!.push(f);
        });
      }

      const { estado, subestado, motivo } = this.resolverEstadoYMotivo(pax, forma, !!comprobanteCompletoFile);

      const cab = {
        Tipo_Reserva: this.form.get('Tipo_Reserva')?.value,
        Id_Horario: this.form.get('Id_Horario')?.value || null,
        Fecha_Tour: this.form.get('Fecha_Tour')?.value,
        Id_Canal: this.form.get('Id_Canal')?.value,
        Id_Moneda: this.form.get('Id_Moneda')?.value,
        Idioma_Reserva: this.toUpperText(this.form.get('Idioma_Reserva')?.value),
        Telefono_Reportante: this.form.get('Telefono_Reportante')?.value,
        Nombre_Reportante: this.toUpperText(this.form.get('Nombre_Reportante')?.value),
        Observaciones: this.toUpperText(this.form.get('Observaciones')?.value),
        Id_Tour: this.form.get('SelectTour')?.value,
        Id_Punto: this.form.get('Id_Punto')?.value,
        Estado: estado,
      };

      const payload = { cabeceraReserva: cab, pasajeros: pax, pagos };
      const res = await firstValueFrom(this.reservasSvc.crearReserva(payload, archivos));

      if (res?.Id_Reserva) {
        this.uiState.needsRefresh.set('reservas');
        const estadoTexto = subestado ? `${estado} ${subestado}` : estado;
        this.alertService.showModal({
          type: 'success',
          title: 'Reserva creada',
          message: `La reserva ${res.Id_Reserva} fue generada correctamente. Estado: ${estadoTexto}.`,
          buttons: [
            {
              text: 'Cerrar',
              style: 'secondary',
              onClick: () => {
                this.alertService.closeModal();
                this.goToVerReservas();
              }
            },
            {
              text: 'Ver Reserva',
              style: 'primary',
              onClick: () => {
                this.alertService.closeModal();
                this.goToVerReservas(res.Id_Reserva, true);
              }
            },
          ],
        });

        // Reset completo + vuelve al paso 0
        this.abonos.clear();
        this.pasajeros.clear();
        this.puntosSeleccionados.set([]);
        this.horarioSeleccionado.set(null);
        this.preciosRef.set({});
        this.cuposStripInfo.set(null);
        this.syncCantidadInputsFromFormArray();
        this.form.reset();
        this.currentStep = 0;
        // Reset modos configuración
        this.modoNacionalidad = 'global';
        this.modoPrecio = 'global';
        this.modoPlan = 'global';
        this.modoComision = 'global';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        this.form.markAsPristine();
        this.cdr.markForCheck();
      } else {
        this.alertService.showModal({
          type: 'error', title: 'Error al crear reserva',
          message: 'No se pudo crear la reserva. Revisa los datos e intenta nuevamente.',
          buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.alertService.closeModal() }],
        });
      }
    } catch (err) {
      this.showApiError(err, 'Error al crear reserva');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ── Misc helpers ───────────────────────────────────────────────────
  hasUnsavedChanges(): boolean { return this.form?.dirty && !this.isSubmitting(); }
  submitActionLabel(): string { return 'Crear Reserva'; }
  submitActionProgressLabel(): string { return 'Creando...'; }

  getPhoneError(controlName: string): string {
    const ctrl = this.form?.get(controlName);
    if (!ctrl) return 'Teléfono inválido.';
    if (ctrl.hasError('required')) return 'El teléfono es obligatorio.';
    if (ctrl.hasError('pattern')) return "Debe iniciar con '+' y tener indicativo + exactamente 10 dígitos (ej: +573001234567).";
    return 'Teléfono inválido.';
  }

  seleccionarTexto(e: any) { e?.target?.select?.(); }
  horaSalida(): string { return this.horarioSeleccionado()?.HoraSalida || ''; }

  calcCuposEstado(info: CuposStripInfo): 'green' | 'yellow' | 'red' {
    const total = Math.max(0, Number(info.cupoTotal ?? 0));
    const ocupados = Math.max(0, Number(info.ocupados ?? 0));
    const disponibles = Math.max(0, Number(info.cuposDisponibles ?? (total - ocupados)));
    const pct = total > 0 ? Math.min(100, (ocupados / total) * 100) : 0;
    if (disponibles === 0 || pct >= 100) return 'red';
    if (disponibles <= 4 || pct >= 85) return 'yellow';
    return 'green';
  }

  calcCuposDisp(info: CuposStripInfo): number {
    const total = Math.max(0, Number(info.cupoTotal ?? 0));
    const ocupados = Math.max(0, Number(info.ocupados ?? 0));
    return Math.max(0, Number(info.cuposDisponibles ?? (total - ocupados)));
  }

  calcCuposOcupacion(info: CuposStripInfo): number {
    const total = Math.max(0, Number(info.cupoTotal ?? 0));
    const ocupados = Math.max(0, Number(info.ocupados ?? 0));
    return total > 0 ? Math.min(100, (ocupados / total) * 100) : 0;
  }

  // ── Files ──────────────────────────────────────────────────────────
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const ctrl = this.form.get('ComprobantePago');
    if (!input?.files?.length || !ctrl) return;

    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) {
      this.alertService.showModal({ type: 'warning', title: 'Archivo muy grande', message: 'El máximo permitido es 5 MB.' });
      ctrl.setValue(null); input.value = '';
      return;
    }
    if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) {
      this.alertService.showModal({ type: 'warning', title: 'Formato no permitido', message: 'Sólo PDF, JPG o PNG.' });
      ctrl.setValue(null); input.value = '';
      return;
    }
    ctrl.setValue(file);
    ctrl.markAsDirty();
    ctrl.updateValueAndValidity({ emitEvent: false });
    this.alertService.successToast('Comprobante listo', file.name, 3200);
  }

  onAbonoFileSelected(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const abonoControl = this.abonos.at(index) as FormGroup;
    if (!input?.files?.length || !abonoControl) return;

    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) {
      this.alertService.showModal({ type: 'warning', title: 'Archivo muy grande', message: 'El máximo permitido es 5 MB.' });
      abonoControl.get('Comprobante')?.setValue(null); input.value = '';
      return;
    }
    if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) {
      this.alertService.showModal({ type: 'warning', title: 'Formato no permitido', message: 'Sólo PDF, JPG o PNG.' });
      abonoControl.get('Comprobante')?.setValue(null); input.value = '';
      return;
    }
    abonoControl.get('Comprobante')?.setValue(file);
    abonoControl.markAsDirty();
    abonoControl.updateValueAndValidity({ emitEvent: false });
    this.alertService.successToast('Archivo listo', file.name, 3200);
  }

  eliminarComprobanteAbono(index: number): void {
    const abonoControl = this.abonos.at(index) as FormGroup;
    abonoControl.get('Comprobante')?.setValue(null);
    abonoControl.markAsDirty();
    abonoControl.updateValueAndValidity({ emitEvent: false });
    const input = document.getElementById(`ComprobanteAbono${index}`) as HTMLInputElement | null;
    if (input) input.value = '';
  }

  viewComprobante(url: string | null) {
    if (!url) return;
    const href = this.resolveComprobanteUrl(url);
    if (!href) {
      this.alertService.showModal({ type: 'warning', title: 'Comprobante inválido', message: 'No se pudo resolver la URL del comprobante.' });
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

    this.alertService.showModal({
      type: 'warning', title: 'Eliminar comprobante',
      message: 'Esta acción eliminará el comprobante actual. ¿Deseas continuar?',
      buttons: [
        { text: 'Cancelar', style: 'secondary', onClick: () => this.alertService.closeModal() },
        {
          text: 'Eliminar', style: 'primary',
          onClick: () => {
            this.alertService.closeModal();
            const idPago = Number(currentValue?.Id_Pago);
            const idReservaRaw = currentValue?.Id_Reserva || this.uiState.reservaId();
            const idReserva = idReservaRaw ? String(idReservaRaw) : '';

            if (Number.isFinite(idPago) && idPago > 0 && idReserva) {
              this.reservasSvc.eliminarComprobantePagoReserva(idReserva, idPago).subscribe({
                next: () => {
                  this.clearComprobanteLocalState();
                  this.alertService.successToast('Comprobante eliminado', '', 3000);
                },
                error: () => {
                  this.alertService.showModal({ type: 'error', title: 'Error al eliminar', message: 'No se pudo eliminar el comprobante.' });
                },
              });
              return;
            }
            this.clearComprobanteLocalState();
            this.alertService.infoToast('Archivo retirado del formulario', '', 3000);
          },
        },
      ],
    });
  }

  private clearComprobanteLocalState(): void {
    const ctrl = this.form.get('ComprobantePago');
    if (ctrl) { ctrl.setValue(null); ctrl.markAsDirty(); ctrl.updateValueAndValidity({ emitEvent: false }); }
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

  // ── Estado y validaciones de pago ──────────────────────────────────
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
      if (tel) hayTelefonoPasajero = true;
    }

    const okNombres = faltanNombre === 0;
    const okDni = faltanDni === 0;

    return { ok: okNombres && okDni && hayTelefonoPasajero, okNombres, okDni, hayTelefonoPasajero, faltanNombre, faltanDni };
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
      return { estado: 'Pendiente', subestado: 'de datos', motivo: `Faltan datos básicos: ${partes.join('; ')}.` };
    }

    if (formaPago === 'Directo') return { estado: 'Confirmada', subestado: null, motivo: 'Pago directo y datos completos.' };
    if (formaPago === 'Completo') {
      return tieneComprobanteCompleto
        ? { estado: 'Confirmada', subestado: null, motivo: 'Pago completo con comprobante y datos completos.' }
        : { estado: 'Pendiente', subestado: 'de pago', motivo: 'Falta el comprobante del pago completo.' };
    }
    return { estado: 'Confirmada', subestado: 'de pago', motivo: 'Se registró un abono. La reserva queda confirmada con saldo pendiente.' };
  }

  // ── Compat (referenciados desde navbar / editar-reserva compartido) ──
  private verReservaDuplicada(idReserva: string) { this.uiState.reservaId.set(idReserva); }
  duplicarReserva() { console.warn('duplicarReserva no está implementado en CrearReservaComponent'); }

  private goToVerReservas(idReserva?: string | null, openDrawer = false): void {
    this.uiState.needsRefresh.set('reservas');
    this.cuposStripInfo.set(null);
    const reserva = idReserva ? String(idReserva) : '';
    if (openDrawer && reserva) {
      this.drawer.openReserva(reserva);
    }
    void this.router.navigate(
      ['/Reservas/VerReservas'],
      { queryParamsHandling: 'preserve' }
    );
  }

  ngOnDestroy(): void {
    this.cuposStripInfo.set(null);
    this.alertService.closeModal();
  }
}
