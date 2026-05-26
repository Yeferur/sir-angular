import { Injectable, WritableSignal, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Router } from '@angular/router';
import { PermisosService } from '../Permisos/permisos.service';

export interface DynamicPanelState {
  id: string;
  title?: string;
  component?: any;       // componente standalone a renderizar
  props?: Record<string, any>;
  data?: any;
  open: boolean;
}

export interface UiToast {
  id: string;
  type: 'success' | 'info' | 'error' | 'warning';
  title: string;
  message?: string;
  durationMs: number;
}

export interface LegacyAlertState {
  type?: 'success' | 'info' | 'error' | 'warning';
  title?: string;
  message?: string;
  buttons?: { text: string, style: string, onClick: () => void }[];
  loading?: boolean;
  autoClose?: boolean;
  autoCloseTime?: number;
}

export interface DynamicOverlayState extends LegacyAlertState {
  id: string;
  kind: 'loading' | 'alert' | 'confirm';
  priority: number;
  createdAt: number;
  dedupeKey: string;
  source?: string;
}

export interface DynamicBaseStateOptions {
  cupos?: boolean;
  reserva?: boolean;
  transfer?: boolean;
  puntos?: boolean;
  panel?: boolean;
  preview?: boolean;
  sugerencias?: boolean;
}

export interface GlobalSearchAction {
  label: string;
  kind: 'navigate' | 'open-reserva' | 'open-transfer' | 'filter' | 'dashboard' | 'aforo';
  route?: string;
  entityId?: string | number;
  permission?: string;
  params?: {
    queryParams?: Record<string, any>;
    pendingReason?: string;
  };
}

export interface GlobalSearchResult {
  id: string;
  type: 'reserva' | 'transfer' | 'tour' | 'punto' | 'usuario' | 'module' | 'action';
  title: string;
  subtitle?: string;
  badge?: string;
  route?: string;
  dynamicAction?: string;
  entityId?: string | number;
  permission?: string;
  actions?: GlobalSearchAction[];
}

interface GlobalSearchResponse {
  query: string;
  results: GlobalSearchResult[];
}

@Injectable({
  providedIn: 'root'
})
export class DynamicIslandGlobalService {
  private readonly OVERLAY_PRIORITIES = {
    confirm: 500,
    error: 400,
    warning: 300,
    loading: 200,
    success: 100,
    info: 100,
  } as const;
  private readonly MAX_QUEUE_LENGTH = 6;
  private overlaySequence = 0;
  private overlayQueue = signal<DynamicOverlayState[]>([]);
  private readonly router = inject(Router);
  private readonly permisosService = inject(PermisosService);
  private globalSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private globalSearchRequestId = 0;

  apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {
    this.alert = this.createAlertCompatSignal();
  }

  mode = signal<'login' | ''>('login');
  overlay = signal<DynamicOverlayState | null>(null);
  // Compatibilidad: los consumidores existentes pueden seguir usando alert.set(...)
  alert: WritableSignal<LegacyAlertState | null>;

  toasts = signal<UiToast[]>([]);

  needsRefresh = signal<string>('');

  puntos = signal<any>(null);

  Id_Reserva = signal<string>(null);
  // Id_Transfer para seleccionar transfer desde vistas
  Id_Transfer = signal<string>(null);

  cuposInfo = signal<any>(null);

  sugerencias = signal<any>(null);
  private seleccionSugerenciaSignal = signal<any | null>(null);
  seleccionSugerencia$ = this.seleccionSugerenciaSignal.asReadonly();

  confirmarSugerenciaDesdeNavbar(sugerencia: any) {
    this.seleccionSugerenciaSignal.set(sugerencia);
    this.sugerencias.set(null);
  }

  private CombinacionManualSignal = signal<any | null>(null);
  CombinacionManual$ = this.CombinacionManualSignal.asReadonly();

  generarCombincionManual(manual : any) {
    this.CombinacionManualSignal.set(manual);
  }

   // ✅ Método para obtener la mejor ruta desde el backend
  obtenerRutaOptima(puntos: { lat: number, lng: number }[]): Observable<any> {
    console.log(puntos);
    return this.http.post<any>(`${this.apiUrl}/ruta-optima`, { puntos });
  }




  panel = signal<DynamicPanelState | null>(null);
  globalSearchOpen = signal(false);
  globalSearchQuery = signal('');
  globalSearchResults = signal<GlobalSearchResult[]>([]);
  globalSearchLoading = signal(false);

  // Simple preview (comprobante u otros recursos) to show inside the Dynamic Island
  previewUrl = signal<string | null>(null);
  previewTitle = signal<string | null>(null);

  private canSearchQuery(query: string): boolean {
    const safe = String(query || '').trim();
    if (!safe) return false;
    if (/^\d+$/.test(safe)) return true;
    if (!safe.includes(' ') && /^(?=.*\d)[A-Za-z0-9-]{2,}$/.test(safe)) return true;
    return safe.length >= 2;
  }

  private shouldHonorFrontendPermissionFilter(): boolean {
    return this.permisosService.isReady() || this.permisosService.getPermisosSnapshot().length > 0;
  }

  private canShowByFrontendPermission(permission?: string): boolean {
    if (!permission) return true;
    if (!this.shouldHonorFrontendPermissionFilter()) return true;
    return this.permisosService.tienePermiso(permission);
  }

  openGlobalSearch(): void {
    this.globalSearchOpen.set(true);
  }

  closeGlobalSearch(): void {
    this.globalSearchOpen.set(false);
    this.globalSearchQuery.set('');
    this.globalSearchResults.set([]);
    this.globalSearchLoading.set(false);
    this.globalSearchRequestId++;
    if (this.globalSearchDebounceTimer) {
      clearTimeout(this.globalSearchDebounceTimer);
      this.globalSearchDebounceTimer = null;
    }
  }

  searchGlobal(query: string): void {
    const safeQuery = String(query || '').trim();
    this.globalSearchQuery.set(query ?? '');

    if (this.globalSearchDebounceTimer) {
      clearTimeout(this.globalSearchDebounceTimer);
      this.globalSearchDebounceTimer = null;
    }

    if (!safeQuery) {
      this.globalSearchLoading.set(false);
      this.globalSearchResults.set([]);
      return;
    }

    const requestId = ++this.globalSearchRequestId;
    const shouldQuery = this.canSearchQuery(safeQuery);
    this.globalSearchLoading.set(shouldQuery);

    if (!shouldQuery) {
      this.globalSearchResults.set([]);
      return;
    }

    this.globalSearchDebounceTimer = setTimeout(() => {
      const params = new HttpParams().set('q', safeQuery);
      this.http.get<GlobalSearchResponse>(`${this.apiUrl}/search/global`, { params }).subscribe({
        next: (response) => {
          if (requestId !== this.globalSearchRequestId) return;
          const rawResults = Array.isArray(response?.results) ? response.results : [];
          const results = rawResults.filter((item) => {
            return this.canShowByFrontendPermission(item.permission);
          }).map((item) => ({
            ...item,
            actions: (item.actions || []).filter((action) => {
              return this.canShowByFrontendPermission(action.permission);
            }),
          }));
          this.globalSearchResults.set(results);
          this.globalSearchLoading.set(false);
        },
        error: () => {
          if (requestId !== this.globalSearchRequestId) return;
          this.globalSearchResults.set([]);
          this.globalSearchLoading.set(false);
          this.warningToast('Búsqueda no disponible', 'No fue posible consultar el buscador global.');
        },
      });
    }, 300);
  }

  private getPrimaryAction(result: GlobalSearchResult): GlobalSearchAction | null {
    if (Array.isArray(result.actions) && result.actions.length > 0) {
      return result.actions[0];
    }

    if (result.route) {
      return {
        label: 'Abrir',
        kind: 'navigate',
        route: result.route,
        entityId: result.entityId,
        permission: result.permission,
      };
    }

    if (result.type === 'reserva' && result.entityId != null) {
      return {
        label: 'Ver detalle',
        kind: 'open-reserva',
        entityId: result.entityId,
        permission: result.permission,
      };
    }

    if (result.type === 'transfer' && result.entityId != null) {
      return {
        label: 'Ver detalle',
        kind: 'open-transfer',
        entityId: result.entityId,
        permission: result.permission,
      };
    }

    return null;
  }

  executeSearchAction(target: GlobalSearchAction | GlobalSearchResult): void {
    const action = 'kind' in target ? target : this.getPrimaryAction(target);
    if (!action) return;
    if (action.permission && !this.permisosService.tienePermiso(action.permission)) return;

    const pendingReason = action.params?.pendingReason || '';

    if (action.kind === 'open-reserva') {
      if (action.entityId != null) {
        this.closeGlobalSearch();
        this.Id_Reserva.set(String(action.entityId));
      }
      return;
    }

    if (action.kind === 'open-transfer') {
      if (action.entityId != null) {
        this.closeGlobalSearch();
        this.Id_Transfer.set(String(action.entityId));
      }
      return;
    }

    if (action.route) {
      this.closeGlobalSearch();
      const queryParams = action.params?.queryParams || null;
      const shouldAppendQuery = !!queryParams && !pendingReason;

      if (shouldAppendQuery) {
        const searchParams = new URLSearchParams();
        Object.entries(queryParams).forEach(([key, value]) => {
          if (value === undefined || value === null || value === '') return;
          if (Array.isArray(value)) {
            value.forEach((entry) => searchParams.append(key, String(entry)));
            return;
          }
          searchParams.set(key, String(value));
        });
        const serialized = searchParams.toString();
        const targetUrl = serialized ? `${action.route}?${serialized}` : action.route;
        this.router.navigateByUrl(targetUrl).catch((): void => undefined);
      } else {
        this.router.navigateByUrl(action.route).catch((): void => undefined);
      }

      if (pendingReason) {
        this.infoToast('Filtro pendiente', pendingReason, 4500);
      }
    }
  }

  private normalizeOverlayState(
    state: LegacyAlertState & Partial<Pick<DynamicOverlayState, 'kind' | 'source'>>
  ): DynamicOverlayState {
    const buttons = Array.isArray(state.buttons) ? state.buttons : [];
    const inferredKind =
      state.kind
      ?? (state.loading ? 'loading' : buttons.length > 1 ? 'confirm' : 'alert');
    const normalizedType =
      state.type === 'success'
      || state.type === 'info'
      || state.type === 'error'
      || state.type === 'warning'
        ? state.type
        : inferredKind === 'confirm'
          ? 'warning'
          : 'info';
    const createdAt = Date.now();
    const priority = this.getOverlayPriority(inferredKind, normalizedType);

    return {
      ...state,
      id: `overlay-${++this.overlaySequence}`,
      kind: inferredKind,
      type: normalizedType,
      buttons,
      priority,
      createdAt,
      dedupeKey: this.buildOverlayDedupeKey({
        ...state,
        kind: inferredKind,
        type: normalizedType,
      }),
    };
  }

  private createAlertCompatSignal(): WritableSignal<LegacyAlertState | null> {
    const compat = ((() => this.overlay()) as unknown) as WritableSignal<LegacyAlertState | null>;
    compat.set = (value: LegacyAlertState | null) => {
      if (value == null) {
        this.clearOverlay();
        return;
      }
      this.showOverlay(value);
    };
    compat.update = (updater: (value: LegacyAlertState | null) => LegacyAlertState | null) => {
      compat.set(updater(compat()));
    };
    compat.asReadonly = () => this.overlay.asReadonly() as any;
    return compat;
  }

  private getOverlayPriority(
    kind: DynamicOverlayState['kind'],
    type: NonNullable<DynamicOverlayState['type']>
  ): number {
    if (kind === 'confirm') return this.OVERLAY_PRIORITIES.confirm;
    if (kind === 'loading') return this.OVERLAY_PRIORITIES.loading;
    if (type === 'error') return this.OVERLAY_PRIORITIES.error;
    if (type === 'warning') return this.OVERLAY_PRIORITIES.warning;
    if (type === 'success') return this.OVERLAY_PRIORITIES.success;
    return this.OVERLAY_PRIORITIES.info;
  }

  private buildOverlayDedupeKey(
    state: Pick<DynamicOverlayState, 'kind' | 'type' | 'title' | 'message' | 'loading' | 'source'>
  ): string {
    return JSON.stringify({
      kind: state.kind,
      type: state.type || 'info',
      title: state.title || '',
      message: state.message || '',
      loading: !!state.loading,
      source: state.source || '',
    });
  }

  private isSameOverlay(
    a: Pick<DynamicOverlayState, 'dedupeKey'> | null | undefined,
    b: Pick<DynamicOverlayState, 'dedupeKey'> | null | undefined
  ): boolean {
    return !!a && !!b && a.dedupeKey === b.dedupeKey;
  }

  private isNavigationLoading(overlay: DynamicOverlayState): boolean {
    return overlay.kind === 'loading' && overlay.source === 'navigation';
  }

  private shouldReplaceCurrentOverlay(current: DynamicOverlayState, next: DynamicOverlayState): boolean {
    if (current.kind === 'confirm') return false;
    if (next.kind === 'confirm') return true;
    if (current.kind === 'loading' && next.priority > current.priority) return true;
    if (next.kind === 'loading') {
      return current.kind === 'loading';
    }
    return next.priority > current.priority;
  }

  private enqueueOverlay(overlay: DynamicOverlayState): void {
    this.overlayQueue.update((queue) => {
      if (queue.some((item) => this.isSameOverlay(item, overlay))) {
        return queue;
      }

      const nextQueue = [...queue, overlay]
        .sort((a, b) => (b.priority - a.priority) || (a.createdAt - b.createdAt));

      if (nextQueue.length <= this.MAX_QUEUE_LENGTH) {
        return nextQueue;
      }

      const overflow = nextQueue.length - this.MAX_QUEUE_LENGTH;
      const trimmed = [...nextQueue];
      let removed = 0;

      for (let i = trimmed.length - 1; i >= 0 && removed < overflow; i--) {
        if (trimmed[i].priority <= this.OVERLAY_PRIORITIES.info) {
          trimmed.splice(i, 1);
          removed++;
        }
      }

      while (trimmed.length > this.MAX_QUEUE_LENGTH) {
        trimmed.pop();
      }

      return trimmed;
    });
  }

  private dequeueNextOverlay(): DynamicOverlayState | null {
    const queue = this.overlayQueue();
    if (!queue.length) return null;
    const [next, ...rest] = queue;
    this.overlayQueue.set(rest);
    return next;
  }

  private showNextOverlay(): void {
    if (this.overlay()) return;
    const next = this.dequeueNextOverlay();
    if (next) {
      this.overlay.set(next);
    }
  }

  private clearOverlayQueue(): void {
    this.overlayQueue.set([]);
  }

  showOverlay(
    state: LegacyAlertState & Partial<Pick<DynamicOverlayState, 'kind' | 'source'>>
  ): void {
    const next = this.normalizeOverlayState(state);
    const current = this.overlay();

    if (current && this.isSameOverlay(current, next)) {
      if (current.kind === 'loading' && next.kind === 'loading') {
        this.overlay.set(next);
      }
      return;
    }

    if (!current) {
      this.overlay.set(next);
      return;
    }

    if (current.kind === 'confirm') {
      if (next.kind === 'loading') {
        return;
      }
      this.enqueueOverlay(next);
      return;
    }

    if (next.kind === 'loading' && !this.shouldReplaceCurrentOverlay(current, next)) {
      return;
    }

    if (this.shouldReplaceCurrentOverlay(current, next)) {
      this.overlay.set(next);
      return;
    }

    this.enqueueOverlay(next);
  }

  clearOverlay(expectedKind?: DynamicOverlayState['kind']): void {
    const current = this.overlay();
    if (!current) return;
    if (expectedKind && current.kind !== expectedKind) return;
    this.overlay.set(null);
    this.showNextOverlay();
  }

  showLoading(
    title = 'Cargando datos...',
    message = '',
    options?: Omit<LegacyAlertState, 'title' | 'message' | 'loading'> & { source?: string }
  ): void {
    this.showOverlay({
      ...options,
      kind: 'loading',
      loading: true,
      title,
      message,
      autoClose: false,
    });
  }

  showAlert(
    state: LegacyAlertState & { source?: string }
  ): void {
    this.showOverlay({
      ...state,
      kind: state.buttons?.length && state.buttons.length > 1 ? 'confirm' : 'alert',
    });
  }

  showConfirm(
    title: string,
    message: string,
    buttons: { text: string, style: string, onClick: () => void }[],
    options?: Omit<LegacyAlertState, 'title' | 'message' | 'buttons'> & { source?: string }
  ): void {
    this.showOverlay({
      ...options,
      kind: 'confirm',
      title,
      message,
      buttons,
      autoClose: false,
    });
  }

  openPreview(url: string, title?: string) {
    this.previewUrl.set(url);
    this.previewTitle.set(title || 'Preview');
  }

  closePreview() {
    this.previewUrl.set(null);
    this.previewTitle.set(null);
  }

  openPanel(state: Omit<DynamicPanelState, 'open'>) {
    this.panel.set({ ...state, open: true });
  }

  openAppUpdates() {
    this.panel.set({ open: true, id: 'app-updates', data: null });
  }

  closePanel() {
 this.panel.set(null);
  }

  clearBaseState(options: DynamicBaseStateOptions = {}): void {
    const {
      cupos = true,
      reserva = true,
      transfer = true,
      puntos = true,
      panel = false,
      preview = false,
      sugerencias = false,
    } = options;

    if (cupos) this.cuposInfo.set(null);
    if (reserva) this.Id_Reserva.set(null);
    if (transfer) this.Id_Transfer.set(null);
    if (puntos) this.puntos.set(null);
    if (panel) this.closePanel();
    if (preview) this.closePreview();
    if (sugerencias) this.sugerencias.set(null);
  }

  resetSessionUi(): void {
    this.clearOverlayQueue();
    this.overlay.set(null);
    this.clearBaseState({
      cupos: true,
      reserva: true,
      transfer: true,
      puntos: true,
      panel: true,
      preview: true,
      sugerencias: true,
    });
    this.mode.set('login');
  }

  togglePanel(state: Omit<DynamicPanelState, 'open'>) {
    const p = this.panel();
    if (!p || !p.open || p.id !== state.id) {
      this.openPanel(state);
    } else {
      this.closePanel();
    }
  }

  showToast(toast: Omit<UiToast, 'id'>): string {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const safeDuration = Math.max(1000, Number(toast.durationMs || 3500));
    const nextToast: UiToast = { ...toast, id, durationMs: safeDuration };
    this.toasts.update((list) => [...list, nextToast]);
    setTimeout(() => this.dismissToast(id), safeDuration);
    return id;
  }

  dismissToast(id: string): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  successToast(title: string, message = '', durationMs = 3000): string {
    return this.showToast({ type: 'success', title, message, durationMs });
  }

  infoToast(title: string, message = '', durationMs = 3000): string {
    return this.showToast({ type: 'info', title, message, durationMs });
  }

  warningToast(title: string, message = '', durationMs = 3500): string {
    return this.showToast({ type: 'warning', title, message, durationMs });
  }

  errorToast(title: string, message = '', durationMs = 4500): string {
    return this.showToast({ type: 'error', title, message, durationMs });
  }
}
