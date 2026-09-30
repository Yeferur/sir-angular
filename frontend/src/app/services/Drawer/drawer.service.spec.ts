import { TestBed } from '@angular/core/testing';
import { SirDrawerService } from './drawer.service';

describe('SirDrawerService', () => {
  it('reemplaza Avisos y Novedades sin desmontar el drawer entre fases', () => {
    jasmine.clock().install();
    try {
      const service = TestBed.inject(SirDrawerService);
      service.openActivity();
      service.openAppUpdates();
      expect(service.drawer()?.type).toBe('mi-actividad');
      expect(service.replacePhase()).toBe('exit');
      expect(service.isOpen()).toBeTrue();

      jasmine.clock().tick(90);
      expect(service.drawer()?.type).toBe('app-updates');
      expect(service.replacePhase()).toBe('enter');
      jasmine.clock().tick(260);
      expect(service.replacePhase()).toBeNull();

      service.openActivity();
      expect(service.replacePhase()).toBe('exit');
      jasmine.clock().tick(90);
      expect(service.drawer()?.type).toBe('mi-actividad');
      jasmine.clock().tick(260);
      expect(service.replacePhase()).toBeNull();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('abre Novedades directamente y permite cerrar durante un reemplazo', () => {
    jasmine.clock().install();
    try {
      const service = TestBed.inject(SirDrawerService);
      service.openAppUpdates();
      expect(service.drawer()?.type).toBe('app-updates');
      expect(service.replacePhase()).toBeNull();

      service.openActivity();
      service.close(true);
      jasmine.clock().tick(400);
      expect(service.drawer()).toBeNull();
      expect(service.replacePhase()).toBeNull();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('cambia sin animación cuando el usuario prefiere movimiento reducido', () => {
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);
    const service = TestBed.inject(SirDrawerService);
    service.openActivity();
    service.openAppUpdates();
    expect(service.drawer()?.type).toBe('app-updates');
    expect(service.replacePhase()).toBeNull();
  });
});
