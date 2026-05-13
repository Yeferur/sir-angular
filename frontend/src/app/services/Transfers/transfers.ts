import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TransferService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  getServicios(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/Transfer/ServicioTransfer`);
  }

  crearTransfer(payload: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/Transfer/NuevoTransfer`, payload);
  }

  actualizarTransfer(id: string | number, payload: any): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/Transfer/${id}`, payload);
  }

  cancelarTransfer(id: string | number): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/Transfer/${id}/Cancelar`, {});
  }

  deleteTransfer(id: string | number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/Transfer/${id}`);
  }
  
  getRangos(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/Transfer/Rangos`);
  }

  getPreciosPorRango(Id_Rango: number | string): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/Transfer/Precios`, { params: { Id_Rango: String(Id_Rango) } });
  }

  getPrecioBasePorRangoYMoneda(Id_Rango: number | string, Id_Moneda: number | string): Observable<{ found: boolean; precio: number }> {
    if (Id_Rango === null || Id_Rango === undefined || Id_Rango === '' || Id_Moneda === null || Id_Moneda === undefined || Id_Moneda === '') {
      return of({ found: false, precio: 0 });
    }

    return this.http.get<any>(`${this.apiUrl}/Transfer/Precios`, {
      params: {
        Id_Rango: String(Id_Rango),
        Id_Moneda: String(Id_Moneda)
      }
    }).pipe(
      map((response: any) => {
        if (Array.isArray(response)) {
          const first = response[0] || null;
          const precio = Number(first?.Precio ?? first?.precio ?? 0);
          const found = Number.isFinite(precio) && precio > 0;
          return { found, precio: found ? precio : 0 };
        }

        if (response && typeof response === 'object') {
          const precio = Number(response.precio ?? response.Precio ?? 0);
          const found = response.found === true || Number.isFinite(precio) && precio > 0;
          return { found, precio: found ? precio : 0 };
        }

        return { found: false, precio: 0 };
      }),
      catchError(() => of({ found: false, precio: 0 }))
    );
  }

  getTransfers(params: any) {
    let httpParams = new URLSearchParams();
    Object.keys(params || {}).forEach(k => {
      const v = params[k];
      if (Array.isArray(v)) v.forEach(item => httpParams.append(k, String(item)));
      else if (v !== undefined && v !== null && v !== '') httpParams.set(k, String(v));
    });
    const url = `${this.apiUrl}/Transfer/Buscar` + (httpParams.toString() ? `?${httpParams.toString()}` : '');
    return this.http.get<any[]>(url);
  }

  getTransfer(Id_Transfer: string | number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/Transfer/${Id_Transfer}`);
  }

  getMonedas(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl.replace('/api','')}/api/monedas`);
  }

  subirComprobantePago(Id_Transfer: number | string, Id_Pago: number | string, file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<any>(`${this.apiUrl}/Transfer/${Id_Transfer}/Pagos/${Id_Pago}/Comprobante`, formData);
  }

  descargarComprobante(nombreArchivo: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/Transfer/Comprobante/${encodeURIComponent(nombreArchivo)}`, { responseType: 'blob' });
  }

  getComprobanteUrl(nombreArchivo: string): string {
    return `${this.apiUrl}/Transfer/Comprobante/${encodeURIComponent(nombreArchivo)}`;
  }
}
