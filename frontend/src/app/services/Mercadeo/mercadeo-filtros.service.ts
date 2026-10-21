import { Injectable, signal } from '@angular/core';
import { ParamMap } from '@angular/router';
import { MercadeoFilters } from './mercadeo.service';

export interface MercadeoFilterState {
  filters: MercadeoFilters;
  entityName: string;
  page: number;
}

export const EMPTY_MERCADEO_FILTERS: MercadeoFilters = {
  fechaRegistroDesde: '', fechaRegistroHasta: '', fechaTour: '', codigoReserva: '',
  categoria: '', tipo: 'TODOS', estado: '', idEntidadReportante: '', creadorIds: [],
};

@Injectable({ providedIn: 'root' })
export class MercadeoFiltrosService {
  readonly draft = signal<MercadeoFilters>(this.clone(EMPTY_MERCADEO_FILTERS));
  readonly applied = signal<MercadeoFilters>(this.clone(EMPTY_MERCADEO_FILTERS));
  readonly draftEntityName = signal('');
  readonly appliedEntityName = signal('');

  setDraft(filters: MercadeoFilters, entityName = this.draftEntityName()): void {
    this.draft.set(this.clone(filters));
    this.draftEntityName.set(entityName);
  }

  apply(filters = this.draft(), entityName = this.draftEntityName()): void {
    const copy = this.clone(filters);
    this.applied.set(copy);
    this.appliedEntityName.set(entityName);
  }

  restore(params: ParamMap): MercadeoFilterState {
    const rawType = String(params.get('tipo') || params.get('tipoOperacion') || 'TODOS').toLocaleUpperCase('es-CO');
    const tipo: MercadeoFilters['tipo'] = ['TRANSFER', 'TRANSFERS'].includes(rawType) ? 'TRANSFER'
      : ['RESERVA', 'RESERVAS'].includes(rawType) ? 'RESERVA' : 'TODOS';
    const filters: MercadeoFilters = {
      fechaRegistroDesde: params.get('fechaRegistroDesde') || '',
      fechaRegistroHasta: params.get('fechaRegistroHasta') || '',
      fechaTour: params.get('fechaTour') || '',
      codigoReserva: '',
      categoria: params.get('categoria') || '',
      tipo,
      estado: params.get('estado') || '',
      idEntidadReportante: params.get('idEntidadReportante') || '',
      creadorIds: (params.get('creadorIds') || '').split(',').map(value => value.trim()).filter(Boolean),
    };
    const entityName = params.get('entidadNombre') || '';
    const pageValue = Number(params.get('page') || 1);
    const state = { filters, entityName, page: Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1 };
    this.draft.set(this.clone(filters));
    this.applied.set(this.clone(filters));
    this.draftEntityName.set(entityName);
    this.appliedEntityName.set(entityName);
    return state;
  }

  queryParams(filters: MercadeoFilters, entityName: string, page = 1): Record<string, string | null> {
    return {
      tipo: filters.tipo || 'TODOS',
      estado: filters.estado || null,
      fechaRegistroDesde: filters.fechaRegistroDesde || null,
      fechaRegistroHasta: filters.fechaRegistroHasta || null,
      fechaTour: filters.fechaTour || null,
      categoria: filters.categoria || null,
      idEntidadReportante: filters.idEntidadReportante || null,
      entidadNombre: filters.idEntidadReportante ? (entityName || null) : null,
      creadorIds: filters.creadorIds?.length ? filters.creadorIds.join(',') : null,
      page: page > 1 ? String(page) : null,
    };
  }

  signature(filters: MercadeoFilters, entityName: string, page = 1): string {
    return JSON.stringify({ ...this.clone(filters), entityName, page });
  }

  private clone(filters: MercadeoFilters): MercadeoFilters {
    return { ...EMPTY_MERCADEO_FILTERS, ...filters, creadorIds: [...(filters.creadorIds || [])] };
  }
}
