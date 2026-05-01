import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
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
  
  getRangos(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/Transfer/Rangos`);
  }

  getPreciosPorRango(Id_Rango: number | string): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/Transfer/Precios`, { params: { Id_Rango: String(Id_Rango) } });
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
    return this.http.get(`${this.apiUrl}/Transfer/Comprobante/${nombreArchivo}`, { responseType: 'blob' });
  }
}
