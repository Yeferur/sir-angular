import { computed, Injectable, OnDestroy, signal } from '@angular/core';
import { SirNotification } from './notificaciones.service';

export type DesktopNotificationToggleResult = 'enabled' | 'disabled' | 'denied' | 'unsupported';

@Injectable({ providedIn: 'root' })
export class DesktopNotificationsService implements OnDestroy {
  readonly supported = signal(false);
  readonly permission = signal<NotificationPermission>('default');
  readonly enabled = signal(false);
  readonly onboardingEligible = signal(false);
  readonly state = computed<'enabled' | 'disabled' | 'pending' | 'blocked' | 'unsupported'>(() => {
    if (!this.supported()) return 'unsupported';
    if (this.permission() === 'denied') return 'blocked';
    if (this.permission() === 'default') return 'pending';
    return this.enabled() ? 'enabled' : 'disabled';
  });

  private userId: string | null = null;
  private readonly shownTtlMs = 24 * 60 * 60 * 1000;
  private readonly focusTtlMs = 1_500;
  private readonly tabId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
  private readonly focusedTabKey = 'sir.desktop-notifications.focused-tab';
  private focusTimer?: number;
  private presenceChannel?: BroadcastChannel;
  private readonly presenceWaiters = new Map<string, (focused: boolean) => void>();
  private readonly handleFocusChange = () => {
    this.refreshPermissionState();
    this.updateFocusPresence();
  };

  constructor() {
    const supported = typeof window !== 'undefined' && 'Notification' in window;
    this.supported.set(supported);
    if (supported) this.permission.set(Notification.permission);
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.handleFocusChange);
      window.addEventListener('blur', this.handleFocusChange);
      document.addEventListener('visibilitychange', this.handleFocusChange);
      window.addEventListener('pagehide', this.handleFocusChange);
      if ('BroadcastChannel' in window) {
        this.presenceChannel = new BroadcastChannel('sir.desktop-notifications.presence');
        this.presenceChannel.onmessage = event => this.handlePresenceMessage(event.data);
      }
      this.focusTimer = window.setInterval(this.handleFocusChange, 5_000);
      this.updateFocusPresence();
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('focus', this.handleFocusChange);
    window.removeEventListener('blur', this.handleFocusChange);
    document.removeEventListener('visibilitychange', this.handleFocusChange);
    window.removeEventListener('pagehide', this.handleFocusChange);
    if (this.focusTimer) window.clearInterval(this.focusTimer);
    this.presenceChannel?.close();
  }

  configureUser(userId: string | number | null | undefined): void {
    this.userId = userId == null ? null : String(userId);
    this.syncPreference();
  }

  clearSession(): void {
    this.userId = null;
    this.enabled.set(false);
    this.onboardingEligible.set(false);
  }

  /** Relee el permiso real: puede cambiar fuera de SIR desde la configuración del navegador. */
  refreshPermissionState(): void {
    if (!this.supported()) {
      this.enabled.set(false);
      this.onboardingEligible.set(false);
      return;
    }
    const permission = Notification.permission;
    this.permission.set(permission);
    this.enabled.set(permission === 'granted' && this.readPreference());
    const preferenceKey = this.preferenceKey();
    const dismissalKey = this.onboardingKey();
    this.onboardingEligible.set(!!preferenceKey && permission === 'default'
      && localStorage.getItem(preferenceKey) === null
      && !!dismissalKey && localStorage.getItem(dismissalKey) !== '1');
  }

  dismissOnboarding(): void {
    const key = this.onboardingKey();
    if (!key) return;
    localStorage.setItem(key, '1');
    this.onboardingEligible.set(false);
  }

  isCurrentTabActive(): boolean {
    return typeof document !== 'undefined'
      && document.visibilityState === 'visible'
      && document.hasFocus();
  }

  async claimInternal(notificationId: string): Promise<boolean> {
    if (!this.isCurrentTabActive()) return false;
    return this.claim(notificationId);
  }

  async toggle(): Promise<DesktopNotificationToggleResult> {
    if (!this.supported()) return 'unsupported';
    if (this.enabled()) {
      this.writePreference(false);
      this.enabled.set(false);
      this.onboardingEligible.set(false);
      return 'disabled';
    }

    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    this.permission.set(permission);
    if (permission !== 'granted') {
      this.writePreference(false);
      this.enabled.set(false);
      this.onboardingEligible.set(false);
      return 'denied';
    }

    this.writePreference(true);
    this.enabled.set(true);
    this.onboardingEligible.set(false);
    return 'enabled';
  }

  async show(notification: SirNotification, onOpen: () => void): Promise<boolean> {
    this.refreshPermissionState();
    if (!this.enabled()) return false;
    if (Notification.permission !== 'granted') {
      this.permission.set(Notification.permission);
      this.enabled.set(false);
      return false;
    }
    if (await this.anySirTabFocused()) return false;
    if (!await this.claim(notification.idNotificacion)) return false;

    try {
      const type = notification.tipo.toUpperCase();
      const body = type === 'RECORDATORIO'
        ? 'Tienes un recordatorio pendiente. Abre SIR para consultar los detalles.'
        : type === 'PENDIENTE'
          ? 'Hay una actividad operativa que requiere tu atención. Abre SIR para consultar los detalles.'
          : 'Hay una novedad en SIR. Abre la aplicación para consultar los detalles.';
      const desktopNotification = new Notification(`SIR · ${notification.titulo}`, {
        body: String(body || 'Hay una actividad que requiere tu atención.').slice(0, 220),
        tag: `sir-notification-${notification.idNotificacion}`,
      });
      desktopNotification.onclick = () => {
        window.focus();
        desktopNotification.close();
        onOpen();
      };
      return true;
    } catch {
      this.releaseClaim(notification.idNotificacion);
      return false;
    }
  }

  private syncPreference(): void {
    this.refreshPermissionState();
  }

  private preferenceKey(): string | null {
    return this.userId ? `sir.desktop-notifications.enabled:${this.userId}` : null;
  }

  private onboardingKey(): string | null {
    return this.userId ? `sir.desktop-notifications.onboarding-dismissed:${this.userId}` : null;
  }

  private readPreference(): boolean {
    const key = this.preferenceKey();
    return !!key && localStorage.getItem(key) === '1';
  }

  private writePreference(enabled: boolean): void {
    const key = this.preferenceKey();
    if (!key) return;
    localStorage.setItem(key, enabled ? '1' : '0');
  }

  private async claim(notificationId: string): Promise<boolean> {
    const lockName = `sir-desktop-notification:${notificationId}`;
    const locks = (navigator as any).locks;
    if (locks?.request) {
      return locks.request(lockName, { ifAvailable: true }, (lock: unknown) => (
        lock ? this.claimInStorage(notificationId) : false
      ));
    }
    return this.claimInStorage(notificationId);
  }

  private claimInStorage(notificationId: string): boolean {
    const key = this.shownKey(notificationId);
    const now = Date.now();
    const current = Number(localStorage.getItem(key) || 0);
    if (current > now - this.shownTtlMs) return false;
    localStorage.setItem(key, String(now));
    return true;
  }

  private releaseClaim(notificationId: string): void {
    localStorage.removeItem(this.shownKey(notificationId));
  }

  private shownKey(notificationId: string): string {
    return `sir.desktop-notification.shown:${notificationId}`;
  }

  private updateFocusPresence(): void {
    const focused = document.visibilityState === 'visible' && document.hasFocus();
    let current: { tabId?: string } | null = null;
    try { current = JSON.parse(localStorage.getItem(this.focusedTabKey) || 'null'); } catch {}
    if (focused) {
      localStorage.setItem(this.focusedTabKey, JSON.stringify({ tabId: this.tabId, at: Date.now() }));
    } else if (current?.tabId === this.tabId) {
      localStorage.removeItem(this.focusedTabKey);
    }
  }

  private async anySirTabFocused(): Promise<boolean> {
    this.updateFocusPresence();
    if (this.isCurrentTabActive()) return true;
    try {
      const current = JSON.parse(localStorage.getItem(this.focusedTabKey) || 'null');
      if (current?.tabId !== this.tabId && Number(current?.at || 0) > Date.now() - this.focusTtlMs) return true;
    } catch {}
    if (this.presenceChannel) {
      const queryId = `${this.tabId}:${Date.now()}:${Math.random()}`;
      return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (focused: boolean) => {
          if (settled) return;
          settled = true;
          this.presenceWaiters.delete(queryId);
          resolve(focused);
        };
        this.presenceWaiters.set(queryId, finish);
        this.presenceChannel?.postMessage({ type: 'query', queryId, tabId: this.tabId });
        window.setTimeout(() => finish(false), 90);
      });
    }
    try {
      const current = JSON.parse(localStorage.getItem(this.focusedTabKey) || 'null');
      return Number(current?.at || 0) > Date.now() - this.focusTtlMs;
    } catch {
      return document.visibilityState === 'visible' && document.hasFocus();
    }
  }

  private handlePresenceMessage(message: any): void {
    if (message?.type === 'query' && message.tabId !== this.tabId) {
      this.presenceChannel?.postMessage({
        type: 'response', queryId: message.queryId, tabId: this.tabId,
        focused: this.isCurrentTabActive(),
      });
      return;
    }
    if (message?.type === 'response' && message.focused) {
      this.presenceWaiters.get(String(message.queryId))?.(true);
    }
  }
}
