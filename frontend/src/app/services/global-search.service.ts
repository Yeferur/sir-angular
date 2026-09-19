import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { PermisosService } from './Permisos/permisos.service';
import { SirAlertService } from './Alertas/alert.service';
import { SirDrawerService } from './Drawer/drawer.service';
import { SILENT_APP_ACTIVITY } from '../interceptors/app-activity.interceptor';
import { Subscription } from 'rxjs';

export interface GlobalSearchAction {
  label: string;
  kind: 'navigate' | 'open-reserva' | 'open-transfer' | 'open-tour' | 'open-usuario' | 'filter' | 'dashboard' | 'aforo';
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
  type: 'reserva' | 'transfer' | 'tour' | 'punto' | 'servicio' | 'date' | 'usuario' | 'module' | 'action';
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

@Injectable({ providedIn: 'root' })
export class GlobalSearchService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly permisosService = inject(PermisosService);
  private readonly alerts = inject(SirAlertService);
  private readonly drawer = inject(SirDrawerService);
  private globalSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private globalSearchRequestId = 0;
  private globalSearchSubscription: Subscription | null = null;

  private readonly apiUrl = environment.apiUrl;

  readonly open = signal(false);
  readonly query = signal('');
  readonly submittedQuery = signal('');
  readonly results = signal<GlobalSearchResult[]>([]);
  readonly waiting = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  private cancelPendingSearch(): void {
    if (this.globalSearchDebounceTimer) {
      clearTimeout(this.globalSearchDebounceTimer);
      this.globalSearchDebounceTimer = null;
    }
    this.globalSearchSubscription?.unsubscribe();
    this.globalSearchSubscription = null;
  }

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

  openSearch(): void {
    this.open.set(true);
  }

  closeSearch(): void {
    this.open.set(false);
    this.query.set('');
    this.submittedQuery.set('');
    this.results.set([]);
    this.waiting.set(false);
    this.loading.set(false);
    this.error.set(null);
    this.globalSearchRequestId++;
    this.cancelPendingSearch();
  }

  updateQuery(query: string): void {
    const value = query ?? '';
    this.query.set(value);
    const safeQuery = value.trim();
    this.error.set(null);
    this.results.set([]);
    this.globalSearchRequestId++;
    const requestId = this.globalSearchRequestId;
    this.cancelPendingSearch();

    if (!safeQuery) {
      this.submittedQuery.set('');
      this.waiting.set(false);
      this.loading.set(false);
      return;
    }
    if (!this.canSearchQuery(safeQuery)) {
      this.submittedQuery.set('');
      this.waiting.set(false);
      this.loading.set(false);
      return;
    }

    this.waiting.set(true);
    this.loading.set(false);
    this.globalSearchDebounceTimer = setTimeout(() => {
      this.globalSearchDebounceTimer = null;
      this.submittedQuery.set(safeQuery);
      this.waiting.set(false);
      this.loading.set(true);
      this.runSearch(safeQuery, requestId);
    }, 300);
  }

  searchGlobal(query: string): void {
    const safeQuery = String(query || '').trim();
    this.query.set(query ?? '');
    this.error.set(null);
    this.results.set([]);
    this.globalSearchRequestId++;
    const requestId = this.globalSearchRequestId;
    this.cancelPendingSearch();

    if (!safeQuery) {
      this.submittedQuery.set('');
      this.waiting.set(false);
      this.loading.set(false);
      return;
    }
    if (!this.canSearchQuery(safeQuery)) {
      this.submittedQuery.set('');
      this.waiting.set(false);
      this.loading.set(false);
      return;
    }

    this.submittedQuery.set(safeQuery);
    this.waiting.set(false);
    this.loading.set(true);
    this.runSearch(safeQuery, requestId);
  }

  private runSearch(safeQuery: string, requestId: number): void {
    const params = new HttpParams().set('q', safeQuery);
    const context = new HttpContext().set(SILENT_APP_ACTIVITY, true);
    this.globalSearchSubscription = this.http.get<GlobalSearchResponse>(`${this.apiUrl}/search/global`, { params, context }).subscribe({
      next: (response) => {
        if (requestId !== this.globalSearchRequestId) return;
        const rawResults = Array.isArray(response?.results) ? response.results : [];
        const results = rawResults.filter((item) => this.canShowByFrontendPermission(item.permission))
          .map((item) => ({
            ...item,
            actions: (item.actions || []).filter((action) => this.canShowByFrontendPermission(action.permission)),
          }));
        this.results.set(results);
        this.error.set(null);
        this.waiting.set(false);
        this.loading.set(false);
        this.globalSearchSubscription = null;
      },
      error: () => {
        if (requestId !== this.globalSearchRequestId) return;
        this.results.set([]);
        this.waiting.set(false);
        this.loading.set(false);
        this.error.set('Comprueba la conexión e inténtalo de nuevo.');
        this.globalSearchSubscription = null;
        this.alerts.warningToast('Búsqueda no disponible', 'No fue posible consultar el buscador global.');
      },
    });
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

    if (result.type === 'tour' && result.entityId != null) {
      return {
        label: 'Ver tour',
        kind: 'open-tour',
        entityId: result.entityId,
        permission: result.permission,
      };
    }

    if (result.type === 'punto') {
      return {
        label: 'Ver punto',
        kind: 'filter',
        route: '/Puntos/VerPuntos',
        entityId: result.entityId,
        permission: result.permission,
        params: { queryParams: { q: result.title } },
      };
    }

    return null;
  }

  executeAction(target: GlobalSearchAction | GlobalSearchResult): void {
    const action = 'kind' in target ? target : this.getPrimaryAction(target);
    if (!action) return;
    if (action.permission && !this.permisosService.tienePermiso(action.permission)) return;

    const pendingReason = action.params?.pendingReason || '';

    if (action.kind === 'open-reserva') {
      if (action.entityId != null) {
        this.closeSearch();
        this.drawer.openReserva(String(action.entityId));
      }
      return;
    }

    if (action.kind === 'open-transfer') {
      if (action.entityId != null) {
        this.closeSearch();
        this.drawer.openTransfer(String(action.entityId));
      }
      return;
    }

    if (action.kind === 'open-tour') {
      if (action.entityId != null) {
        this.closeSearch();
        this.drawer.openTour(String(action.entityId));
      }
      return;
    }

    if (action.kind === 'open-usuario') {
      if (action.entityId != null) {
        this.closeSearch();
        this.drawer.openUsuario(String(action.entityId));
      }
      return;
    }

    if (!action.route) return;

    this.closeSearch();
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
      this.alerts.infoToast('Filtro pendiente', pendingReason, 4500);
    }
  }
}
