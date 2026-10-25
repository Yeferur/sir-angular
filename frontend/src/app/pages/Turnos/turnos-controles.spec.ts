import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TurnosComponent } from './turnos';
import { TurnosService } from '../../services/Turnos/turnos.service';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { SirDrawerService } from '../../services/Drawer/drawer.service';

describe('Turnos: geometría del buscador', () => {
  it('usa 40 px, texto de 14 px y los estados del buscador compartido', async () => {
    spyOn(TurnosComponent.prototype, 'ngOnInit');
    await TestBed.configureTestingModule({
      imports: [TurnosComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]),
        { provide: TurnosService, useValue: {} },
        { provide: PermisosService, useValue: { tienePermiso: () => false } },
        { provide: SirAlertService, useValue: {} },
        { provide: SirDrawerService, useValue: { drawer: signal(null) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TurnosComponent);
    fixture.componentInstance.loading.set(false);
    fixture.detectChanges();

    const field = fixture.nativeElement.querySelector('.search-field') as HTMLLabelElement;
    const input = field.querySelector('input') as HTMLInputElement;
    const style = getComputedStyle(field);
    expect(style.height).toBe('40px');
    expect(style.borderTopWidth).toBe('1px');
    expect(style.borderRadius).toBe('8px');
    expect(style.paddingLeft).toBe('12px');
    expect(getComputedStyle(input).fontSize).toBe('14px');
    expect(getComputedStyle(input).fontWeight).toBe('500');
    input.disabled = true;
    expect(getComputedStyle(field).opacity).toBe('0.55');
    fixture.destroy();
  });
});
