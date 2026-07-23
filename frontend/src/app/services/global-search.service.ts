import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { PermisosService } from './Permisos/permisos.service';
import { SirAlertService } from './Alertas/alert.service';
import { UiStateService } from './ui-state.service';
import { SILENT_APP_ACTIVITY } from '../interceptors/app-activity.interceptor';

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

@Injectable({ providedIn: 'root' })
export class GlobalSearchService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly permisosService = inject(PermisosService);
  private readonly alerts = inject(SirAlertService);
  private readonly uiState = inject(UiStateService);
  private globalSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private globalSearchRequestId = 0;

  private readonly apiUrl = environment.apiUrl;

  readonly open = signal(false);
  readonly query = signal('');
  readonly results = signal<GlobalSearchResult[]>([]);
  readonly loading = signal(false);

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
    this.results.set([]);
    this.loading.set(false);
    this.globalSearchRequestId++;
    if (this.globalSearchDebounceTimer) {
      clearTimeout(this.globalSearchDebounceTimer);
      this.globalSearchDebounceTimer = null;
    }
  }

  searchGlobal(query: string): void {
    const safeQuery = String(query || '').trim();
    this.query.set(query ?? '');

    if (this.globalSearchDebounceTimer) {
      clearTimeout(this.globalSearchDebounceTimer);
      this.globalSearchDebounceTimer = null;
    }

    if (!safeQuery) {
      this.loading.set(false);
      this.results.set([]);
      return;
    }

    const requestId = ++this.globalSearchRequestId;
    const shouldQuery = this.canSearchQuery(safeQuery);
    this.loading.set(shouldQuery);

    if (!shouldQuery) {
      this.results.set([]);
      return;
    }

    this.globalSearchDebounceTimer = setTimeout(() => {
      const params = new HttpParams().set('q', safeQuery);
      const context = new HttpContext().set(SILENT_APP_ACTIVITY, true);
      this.http.get<GlobalSearchResponse>(`${this.apiUrl}/search/global`, { params, context }).subscribe({
        next: (response) => {
          if (requestId !== this.globalSearchRequestId) return;
          const rawResults = Array.isArray(response?.results) ? response.results : [];
          const results = rawResults.filter((item) => this.canShowByFrontendPermission(item.permission))
            .map((item) => ({
              ...item,
              actions: (item.actions || []).filter((action) => this.canShowByFrontendPermission(action.permission)),
            }));
          this.results.set(results);
          this.loading.set(false);
        },
        error: () => {
          if (requestId !== this.globalSearchRequestId) return;
          this.results.set([]);
          this.loading.set(false);
          this.alerts.warningToast('Búsqueda no disponible', 'No fue posible consultar el buscador global.');
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

  executeAction(target: GlobalSearchAction | GlobalSearchResult): void {
    const action = 'kind' in target ? target : this.getPrimaryAction(target);
    if (!action) return;
    if (action.permission && !this.permisosService.tienePermiso(action.permission)) return;

    const pendingReason = action.params?.pendingReason || '';

    if (action.kind === 'open-reserva') {
      if (action.entityId != null) {
        this.closeSearch();
        this.uiState.reservaId.set(String(action.entityId));
      }
      return;
    }

    if (action.kind === 'open-transfer') {
      if (action.entityId != null) {
        this.closeSearch();
        this.uiState.transferId.set(String(action.entityId));
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
