import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators
} from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { puntosService, Punto } from '../../../services/Puntos/puntos';
import { Reservas } from '../../../services/Reservas/reservas';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { finalize, firstValueFrom, Subscription } from 'rxjs';

const ADDRESS_SIMILARITY_THRESHOLD = 0.88;
const ADDRESS_NAME_SIMILARITY_THRESHOLD = 0.82;
const NAME_SIMILARITY_THRESHOLD = 0.75;

@Component({
  selector: 'app-editar-punto',
  templateUrl: './editar-punto.html',
  styleUrls: ['../crear-punto/crear-punto.css'],
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, CommonModule, LoadingStateComponent]
})
export class EditarPuntoComponent implements OnInit, OnDestroy {
  isLoading = signal(true);
  loadError = signal('');
  isSubmitting = signal(false);
  successMsg = '';
  errorMsg = '';

  form: any;
  tours = signal<any[]>([]);
  rutas = signal<string[]>([]);
  puntosRuta = signal<any[]>([]);
  coordinateStatus = signal<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  coordinateDetail = signal('');
  esPuntoProtegido = signal(false);
  horariosMap: Record<number | string, string> = {};
  similarityState: 'none' | 'similar' | 'exact' = 'none';
  duplicatePoint: any = null;
  private addrTimer: any = null;
  private routePointsRequest?: Subscription;
  private addressRequest?: Subscription;
  puntoId: number | null = null;
  private toursLoaded = false;
  private rutasLoaded = false;
  private puntoLoaded = false;
  private rutaOriginal = '';
  private posicionOriginal = 0;
  private reubicar = false;

  constructor(private fb: FormBuilder, private puntos: puntosService, private route: ActivatedRoute, private router: Router, private reservasSvc: Reservas, private alerts: SirAlertService, private permisosService: PermisosService) {
    this.form = this.fb.group({
      NombrePunto: ['', [Validators.required, Validators.maxLength(255)]],
      Sector: ['', [Validators.required, Validators.maxLength(255)]],
      Direccion: ['', [Validators.required]],
      Coordenadas: ['', [Validators.required, this.coordenadasValidator()]],
      routeMode: ['existing'],
      rutaExistente: [''],
      rutaNueva: [''],
      IdPuntoAnterior: [null]
    });
  }

  get canUpdatePunto(): boolean {
    return this.permisosService.tienePermiso('PUNTOS.ACTUALIZAR');
  }

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    this.puntoId = Number(idParam);
    this.loadInitialData();
  }

  ngOnDestroy(): void {
    if (this.addrTimer) clearTimeout(this.addrTimer);
    this.routePointsRequest?.unsubscribe();
    this.addressRequest?.unsubscribe();
  }

  loadInitialData(): void {
    if (!this.puntoId || !Number.isInteger(this.puntoId) || this.puntoId <= 0) {
      this.isLoading.set(false);
      this.loadError.set('El identificador del punto no es válido.');
      return;
    }

    this.loadError.set('');
    this.isLoading.set(true);
    this.toursLoaded = false;
    this.rutasLoaded = false;
    this.puntoLoaded = false;
    this.horariosMap = {};
    this.loadTours();
    this.loadRutas();
    this.loadPunto(this.puntoId);
  }

  private loadRutas(): void {
    this.puntos.getRutasPuntos().subscribe({
      next: rutas => {
        this.rutas.set((rutas || [])
          .filter(ruta => String(ruta).toUpperCase() !== 'PENDIENTE')
          .sort((a, b) => String(a).localeCompare(String(b), 'es', {
            numeric: true,
            sensitivity: 'base'
          })));
      },
      error: () => {
        this.rutas.set([]);
        this.loadError.set('No se pudieron cargar las rutas disponibles.');
        this.rutasLoaded = true;
        this.markInitialLoadDone();
      },
      complete: () => {
        this.rutasLoaded = true;
        this.markInitialLoadDone();
      }
    });
  }

  parseCoordenadas(val: string): { lat: number; lng: number } | null {
    const parts = String(val || '').trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 2) return null;
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  }

  private coordenadasValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const val = String(control.value || '').trim();
      if (!val) return null;
      const parsed = this.parseCoordenadas(val);
      if (!parsed) return { coordenadasInvalidas: true };
      if (parsed.lat < -90 || parsed.lat > 90) return { latitudInvalida: true };
      if (parsed.lng < -180 || parsed.lng > 180) return { longitudInvalida: true };
      return null;
    };
  }

  private loadTours(): void {
    this.isLoading.set(true);
    this.reservasSvc.getTours().subscribe({
      next: t => this.tours.set(t || []),
      error: () => {
        this.tours.set([]);
        this.toursLoaded = true;
        this.loadError.set('No se pudieron cargar los tours y sus horarios.');
        this.markInitialLoadDone();
      },
      complete: () => {
        this.toursLoaded = true;
        this.markInitialLoadDone();
      }
    });
  }

  private loadPunto(id: number) {
    this.isLoading.set(true);
    this.puntos.getPunto(id).subscribe({
      next: (p: Punto) => {
        const rutaActual = String(p.ruta || 'PENDIENTE');
        this.rutaOriginal = rutaActual;
        this.posicionOriginal = Number(p.posicion || p.Posicion || 0);
        this.esPuntoProtegido.set(Boolean((p as any).EsProtegido));
        this.form.patchValue({
          NombrePunto: p.NombrePunto || p.Nombre_Punto || '',
          Sector: p.Sector || '',
          Direccion: p.Direccion || '',
          Coordenadas: this.formatCoordenadas(p.Latitud, p.Longitud),
          routeMode: rutaActual.toUpperCase() === 'PENDIENTE' ? 'pending' : 'existing',
          rutaExistente: rutaActual.toUpperCase() === 'PENDIENTE' ? '' : rutaActual,
          rutaNueva: '',
          IdPuntoAnterior: null
        });
        if (rutaActual.toUpperCase() !== 'PENDIENTE') {
          this.loadPuntosRuta(rutaActual, true);
        }
        // Cargar horarios si vienen del backend
        if ((p as any).horarios && Array.isArray((p as any).horarios)) {
          for (const h of (p as any).horarios) {
            if (h?.Id_Tour != null) this.horariosMap[h.Id_Tour] = h.HoraSalida || h.Hora_Salida || '';
          }
        }
        this.puntoLoaded = true;
        this.markInitialLoadDone();
      },
      error: () => {
        this.loadError.set('No se pudo cargar la información del punto.');
        this.puntoLoaded = true;
        this.markInitialLoadDone();
      },
      complete: () => {
        this.puntoLoaded = true;
        this.markInitialLoadDone();
      }
    });
  }

  private markInitialLoadDone(): void {
    if (this.toursLoaded && this.rutasLoaded && this.puntoLoaded) {
      this.isLoading.set(false);
    }
  }

  onRouteModeChange(): void {
    if (this.esPuntoProtegido()) return;
    this.routePointsRequest?.unsubscribe();
    this.reubicar = true;
    this.puntosRuta.set([]);
    this.form.patchValue({ IdPuntoAnterior: null });
    if (this.form.value.routeMode === 'existing' && this.form.value.rutaExistente) {
      this.loadPuntosRuta(this.form.value.rutaExistente, false);
    }
  }

  onRutaExistenteChange(ruta: string): void {
    if (this.esPuntoProtegido()) return;
    this.reubicar = true;
    this.form.patchValue({ rutaExistente: ruta, IdPuntoAnterior: null });
    this.loadPuntosRuta(ruta, false);
  }

  onPosicionChange(): void {
    if (!this.esPuntoProtegido()) this.reubicar = true;
  }

  private loadPuntosRuta(ruta: string, seleccionarPosicionActual: boolean): void {
    this.routePointsRequest?.unsubscribe();
    if (!ruta) return this.puntosRuta.set([]);
    this.routePointsRequest = this.puntos.getPuntosPorRuta(ruta).subscribe({
      next: puntos => {
        const lista = (puntos || []).filter(
          punto => Number(punto?.Id_Punto || punto?.IdPunto) !== Number(this.puntoId)
        );
        this.puntosRuta.set(lista);
        if (seleccionarPosicionActual && ruta === this.rutaOriginal) {
          const anterior = lista
            .filter(punto => Number(punto?.posicion || punto?.Posicion || 0) < this.posicionOriginal)
            .sort((a, b) => Number(b?.posicion || b?.Posicion || 0) - Number(a?.posicion || a?.Posicion || 0))[0];
          this.form.patchValue({ IdPuntoAnterior: anterior?.Id_Punto || anterior?.IdPunto || null });
        }
      },
      error: () => this.puntosRuta.set([])
    });
  }

  private rutaSeleccionada(): string {
    if (this.esPuntoProtegido()) return '0';
    const mode = this.form.value.routeMode;
    if (mode === 'pending') return 'PENDIENTE';
    if (mode === 'new') return String(this.form.value.rutaNueva || '').trim();
    return String(this.form.value.rutaExistente || '').trim();
  }

  onCoordenadasInput(): void {
    if (this.coordinateStatus() === 'idle') return;
    this.coordinateStatus.set('idle');
    this.coordinateDetail.set('');
  }

  private descripcionPosicion(): string {
    if (!this.reubicar) return `Posición ${this.posicionOriginal}`;
    const raw = this.form.getRawValue();
    if (raw.routeMode === 'pending') return 'Al final de los puntos pendientes';
    if (raw.routeMode === 'new') return 'Posición 1';
    const anteriorId = Number(raw.IdPuntoAnterior || 0);
    if (!anteriorId) return `Al final de la ruta · Posición ${this.puntosRuta().length + 1}`;
    const anterior = this.puntosRuta().find(p => Number(p?.Id_Punto || p?.IdPunto) === anteriorId);
    const nombre = String(anterior?.NombrePunto || anterior?.Nombre_Punto || 'punto seleccionado');
    const index = this.puntosRuta().findIndex(
      p => Number(p?.Id_Punto || p?.IdPunto) === anteriorId
    );
    return `Después de ${nombre}${index >= 0 ? ` · Posición ${index + 2}` : ''}`;
  }

async onSubmitGuardarCambios() {
  if (this.isSubmitting() || this.coordinateStatus() === 'checking') return;

  // ===== Validación del formulario ANTES de confirmar =====
  this.form.updateValueAndValidity({ emitEvent: false });

  if (this.form.invalid) {
    this.form.markAllAsTouched();
    const invalid = Object.keys(this.form.controls).filter(k => this.form.get(k)?.invalid);
    const friendly: Record<string,string> = {
      NombrePunto: 'Nombre del punto',
      Sector: 'Sector',
      Direccion: 'Dirección',
      Coordenadas: 'Coordenadas (lat, lng)'
    };
    const fields = invalid.map(f => friendly[f] || f);
    const msg = fields.length ? `Revisa los siguientes campos: ${fields.join(', ')}` : 'Hay campos inválidos en el formulario.';

    this.alerts.showAlert({
      type: 'error',
      title: 'Campos requeridos incompletos',
      message: msg,
      autoClose: true,
      buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.alerts.closeModal() }]
    });
    return;
  }

  if (!this.puntoId) return;
  if (this.similarityState === 'exact') {
    this.alerts.warningToast('Punto duplicado', 'Ya existe un punto con ese nombre y esa dirección');
    return;
  }
  if (!this.rutaSeleccionada()) {
    this.alerts.warningToast('Ruta requerida', 'Selecciona una ruta, déjala pendiente o escribe una nueva.');
    return;
  }

  const coords = this.parseCoordenadas(this.form.value.Coordenadas || '');
  if (!coords) return;
  if (this.coordinateStatus() !== 'valid') {
    this.coordinateStatus.set('checking');
    this.coordinateDetail.set('Validando conexión con la red vial…');
    try {
      const result = await firstValueFrom(this.puntos.validarCoordenadas(coords.lat, coords.lng));
      this.coordinateStatus.set('valid');
      this.coordinateDetail.set(`Ubicación operativa · vía a ${result.distanciaViaMetros} m`);
    } catch (error: any) {
      this.coordinateStatus.set('invalid');
      this.coordinateDetail.set(error?.error?.message || 'OSRM no pudo conectar estas coordenadas con una vía.');
      this.alerts.errorToast('Coordenadas no operativas', this.coordinateDetail());
      return;
    }
  }

  const confirmed = this.similarityState === 'similar'
    ? await this.requestSimilarPointConfirmation()
    : await this.requestUpdatePointConfirmation();
  if (!confirmed) return;

  this.guardarCambiosConfirmado();
}

private guardarCambiosConfirmado() {
  if (this.isSubmitting()) return;
  if (!this.puntoId) return;
  if (this.form.invalid || this.similarityState === 'exact') return;

  this.isSubmitting.set(true);

  const raw = this.form.value;
  const coords = this.parseCoordenadas(raw.Coordenadas || '');

  const payload: any = {
    NombrePunto: raw.NombrePunto,
    Sector: raw.Sector,
    Direccion: raw.Direccion,
    Latitud: coords?.lat ?? null,
    Longitud: coords?.lng ?? null
  };
  payload.ruta = this.rutaSeleccionada();
  payload.reubicar = this.reubicar;
  payload.Id_Punto_Anterior = this.reubicar && raw.routeMode === 'existing'
    ? Number(raw.IdPuntoAnterior || 0) || null
    : null;
  payload.horarios = (this.tours() || []).map((t: any) => ({
    Id_Tour: t.Id_Tour,
    Hora_Salida: (this.horariosMap[t.Id_Tour] || '').trim() || 'Pendiente'
  }));
  this.puntos.updatePunto(this.puntoId, payload).pipe(
    finalize(() => this.isSubmitting.set(false))
  ).subscribe({
    next: () => {
      this.successMsg = 'Punto actualizado correctamente';
      this.alerts.successToast('Punto actualizado', this.successMsg);
      this.form.markAsPristine();
      this.router.navigate(
        ['/Puntos/VerPuntos'],
        { queryParamsHandling: 'preserve' }
      );
    },
    error: (err: any) => {
      this.errorMsg = err?.error?.message || 'Error al actualizar el punto';
      this.alerts.errorToast('Error', this.errorMsg);
    }
  });
}

private buildUpdatePointConfirmationMessage(): string {
  const nombrePunto = String(this.form.get('NombrePunto')?.value || '').trim() || 'el punto de encuentro';
  const sector = String(this.form.get('Sector')?.value || '').trim() || '—';
  const direccion = String(this.form.get('Direccion')?.value || '').trim() || '—';
  const cantidadTours = this.tours().length;
  const ruta = this.rutaSeleccionada();
  const posicion = this.descripcionPosicion();

  return [
    `Vas a guardar los cambios del punto de encuentro ${nombrePunto}.`,
    `Sector: ${sector}.`,
    `Dirección: ${direccion}.`,
    `Ruta: ${ruta}.`,
    `Ubicación en la ruta: ${posicion}.`,
    `Se mantendrán horarios para ${cantidadTours} tours.`,
    '¿Deseas continuar?'
  ].join(' ');
}

private requestUpdatePointConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    this.alerts.showModal({
      type: 'info',
      title: '¿Todo listo?',
      message: this.buildUpdatePointConfirmationMessage(),
      autoClose: false,
      buttons: [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => {
            this.alerts.closeModal();
            resolve(false);
          }
        },
        {
          text: 'Guardar cambios',
          style: 'primary',
          onClick: () => {
            this.alerts.closeModal();
            resolve(true);
          }
        }
      ]
    });
  });
}

private requestSimilarPointConfirmation(): Promise<boolean> {
  const pointName = this.duplicatePoint?.Nombre_Punto || this.duplicatePoint?.NombrePunto || 'otro punto';
  const pointAddress = this.duplicatePoint?.Direccion || 'sin dirección registrada';

  return new Promise((resolve) => {
    this.alerts.showModal({
      type: 'warning',
      title: 'Punto similar detectado',
      message: `Encontramos un punto parecido: ${pointName} (${pointAddress}). Puedes guardar si confirmas que sí es un punto diferente.`,
      autoClose: false,
      buttons: [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => {
            this.alerts.closeModal();
            resolve(false);
          }
        },
        {
          text: 'Guardar de todas formas',
          style: 'primary',
          onClick: () => {
            this.alerts.closeModal();
            resolve(true);
          }
        }
      ]
    });
  });
}


  onDireccionInput(v: string) {
    if (this.addrTimer) clearTimeout(this.addrTimer);
    const term = (v || '').trim();
    const ctrl = this.form.get('Direccion');
    if (!term) {
      this.clearSimilarity(ctrl);
      return;
    }

    this.addrTimer = setTimeout(() => {
      this.addressRequest?.unsubscribe();
      this.addressRequest = this.puntos.buscarPuntosPorDireccion(term).subscribe({
        next: (res: any[]) => {
          const currentName = String(this.form.get('NombrePunto')?.value || '').trim();
          const normalizedAddress = this.normalizeComparable(term);
          const normalizedName = this.normalizeComparable(currentName);

          if (!Array.isArray(res) || !res.length) {
            this.clearSimilarity(ctrl);
            return;
          }

          let bestMatch: any = null;
          let bestScore = 0;

          for (const point of res) {
            if (Number(point?.Id_Punto) === Number(this.puntoId)) continue;

            const pointAddress = this.normalizeComparable(point?.Direccion || '');
            const pointName = this.normalizeComparable(point?.Nombre_Punto || point?.NombrePunto || '');

            if (pointAddress && pointName && pointAddress === normalizedAddress && pointName === normalizedName) {
              this.setExactDuplicate(point, ctrl);
              return;
            }

            const addressScore = this.jaroWinkler(normalizedAddress, pointAddress);
            const nameScore = normalizedName ? this.jaroWinkler(normalizedName, pointName) : 0;
            const combinedScore = normalizedName
              ? ((addressScore * 0.75) + (nameScore * 0.25))
              : addressScore;
            const isSimilar = addressScore >= ADDRESS_SIMILARITY_THRESHOLD
              || (addressScore >= ADDRESS_NAME_SIMILARITY_THRESHOLD && nameScore >= NAME_SIMILARITY_THRESHOLD);

            if (isSimilar && combinedScore > bestScore) {
              bestScore = combinedScore;
              bestMatch = point;
            }
          }

          if (bestMatch) this.setSimilarPoint(bestMatch, ctrl);
          else this.clearSimilarity(ctrl);
        },
        error: () => this.clearSimilarity(ctrl)
      });
    }, 450);
  }

  onNombrePuntoInput() {
    const direccion = String(this.form.get('Direccion')?.value || '').trim();
    if (!direccion) return;
    this.onDireccionInput(direccion);
  }

  hasUnsavedChanges(): boolean {
    return this.form?.dirty && !this.isSubmitting();
  }

  private setExactDuplicate(point: any, ctrl: any) {
    this.similarityState = 'exact';
    this.duplicatePoint = point;
    this.mergeControlError(ctrl, 'duplicate', true);
    this.alerts.warningToast(
      'Punto duplicado',
      `${point?.Nombre_Punto || point?.NombrePunto || 'Punto'} - ${point?.Direccion || ''}`
    );
  }

  private setSimilarPoint(point: any, ctrl: any) {
    this.similarityState = 'similar';
    this.duplicatePoint = point;
    this.mergeControlError(ctrl, 'duplicate', false);
  }

  private clearSimilarity(ctrl: any) {
    this.similarityState = 'none';
    this.duplicatePoint = null;
    this.mergeControlError(ctrl, 'duplicate', false);
  }

  private mergeControlError(ctrl: any, key: string, enabled: boolean) {
    if (!ctrl) return;
    const currentErrors = { ...(ctrl.errors || {}) };
    if (enabled) currentErrors[key] = true;
    else delete currentErrors[key];
    ctrl.setErrors(Object.keys(currentErrors).length ? currentErrors : null);
  }

  private normalizeComparable(s: string) {
    if (!s) return '';
    return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private jaroWinkler(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;

    const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
    const aMatches = new Array(a.length).fill(false);
    const bMatches = new Array(b.length).fill(false);
    let matches = 0;

    for (let i = 0; i < a.length; i++) {
      const start = Math.max(0, i - matchDistance);
      const end = Math.min(i + matchDistance + 1, b.length);
      for (let j = start; j < end; j++) {
        if (bMatches[j] || a[i] !== b[j]) continue;
        aMatches[i] = true;
        bMatches[j] = true;
        matches++;
        break;
      }
    }

    if (!matches) return 0;

    let transpositions = 0;
    let k = 0;
    for (let i = 0; i < a.length; i++) {
      if (!aMatches[i]) continue;
      while (!bMatches[k]) k++;
      if (a[i] !== b[k]) transpositions++;
      k++;
    }

    const jaro = (
      (matches / a.length)
      + (matches / b.length)
      + ((matches - transpositions / 2) / matches)
    ) / 3;

    let prefix = 0;
    for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
      if (a[i] !== b[i]) break;
      prefix++;
    }

    return jaro + (prefix * 0.1 * (1 - jaro));
  }

  private formatCoordenadas(latitud: unknown, longitud: unknown): string {
    const lat = latitud != null && latitud !== '' ? Number(latitud) : null;
    const lng = longitud != null && longitud !== '' ? Number(longitud) : null;
    if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return '';
    return `${lat}, ${lng}`;
  }
}
