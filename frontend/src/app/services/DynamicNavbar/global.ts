import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Router } from '@angular/router';
import { PermisosService } from '../Permisos/permisos.service';
import { SirDrawerService } from '../Drawer/drawer.service';
import { SirAlertService } from '../Alertas/alert.service';

export interface DynamicBaseStateOptions {
  cupos?: boolean;
  reserva?: boolean;
  transfer?: boolean;
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
export class globalservice {
  private readonly router = inject(Router);
  private readonly permisosService = inject(PermisosService);
  private readonly drawer = inject(SirDrawerService);
  private readonly alertService = inject(SirAlertService);
  private globalSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private globalSearchRequestId = 0;

  apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  needsRefresh = signal<string>('');

  Id_Reserva = signal<string>(null);
  // Id_Transfer para seleccionar transfer desde vistas
  Id_Transfer = signal<string>(null);

  cuposInfo = signal<any>(null);
  globalSearchOpen = signal(false);
  globalSearchQuery = signal('');
  globalSearchResults = signal<GlobalSearchResult[]>([]);
  globalSearchLoading = signal(false);

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
          this.alertService.warningToast('Búsqueda no disponible', 'No fue posible consultar el buscador global.');
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
        this.alertService.infoToast('Filtro pendiente', pendingReason, 4500);
      }
    }
  }

  openAppUpdates() {
    this.drawer.openAppUpdates();
  }

  closePanel() {
    this.drawer.close();
  }

  clearBaseState(options: DynamicBaseStateOptions = {}): void {
    const {
      cupos = true,
      reserva = true,
      transfer = true,
    } = options;

    if (cupos) this.cuposInfo.set(null);
    if (reserva) this.Id_Reserva.set(null);
    if (transfer) this.Id_Transfer.set(null);
  }

  resetSessionUi(): void {
    this.alertService.closeModal();
    this.clearBaseState({
      cupos: true,
      reserva: true,
      transfer: true,
    });
  }
}
