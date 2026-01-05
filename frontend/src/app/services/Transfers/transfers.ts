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
  
  getMonedas(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl.replace('/api','')}/api/monedas`);
  }

  // Temporal: deshabilitado para pruebas de la app - no eliminar, solo ocultar
  // Para reactivar, restaurar la llamada HTTP y eliminar el `of(...)` siguiente.
  checkWhatsApp(phone: string): Observable<any> {
    return of({ disabled: true, exists: false, message: 'Verificación WhatsApp deshabilitada temporalmente' });
    // return this.http.post<any>(`${this.apiUrl}/phone/check-whatsapp`, { phone });
  }
}
