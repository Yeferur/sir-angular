import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SirFilterBarComponent } from './filter-bar';
import { SirFilterPanelComponent } from '../filter-panel/filter-panel';
import { SirSearchInputComponent } from '../search-input/search-input';
import { QueryEmptyStateComponent } from '../query-empty-state/query-empty-state';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, SirFilterBarComponent, SirFilterPanelComponent, SirSearchInputComponent, QueryEmptyStateComponent],
  template: `<app-filter-bar panelId="test-panel" [expanded]="open" [filterCount]="2"
      [showClear]="true" [busy]="busy" (toggleFilters)="open = !open"
      (search)="searches = searches + 1" (clear)="clears = clears + 1">
      <div sirPrimaryFilters><app-search-input ariaLabel="Buscar pruebas" [formControl]="query"
        (search)="searches = searches + 1" (clear)="clears = clears + 1" /></div>
    </app-filter-bar>
    <app-filter-panel panelId="test-panel" [open]="open"><label for="secondary">Campo secundario</label><input id="secondary" /></app-filter-panel>
    <app-query-empty-state icon="bx-filter-alt" title="Prepara tu consulta"
      description="Elige filtros y busca." [compact]="true" />`,
})
class FilterTestHost {
  open = false;
  busy = false;
  searches = 0;
  clears = 0;
  query = new FormControl('', { nonNullable: true });
}

describe('Primitivas de consulta', () => {
  let fixture: ComponentFixture<FilterTestHost>;
  let host: FilterTestHost;
  const render = () => { fixture.changeDetectorRef.markForCheck(); fixture.detectChanges(); };
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FilterTestHost], providers: [provideZonelessChangeDetection()] }).compileComponents();
    fixture = TestBed.createComponent(FilterTestHost);
    host = fixture.componentInstance;
    render();
  });

  it('proyecta filtros primarios, expande el panel accesible y emite acciones', () => {
    const root = fixture.nativeElement as HTMLElement;
    const toggle = root.querySelector<HTMLButtonElement>('.sir-filter-toggle')!;
    const panel = root.querySelector<HTMLElement>('#test-panel')!;
    expect(toggle.getAttribute('aria-controls')).toBe('test-panel');
    expect(toggle.getAttribute('aria-label')).toBe('Filtros, 2 activos');
    expect(panel.hidden).toBeTrue();
    toggle.click(); render();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBeFalse();
    expect(panel.querySelector('label')?.textContent).toBe('Campo secundario');
    root.querySelector<HTMLButtonElement>('.sir-filter-actions .sir-action--primary')!.click();
    expect(host.searches).toBe(1);
    host.busy = true; render();
    expect(root.querySelector<HTMLButtonElement>('.sir-filter-actions .sir-action--primary')!.disabled).toBeTrue();
  });

  it('anima el cierre del panel y después lo oculta del árbol accesible', async () => {
    host.open = true; render();
    const panel = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('#test-panel')!;
    expect(panel.hidden).toBeFalse();
    host.open = false; render();
    expect(panel.classList.contains('is-closing')).toBeTrue();
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(panel.hasAttribute('inert')).toBeTrue();
    await new Promise(resolve => setTimeout(resolve, 190));
    render();
    expect(panel.hidden).toBeTrue();
  });

  it('mantiene SearchInput sincronizado con Reactive Forms y limpia sin buscar automáticamente', () => {
    const root = fixture.nativeElement as HTMLElement;
    host.query.setValue('TG123'); render();
    const input = root.querySelector<HTMLInputElement>('.sir-search-input input')!;
    expect(input.value).toBe('TG123');
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    expect(host.searches).toBe(1);
    root.querySelector<HTMLButtonElement>('.sir-search-input button')!.click(); render();
    expect(host.query.value).toBe('');
    expect(host.clears).toBe(1);
    expect(host.searches).toBe(1);
  });

  it('presenta el estado inicial compacto con título, descripción e icono configurables', () => {
    const state = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.sir-query-empty')!;
    expect(state.classList.contains('sir-query-empty--compact')).toBeTrue();
    expect(state.querySelector('h2')?.textContent).toBe('Prepara tu consulta');
    expect(state.querySelector('p')?.textContent).toBe('Elige filtros y busca.');
    expect(state.querySelector('.bx-filter-alt')).not.toBeNull();
    expect(state.getAttribute('aria-labelledby')).toBe(state.querySelector('h2')?.id);
  });
});
