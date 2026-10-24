import { convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { VerTransfersComponent } from './ver-transfers';

describe('VerTransfersComponent legacy empty filter URL', () => {
  it('ignores ?vacios=1 and omits the removed filter from URL filters', () => {
    const component = Object.create(VerTransfersComponent.prototype) as any;
    component.route = { snapshot: { queryParamMap: convertToParamMap({ vacios: '1' }) } };
    component.filters = signal({});
    component.appliedFilters = signal({});
    component.page = signal(1);

    component.restoreFiltersFromQuery();

    expect(component.filters().Empty).toBeUndefined();
    expect(component.buildFilterQueryParams(false).vacios).toBeUndefined();
  });
});
