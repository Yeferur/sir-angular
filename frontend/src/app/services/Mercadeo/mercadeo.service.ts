import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { forkJoin, map } from 'rxjs';

export type MercadeoEntidadTipo = 'HOTEL' | 'AGENCIA_NACIONAL' | 'AGENCIA_INTERNACIONAL';

export interface MercadeoEntidadReportante {
  Id_Entidad_Reportante: number;
  Tipo: MercadeoEntidadTipo;
  Nombre: string;
  Activo: number | boolean;
  Estado_Validacion: 'PENDIENTE_VALIDACION' | 'VALIDADA' | 'RECHAZADA';
}

export interface MercadeoPasajero {
  id: number;
  nombre: string;
  documento: string | null;
}

export interface MercadeoTransfer {
  Id_Transfer: number;
  Codigo_Transfer: string;
  Fecha_Registro: string | null;
  Fecha_Transfer: string | null;
  Estado: string | null;
  Nombre_Titular: string | null;
  DNI: string | null;
  Telefono_Titular: string | null;
  Cantidad_Pasajeros: number | null;
  Id_Canal: number | null;
  Categoria: string | null;
  Id_Entidad_Reportante: number | null;
  Nombre_Entidad_Reportante: string | null;
  Tipo_Entidad_Reportante: 'HOTEL' | 'AGENCIA_NACIONAL' | 'AGENCIA_INTERNACIONAL' | null;
  NombreReporta: string | null;
  Telefono: string | null;
  CreadorId: number | null;
  UsuarioCreador: string | null;
  Nombre_Servicio: string | null;
}

export interface MercadeoReserva {
  Id_Reserva: string;
  Fecha_Registro: string | null;
  Fecha_Tour: string | null;
  Id_Canal: number;
  Id_Entidad_Reportante: number | null;
  Nombre_Entidad_Reportante: string | null;
  Tipo_Entidad_Reportante: 'HOTEL' | 'AGENCIA_NACIONAL' | 'AGENCIA_INTERNACIONAL' | null;
  NombreReporta: string | null;
  Telefono: string | null;
  Categoria: string | null;
  CreadorId: number | null;
  UsuarioCreador: string | null;
  Cantidad_Pasajeros: number;
}

export interface MercadeoPage {
  items: MercadeoReserva[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalReservas: number;
  totalPasajeros: number;
}

export interface MercadeoTransfersPage {
  items: MercadeoTransfer[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalTransfers: number;
  totalPasajeros: number;
}

export interface MercadeoFilters {
  fechaRegistroDesde: string;
  fechaRegistroHasta: string;
  fechaTour: string;
  codigoReserva: string;
  categoria: string;
  tipo?: 'TODOS' | 'RESERVA' | 'TRANSFER';
  estado?: string;
  idEntidadReportante?: string;
  creadorIds: string[];
}

export interface MercadeoOrigenOperacion {
  tipo: 'RESERVA' | 'TRANSFER';
  id_operacion: string;
  id_reserva: string | null;
  id_transfer: number | null;
  fecha_registro: string | null;
  fecha_servicio: string | null;
  id_canal: number | null;
  canal: string | null;
  id_entidad_reportante: number | null;
  entidad: string | null;
  tipo_entidad: MercadeoEntidadTipo | null;
  nombre_reportante: string | null;
  telefono_reportante: string | null;
  creador_id: number | null;
  creador: string | null;
  pasajeros: number;
  estado: string | null;
  pendiente_por_entidad_en: string | null;
}

export interface MercadeoOrigenPage {
  items: MercadeoOrigenOperacion[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalOperaciones: number;
  totalPasajeros: number;
  totalPasajerosEnPagina: number;
  tipo: 'TODOS' | 'RESERVA' | 'TRANSFER';
}

export interface MercadeoUsuario {
  Id_Usuario: number;
  Nombres_Apellidos: string;
  Activo: number | boolean;
}

@Injectable({ providedIn: 'root' })
export class MercadeoService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getCategorias() {
    return this.http.get<{ Id_Canal: number; Nombre_Canal: string }[]>(`${this.apiUrl}/mercadeo/categorias`);
  }

  getUsuarios() {
    return this.http.get<MercadeoUsuario[]>(`${this.apiUrl}/mercadeo/usuarios`);
  }

  buscarEntidadesReportantes(search: string) {
    const types: MercadeoEntidadTipo[] = ['HOTEL', 'AGENCIA_NACIONAL', 'AGENCIA_INTERNACIONAL'];
    const requests = types.map((type) => this.http.get<MercadeoEntidadReportante[]>(
      `${this.apiUrl}/entidades-reportantes`, {
        params: new HttpParams().set('tipo', type).set('buscar', search).set('limite', 20).set('incluirInactivas', '1'),
      },
    ));
    return forkJoin(requests).pipe(
      map((groups) => groups.flat().sort((a, b) => a.Nombre.localeCompare(b.Nombre, 'es'))),
    );
  }

  buscar(filters: MercadeoFilters, page: number, pageSize = 25) {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    for (const [key, value] of Object.entries(filters)) {
      if (Array.isArray(value)) {
        if (value.length) params = params.set(key, value.join(','));
      } else if (value) params = params.set(key, value);
    }
    return this.http.get<MercadeoPage>(`${this.apiUrl}/mercadeo/reservas`, { params });
  }

  buscarTransfers(filters: MercadeoFilters, page: number, pageSize = 25) {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    for (const [key, value] of Object.entries(filters)) {
      if (Array.isArray(value)) {
        if (value.length) params = params.set(key, value.join(','));
      } else if (value) params = params.set(key, value);
    }
    return this.http.get<MercadeoTransfersPage>(`${this.apiUrl}/mercadeo/transfers`, { params });
  }

  buscarOrigen(filters: MercadeoFilters, page: number, pageSize = 25) {
    return this.http.get<MercadeoOrigenPage>(`${this.apiUrl}/mercadeo/origen`, {
      params: this.origenParams(filters).set('page', page).set('pageSize', pageSize),
    });
  }

  exportarOrigen(filters: MercadeoFilters) {
    return this.http.get(`${this.apiUrl}/mercadeo/origen/exportar`, {
      params: this.origenParams(filters), responseType: 'blob',
    });
  }

  private origenParams(filters: MercadeoFilters): HttpParams {
    let params = new HttpParams();
    const scalarKeys: Array<keyof MercadeoFilters> = [
      'fechaRegistroDesde', 'fechaRegistroHasta', 'fechaTour', 'categoria', 'tipo', 'estado', 'idEntidadReportante',
    ];
    for (const key of scalarKeys) {
      const value = filters[key];
      if (value) params = params.set(key, String(value));
    }
    if (filters.creadorIds?.length) params = params.set('creadorIds', filters.creadorIds.join(','));
    return params;
  }
}
