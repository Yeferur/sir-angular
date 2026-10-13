import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface MercadeoPasajero {
  id: number;
  nombre: string;
  documento: string | null;
}

export interface MercadeoReserva {
  Id_Reserva: string;
  Fecha_Registro: string | null;
  Fecha_Tour: string | null;
  NombreReporta: string | null;
  Telefono: string | null;
  Categoria: string | null;
  CreadorId: number | null;
  UsuarioCreador: string | null;
  pasajeros: MercadeoPasajero[];
}

export interface MercadeoPage {
  items: MercadeoReserva[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalReservas: number;
  totalPasajeros: number;
}

export interface MercadeoFilters {
  fechaRegistroDesde: string;
  fechaRegistroHasta: string;
  fechaTour: string;
  codigoReserva: string;
  categoria: string;
  nombrePasajero: string;
  documento: string;
}

@Injectable({ providedIn: 'root' })
export class MercadeoService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getCategorias() {
    return this.http.get<{ Id_Canal: number; Nombre_Canal: string }[]>(`${this.apiUrl}/mercadeo/categorias`);
  }

  buscar(filters: MercadeoFilters, page: number, pageSize = 25) {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    for (const [key, value] of Object.entries(filters)) {
      if (value) params = params.set(key, value);
    }
    return this.http.get<MercadeoPage>(`${this.apiUrl}/mercadeo/reservas`, { params });
  }
}
