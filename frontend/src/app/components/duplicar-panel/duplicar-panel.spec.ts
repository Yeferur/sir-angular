import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DuplicarPanelComponent } from './duplicar-panel';
import { Reservas } from '../../services/Reservas/reservas';
import { SirDrawerService } from '../../services/Drawer/drawer.service';

describe('Duplicar reserva: geometría de controles', () => {
  it('mantiene selects y fechas compartidos y normaliza las observaciones', async () => {
    spyOn(DuplicarPanelComponent.prototype, 'ngOnInit');
    await TestBed.configureTestingModule({
      imports: [DuplicarPanelComponent],
      providers: [provideZonelessChangeDetection(),
        { provide: Reservas, useValue: {} },
        { provide: SirDrawerService, useValue: { drawer: signal(null), close() {} } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DuplicarPanelComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const select = root.querySelector('.sir-select-trigger') as HTMLButtonElement;
    const date = root.querySelector('.sir-dp-field') as HTMLButtonElement;
    for (const control of [select, date]) {
      const style = getComputedStyle(control);
      expect(style.height).toBe('40px');
      expect(style.borderRadius).toBe('8px');
    }
    const notes = root.querySelector('.field textarea.form-input') as HTMLTextAreaElement;
    const style = getComputedStyle(notes);
    expect(parseFloat(style.height)).toBeGreaterThanOrEqual(104);
    expect(style.borderTopWidth).toBe('1px');
    expect(style.borderRadius).toBe('8px');
    expect(style.paddingLeft).toBe('13px');
    expect(style.fontSize).toBe('14px');
    expect(style.fontWeight).toBe('500');
    notes.disabled = true;
    expect(getComputedStyle(notes).opacity).toBe('0.72');
    fixture.destroy();
  });
});
