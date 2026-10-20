import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, InjectionToken, OnDestroy, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import releaseMetadata from '../../../../../release-metadata.json';
import { environment } from '../../../environments/environment';
import { SirAlertService } from '../Alertas/alert.service';
import { SirDrawerService } from '../Drawer/drawer.service';
import { SILENT_APP_ACTIVITY } from '../../interceptors/app-activity.interceptor';

export const LOADED_SIR_VERSION = new InjectionToken<string>('Loaded SIR version', {
  providedIn: 'root',
  factory: () => releaseMetadata.version,
});

export const SIR_RELOAD = new InjectionToken<() => void>('Reload SIR', {
  providedIn: 'root',
  factory: () => () => window.location.reload(),
});

export const VERSION_CHECK_INTERVAL_MS = 5 * 60_000;
const AVAILABLE_LEASE_MS = 2 * VERSION_CHECK_INTERVAL_MS;

@Injectable({ providedIn: 'root' })
export class AppVersionService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly alerts = inject(SirAlertService);
  private readonly drawer = inject(SirDrawerService);
  private readonly loadedVersion = inject(LOADED_SIR_VERSION);
  private readonly reload = inject(SIR_RELOAD);
  private readonly tabId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

  private userId: string | null = null;
  private serverVersion: string | null = null;
  private lastCheckedAt = 0;
  private inFlight: Promise<void> | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private availableToastId: string | null = null;
  private discoveryToastId: string | null = null;
  private generation = 0;
  private mayReload: () => Promise<boolean> = async () => true;

  private readonly onVisible = () => {
    if (document.visibilityState !== 'visible') {
      this.clearAvailable();
      return;
    }
    this.checkIfDue();
  };
  private readonly onFocus = () => this.checkIfDue();
  private readonly onBlur = () => this.clearAvailable();
  private readonly onStorage = (event: StorageEvent) => {
    if (this.userId && this.serverVersion && this.serverVersion !== this.loadedVersion
      && event.key === this.availableKey(this.userId, this.serverVersion)
      && !event.newValue && this.isActiveTab()) {
      void this.showAvailable(this.userId, this.serverVersion, this.generation);
    }
  };
  private readonly onPageHide = () => this.clearAvailable();

  start(userId: string | number, mayReload: () => Promise<boolean>): void {
    const nextUserId = String(userId);
    if (this.userId === nextUserId) {
      this.mayReload = mayReload;
      return;
    }
    this.stop();
    this.userId = nextUserId;
    this.mayReload = mayReload;
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('focus', this.onFocus);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('storage', this.onStorage);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onFocus);
    this.timer = setInterval(() => {
      if (this.availableToastId && this.userId && this.serverVersion) {
        this.renewAvailable(this.userId, this.serverVersion);
      }
      void this.check();
    }, VERSION_CHECK_INTERVAL_MS);
    void this.check();
  }

  stop(): void {
    this.generation++;
    this.releaseAvailable();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('focus', this.onFocus);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('storage', this.onStorage);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onFocus);
    if (this.availableToastId) this.alerts.dismissToast(this.availableToastId);
    if (this.discoveryToastId) this.alerts.dismissToast(this.discoveryToastId);
    this.availableToastId = null;
    this.discoveryToastId = null;
    this.userId = null;
    this.serverVersion = null;
    this.lastCheckedAt = 0;
    this.inFlight = null;
  }

  ngOnDestroy(): void {
    this.stop();
  }

  checkIfDue(): void {
    if (!this.userId) return;
    if (this.availableToastId && this.serverVersion) this.renewAvailable(this.userId, this.serverVersion);
    if (Date.now() - this.lastCheckedAt >= VERSION_CHECK_INTERVAL_MS) {
      void this.check();
    } else if (this.serverVersion && this.serverVersion !== this.loadedVersion) {
      void this.showAvailable(this.userId, this.serverVersion, this.generation);
    } else if (this.serverVersion) {
      void this.showDiscovery(this.userId, this.serverVersion, this.generation);
    }
  }

  check(): Promise<void> {
    if (!this.userId) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const userId = this.userId;
    const generation = this.generation;
    this.lastCheckedAt = Date.now();
    const context = new HttpContext().set(SILENT_APP_ACTIVITY, true);
    const request = firstValueFrom(this.http.get<{ version: string }>(
      `${environment.apiUrl}/app-updates/current`,
      { params: { _: String(Date.now()) }, context },
    )).then(async response => {
      if (generation !== this.generation || userId !== this.userId) return;
      const version = String(response?.version || '').trim();
      if (!version) return;
      if (this.serverVersion && this.serverVersion !== version) this.clearAvailable();
      this.serverVersion = version;
      if (version === this.loadedVersion) {
        this.clearAvailable();
        await this.showDiscovery(userId, version, generation);
      } else {
        await this.showAvailable(userId, version, generation);
      }
    }).catch(() => {
      // La consulta de versión no interrumpe el trabajo del usuario.
    }).finally(() => {
      if (this.inFlight === request) this.inFlight = null;
    });
    this.inFlight = request;
    return request;
  }

  private async showDiscovery(userId: string, version: string, generation: number): Promise<void> {
    if (!this.isActiveTab()) return;
    const key = `sir.app-update.presented:${userId}:${version}`;
    const claimed = await this.withBrowserLock(key, () => {
      if (localStorage.getItem(key) === '1') return false;
      localStorage.setItem(key, '1');
      return true;
    });
    if (!claimed || generation !== this.generation || userId !== this.userId) return;
    this.discoveryToastId = this.alerts.notify({
      type: 'info',
      title: `SIR se actualizó a ${version}`,
      message: 'Consulta las novedades de esta versión.',
      action: { label: 'Ver novedades', onClick: () => this.drawer.openAppUpdates() },
    });
  }

  private async showAvailable(userId: string, version: string, generation: number): Promise<void> {
    if (!this.isActiveTab()) return;
    if (this.availableToastId) {
      this.renewAvailable(userId, version);
      return;
    }
    const key = this.availableKey(userId, version);
    const claimed = await this.withBrowserLock(key, () => {
      const current = this.readLease(key);
      if (current && current.tabId !== this.tabId && current.until > Date.now()) return false;
      localStorage.setItem(key, JSON.stringify({ tabId: this.tabId, until: Date.now() + AVAILABLE_LEASE_MS }));
      return true;
    });
    if (!claimed) return;
    if (this.availableToastId) return;
    if (generation !== this.generation || userId !== this.userId
      || version !== this.serverVersion || !this.isActiveTab()) {
      this.releaseAvailable(userId, version);
      return;
    }
    this.availableToastId = this.alerts.notify({
      type: 'warning',
      title: 'Hay una nueva versión de SIR disponible',
      message: 'Actualiza la aplicación para usar la versión más reciente.',
      persistent: true,
      dismissible: false,
      action: { label: 'Actualizar ahora', keepOpen: true, onClick: () => void this.requestReload() },
    });
  }

  private async requestReload(): Promise<void> {
    if (await this.mayReload()) this.reload();
  }

  private clearAvailable(): void {
    this.releaseAvailable();
    if (this.availableToastId) this.alerts.dismissToast(this.availableToastId);
    this.availableToastId = null;
  }

  private renewAvailable(userId: string, version: string): void {
    const key = this.availableKey(userId, version);
    if (this.readLease(key)?.tabId === this.tabId) {
      localStorage.setItem(key, JSON.stringify({ tabId: this.tabId, until: Date.now() + AVAILABLE_LEASE_MS }));
    }
  }

  private releaseAvailable(userId = this.userId, version = this.serverVersion): void {
    if (!userId || !version || version === this.loadedVersion) return;
    const key = this.availableKey(userId, version);
    if (this.readLease(key)?.tabId === this.tabId) localStorage.removeItem(key);
  }

  private availableKey(userId: string, version: string): string {
    return `sir.app-update.available:${userId}:${version}`;
  }

  private readLease(key: string): { tabId: string; until: number } | null {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  }

  private isActiveTab(): boolean {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  private async withBrowserLock(key: string, claim: () => boolean): Promise<boolean> {
    const locks = navigator.locks;
    if (locks?.request) return locks.request(key, () => claim());
    return claim();
  }
}
