import { DesktopNotificationsService } from './desktop-notifications.service';
import { SirNotification } from './notificaciones.service';

describe('DesktopNotificationsService', () => {
  let originalNotification: typeof Notification;
  let created: number;
  let requested: number;
  let services: DesktopNotificationsService[];

  class FakeNotification {
    static permission: NotificationPermission = 'granted';
    static requestPermission = async (): Promise<NotificationPermission> => {
      requested += 1;
      FakeNotification.permission = 'granted';
      return FakeNotification.permission;
    };
    onclick: (() => void) | null = null;
    constructor(_title: string, _options?: NotificationOptions) { created += 1; }
    close(): void {}
  }

  const item: SirNotification = {
    idNotificacion: '901', tipo: 'PENDIENTE', titulo: 'Comisiones',
    mensaje: 'Dos reservas requieren atención.', entidadTipo: 'OPERACION', entidadId: 'commissions',
    datos: { prioridad: 'MEDIA' }, leida: false, fechaLectura: null, fechaCreacion: '2026-09-22T12:00:00Z',
  };

  beforeEach(() => {
    originalNotification = window.Notification;
    created = 0;
    requested = 0;
    services = [];
    localStorage.clear();
    Object.defineProperty(window, 'Notification', { configurable: true, value: FakeNotification });
    spyOn(document, 'hasFocus').and.returnValue(false);
  });

  afterEach(() => {
    services.forEach(service => service.ngOnDestroy());
    Object.defineProperty(window, 'Notification', { configurable: true, value: originalNotification });
    localStorage.clear();
  });

  const service = (): DesktopNotificationsService => {
    const instance = new DesktopNotificationsService();
    services.push(instance);
    return instance;
  };

  it('solo solicita permiso después de activar voluntariamente la opción', async () => {
    FakeNotification.permission = 'default';
    const desktop = service();
    desktop.configureUser('7');
    expect(requested).toBe(0);
    expect(await desktop.toggle()).toBe('enabled');
    expect(requested).toBe(1);
    expect(desktop.enabled()).toBeTrue();
  });

  it('muestra una sola notificación aunque dos pestañas reciban el mismo evento', async () => {
    FakeNotification.permission = 'granted';
    localStorage.setItem('sir.desktop-notifications.enabled:7', '1');
    const firstTab = service();
    const secondTab = service();
    firstTab.configureUser('7');
    secondTab.configureUser('7');

    expect(await firstTab.show(item, () => {})).toBeTrue();
    expect(await secondTab.show(item, () => {})).toBeFalse();
    expect(created).toBe(1);
  });

  it('no vuelve a mostrar un acontecimiento ya entregado tras una reconexión', async () => {
    FakeNotification.permission = 'granted';
    localStorage.setItem('sir.desktop-notifications.enabled:7', '1');
    const desktop = service();
    desktop.configureUser('7');

    expect(await desktop.show(item, () => {})).toBeTrue();
    expect(await desktop.show(item, () => {})).toBeFalse();
    expect(created).toBe(1);
  });

  it('conserva el aviso interno sin mostrar escritorio cuando SIR tiene el foco', async () => {
    (document.hasFocus as jasmine.Spy).and.returnValue(true);
    FakeNotification.permission = 'granted';
    localStorage.setItem('sir.desktop-notifications.enabled:7', '1');
    const desktop = service();
    desktop.configureUser('7');
    expect(await desktop.show(item, () => {})).toBeFalse();
    expect(created).toBe(0);
  });

  it('no muestra escritorio si otra pestaña de SIR está enfocada', async () => {
    FakeNotification.permission = 'granted';
    localStorage.setItem('sir.desktop-notifications.enabled:7', '1');
    localStorage.setItem('sir.desktop-notifications.focused-tab', JSON.stringify({ tabId: 'otra-pestana', at: Date.now() }));
    const desktop = service();
    desktop.configureUser('7');
    expect(await desktop.show(item, () => {})).toBeFalse();
    expect(created).toBe(0);
  });

  it('muestra escritorio al cambiar a otra pestaña del navegador aunque SIR acabara de tener foco', async () => {
    FakeNotification.permission = 'granted';
    localStorage.setItem('sir.desktop-notifications.enabled:7', '1');
    const desktop = service();
    desktop.configureUser('7');
    localStorage.setItem('sir.desktop-notifications.focused-tab', JSON.stringify({
      tabId: (desktop as any).tabId, at: Date.now(),
    }));

    expect(await desktop.show(item, () => {})).toBeTrue();
    expect(created).toBe(1);
  });

  it('muestra escritorio con la ventana sin foco o el navegador minimizado', async () => {
    FakeNotification.permission = 'granted';
    localStorage.setItem('sir.desktop-notifications.enabled:7', '1');
    const unfocusedWindow = service();
    unfocusedWindow.configureUser('7');
    expect(await unfocusedWindow.show({ ...item, idNotificacion: '902' }, () => {})).toBeTrue();

    spyOnProperty(document, 'visibilityState', 'get').and.returnValue('hidden');
    const minimized = service();
    minimized.configureUser('7');
    expect(await minimized.show({ ...item, idNotificacion: '903' }, () => {})).toBeTrue();
    expect(created).toBe(2);
  });

  it('no presenta una preferencia antigua como activa si el navegador revocó el permiso', () => {
    FakeNotification.permission = 'denied';
    localStorage.setItem('sir.desktop-notifications.enabled:7', '1');
    const desktop = service();
    desktop.configureUser('7');
    expect(desktop.enabled()).toBeFalse();
    expect(desktop.state()).toBe('blocked');
  });

  it('respeta la preferencia desactivada aunque el permiso continúe concedido', async () => {
    FakeNotification.permission = 'granted';
    localStorage.setItem('sir.desktop-notifications.enabled:7', '0');
    const desktop = service();
    desktop.configureUser('7');
    expect(desktop.state()).toBe('disabled');
    expect(await desktop.show(item, () => {})).toBeFalse();
    expect(created).toBe(0);
  });
});
