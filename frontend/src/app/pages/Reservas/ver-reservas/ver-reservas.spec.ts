import { convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { VerReservasComponent } from './ver-reservas';

describe('VerReservasComponent legacy empty filter URL', () => {
  it('ignores ?vacios=1 and omits the removed filter from API and URL filters', () => {
    const component = Object.create(VerReservasComponent.prototype) as any;
    component.route = { snapshot: { queryParamMap: convertToParamMap({ vacios: '1' }) } };
    component.filters = signal({});
    component.appliedFilters = signal({});
    component.page = signal(1);

    component.restoreFiltersFromQuery();

    expect(component.filters().Empty).toBeUndefined();
    expect(component.buildApiFilters().Empty).toBeUndefined();
    expect(component.buildFilterQueryParams(false).vacios).toBeUndefined();
  });
});
