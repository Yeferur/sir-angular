import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators
} from '@angular/forms';
import { Router } from '@angular/router';
import { puntosService } from '../../../services/Puntos/puntos';
import { Reservas } from '../../../services/Reservas/reservas';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { finalize, firstValueFrom, forkJoin, Subscription } from 'rxjs';

const ADDRESS_SIMILARITY_THRESHOLD = 0.88;
const ADDRESS_NAME_SIMILARITY_THRESHOLD = 0.82;
const NAME_SIMILARITY_THRESHOLD = 0.75;

@Component({
  selector: 'app-crear-punto',
  templateUrl: './crear-punto.html',
  styleUrls: ['./crear-punto.css'],
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, CommonModule, LoadingStateComponent]
})
export class CrearPuntoComponent implements OnInit, OnDestroy {
  isLoading = signal<boolean>(true);
  loadError = signal('');
  isSubmitting = signal<boolean>(false);

  form!: FormGroup;
  tours = signal<any[]>([]);
  rutas = signal<string[]>([]);
  puntosRuta = signal<any[]>([]);
  coordinateStatus = signal<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  coordinateDetail = signal('');
  horariosMap: Record<number | string, string> = {};
  similarityState: 'none' | 'similar' | 'exact' = 'none';
  duplicatePoint: any = null;
  private addrTimer: any = null;
  private initialDataRequest?: Subscription;
  private routePointsRequest?: Subscription;
  private addressRequest?: Subscription;

  constructor(
    private fb: FormBuilder,
    private puntos: puntosService,
    private router: Router,
    private reservasSvc: Reservas,
    private alerts: SirAlertService
  ) {
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

  ngOnInit(): void {
    this.loadInitialData();
  }

  ngOnDestroy(): void {
    if (this.addrTimer) clearTimeout(this.addrTimer);
    this.initialDataRequest?.unsubscribe();
    this.routePointsRequest?.unsubscribe();
    this.addressRequest?.unsubscribe();
  }

  // ── Coordenadas ──────────────────────────────────────────────────────────────

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
      if (!val) return null; // opcional
      const parsed = this.parseCoordenadas(val);
      if (!parsed) return { coordenadasInvalidas: true };
      if (parsed.lat < -90 || parsed.lat > 90) return { latitudInvalida: true };
      if (parsed.lng < -180 || parsed.lng > 180) return { longitudInvalida: true };
      return null;
    };
  }
  // ── Carga inicial ────────────────────────────────────────────────────────────

  loadInitialData(): void {
    this.initialDataRequest?.unsubscribe();
    this.isLoading.set(true);
    this.loadError.set('');
    this.initialDataRequest = forkJoin({
      tours: this.reservasSvc.getTours(),
      rutas: this.puntos.getRutasPuntos()
    }).pipe(finalize(() => this.isLoading.set(false))).subscribe({
      next: ({ tours, rutas }) => {
        this.tours.set(tours || []);
        const activas = (rutas || [])
          .filter(r => String(r).toUpperCase() !== 'PENDIENTE')
          .sort((a, b) => String(a).localeCompare(String(b), 'es', {
            numeric: true,
            sensitivity: 'base'
          }));
        this.rutas.set(activas);
        if (activas.length) {
          this.form.patchValue({ rutaExistente: activas[0] });
          this.onRutaExistenteChange(activas[0]);
        } else {
          this.form.patchValue({ routeMode: 'pending' });
        }
      },
      error: () => {
        this.tours.set([]);
        this.rutas.set([]);
        this.loadError.set('No se pudieron cargar los tours y las rutas disponibles.');
      }
    });
  }

  onRouteModeChange(): void {
    this.routePointsRequest?.unsubscribe();
    this.puntosRuta.set([]);
    this.form.patchValue({ IdPuntoAnterior: null });
    if (this.form.value.routeMode === 'existing' && this.form.value.rutaExistente) {
      this.onRutaExistenteChange(this.form.value.rutaExistente);
    }
  }

  onRutaExistenteChange(ruta: string): void {
    this.routePointsRequest?.unsubscribe();
    this.form.patchValue({ rutaExistente: ruta, IdPuntoAnterior: null });
    if (!ruta) return this.puntosRuta.set([]);
    this.routePointsRequest = this.puntos.getPuntosPorRuta(ruta).subscribe({
      next: puntos => this.puntosRuta.set(puntos || []),
      error: () => this.puntosRuta.set([])
    });
  }

  private rutaSeleccionada(): string {
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
    const raw = this.form.getRawValue();
    if (raw.routeMode === 'pending') return 'Al final de los puntos pendientes';
    if (raw.routeMode === 'new') return 'Posición 1';

    const anteriorId = Number(raw.IdPuntoAnterior || 0);
    if (!anteriorId) {
      return `Al final de la ruta · Posición ${this.puntosRuta().length + 1}`;
    }

    const anterior = this.puntosRuta().find(
      punto => Number(punto?.Id_Punto || punto?.IdPunto) === anteriorId
    );
    const nombre = String(anterior?.NombrePunto || anterior?.Nombre_Punto || 'punto seleccionado');
    const posicionAnterior = Number(anterior?.posicion || anterior?.Posicion || 0);
    return posicionAnterior > 0
      ? `Después de ${nombre} · Posición ${posicionAnterior + 1}`
      : `Después de ${nombre}`;
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  async onSubmitCrearPunto() {
    if (this.isSubmitting() || this.coordinateStatus() === 'checking') return;

    this.form.updateValueAndValidity({ emitEvent: false });
    if (this.form.invalid) {
      this.form.markAllAsTouched();

      const friendly: Record<string, string> = {
        NombrePunto: 'Nombre del punto',
        Sector: 'Sector',
        Direccion: 'Dirección',
        Coordenadas: 'Coordenadas (lat, lng)',
      };
      const invalid = Object.keys(this.form.controls).filter(k => this.form.get(k)?.invalid);
      const fields = invalid.map(f => friendly[f] || f);
      const msg = fields.length
        ? `Revisa los siguientes campos: ${fields.join(', ')}`
        : 'Hay campos inválidos en el formulario.';

      this.alerts.showAlert({
        type: 'error',
        title: 'Campos requeridos incompletos',
        message: msg,
        autoClose: true,
        buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.alerts.closeModal() }]
      });
      return;
    }

    if (this.similarityState === 'exact') {
      this.alerts.warningToast('Punto duplicado', 'Ya existe un punto con ese nombre y esa dirección');
      return;
    }
    const ruta = this.rutaSeleccionada();
    if (!ruta) {
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
      : await this.requestCreatePointConfirmation();
    if (!confirmed) return;

    this.crearPuntoConfirmado();
  }

  private crearPuntoConfirmado() {
    if (this.isSubmitting()) return;
    if (this.form.invalid || this.similarityState === 'exact') return;

    this.isSubmitting.set(true);

    const raw = this.form.value;
    const coords = this.parseCoordenadas(raw.Coordenadas || '');

    const payload: any = {
      NombrePunto: raw.NombrePunto,
      Sector: raw.Sector,
      Direccion: raw.Direccion,
      Latitud: coords?.lat ?? null,
      Longitud: coords?.lng ?? null,
      ruta: this.rutaSeleccionada(),
      Id_Punto_Anterior: raw.routeMode === 'existing' ? Number(raw.IdPuntoAnterior || 0) || null : null,
      horarios: (this.tours() || []).map((t: any) => ({
        Id_Tour: t.Id_Tour,
        Hora_Salida: (this.horariosMap[t.Id_Tour] || '').trim() || 'Pendiente'
      }))
    };

    this.puntos.crearPunto(payload).pipe(
      finalize(() => this.isSubmitting.set(false))
    ).subscribe({
      next: () => {
        this.alerts.successToast('Punto creado', 'Punto creado correctamente');
        this.form.reset();
        this.form.markAsPristine();
        this.similarityState = 'none';
        this.duplicatePoint = null;
        this.router.navigate(['/Puntos/VerPuntos']);
      },
      error: (err: any) => {
        this.alerts.errorToast('Error', err?.error?.message || 'Error al crear el punto');
      }
    });
  }

  // ── Confirmaciones ───────────────────────────────────────────────────────────

  private buildCreatePointConfirmationMessage(): string {
    const nombrePunto = String(this.form.get('NombrePunto')?.value || '').trim() || 'el punto de encuentro';
    const sector = String(this.form.get('Sector')?.value || '').trim() || '—';
    const direccion = String(this.form.get('Direccion')?.value || '').trim() || '—';
    const cantidadTours = this.tours().length;
    const ruta = this.rutaSeleccionada();
    const posicion = this.descripcionPosicion();

    return [
      `Vas a crear el punto de encuentro ${nombrePunto}.`,
      `Sector: ${sector}.`,
      `Dirección: ${direccion}.`,
      `Ruta: ${ruta}.`,
      `Ubicación en la ruta: ${posicion}.`,
      `Se configurarán horarios para ${cantidadTours} tours.`,
      '¿Deseas continuar?'
    ].join(' ');
  }

  private requestCreatePointConfirmation(): Promise<boolean> {
    return new Promise((resolve) => {
      this.alerts.showModal({
        type: 'info',
        title: '¿Todo listo?',
        message: this.buildCreatePointConfirmationMessage(),
        autoClose: false,
        buttons: [
          {
            text: 'Cancelar',
            style: 'secondary',
            onClick: () => { this.alerts.closeModal(); resolve(false); }
          },
          {
            text: 'Guardar Punto',
            style: 'primary',
            onClick: () => { this.alerts.closeModal(); resolve(true); }
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
        message: `Encontramos un punto parecido: ${pointName} (${pointAddress}). Puedes crearlo si confirmas que sí es un punto diferente.`,
        autoClose: false,
        buttons: [
          {
            text: 'Cancelar',
            style: 'secondary',
            onClick: () => { this.alerts.closeModal(); resolve(false); }
          },
          {
            text: 'Crear de todas formas',
            style: 'primary',
            onClick: () => { this.alerts.closeModal(); resolve(true); }
          }
        ]
      });
    });
  }

  // ── Detección de duplicados ───────────────────────────────────────────────────

  onDireccionInput(v: string) {
    if (this.addrTimer) clearTimeout(this.addrTimer);
    const term = (v || '').trim();
    const ctrl = this.form.get('Direccion');
    if (!term) { this.clearSimilarity(ctrl); return; }

    this.addrTimer = setTimeout(() => {
      this.addressRequest?.unsubscribe();
      this.addressRequest = this.puntos.buscarPuntosPorDireccion(term).subscribe({
        next: (res: any[]) => {
          const currentName = String(this.form.get('NombrePunto')?.value || '').trim();
          const normalizedAddress = this.normalizeComparable(term);
          const normalizedName = this.normalizeComparable(currentName);

          if (!Array.isArray(res) || !res.length) { this.clearSimilarity(ctrl); return; }

          let bestMatch: any = null;
          let bestScore = 0;

          for (const point of res) {
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
    return s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
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

  tourName(id: number) {
    const t = this.tours().find((x: any) => Number(x.Id_Tour) === Number(id));
    return t ? (t.Nombre_Tour || t.NombreTour || `Tour ${id}`) : `Tour ${id}`;
  }
}
