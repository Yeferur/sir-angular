import { Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface DynamicPanelState {
  id: string;
  title: string;
  component: any;       // componente standalone a renderizar
  props?: Record<string, any>;
  open: boolean;
}
@Injectable({
  providedIn: 'root'
})
export class DynamicIslandGlobalService {

  apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  mode = signal<'login' | ''>('login');
  // Definir la señal como propiedad pública
  alert = signal<{
    type?: 'success' | 'info' | 'error' | 'warning',
    title?: string,
    message?: string,
    buttons?: { text: string, style: string, onClick: () => void }[],
    loading?: boolean,
    autoClose?: boolean,
    autoCloseTime?: number
  } | null>(null);

  puntos = signal<any>(null);

  Id_Reserva = signal<string>(null);
  // Id_Transfer para seleccionar transfer desde vistas
  Id_Transfer = signal<string>(null);

  cuposInfo = signal<any>(null);

  sugerencias = signal<any>(null);
  private seleccionSugerenciaSignal = signal<any | null>(null);
  seleccionSugerencia$ = this.seleccionSugerenciaSignal.asReadonly();

  confirmarSugerenciaDesdeNavbar(sugerencia: any) {
    this.seleccionSugerenciaSignal.set(sugerencia);
    this.sugerencias.set(null);
  }

  private CombinacionManualSignal = signal<any | null>(null);
  CombinacionManual$ = this.CombinacionManualSignal.asReadonly();

  generarCombincionManual(manual : any) {
    this.CombinacionManualSignal.set(manual);
  }

   // ✅ Método para obtener la mejor ruta desde el backend
  obtenerRutaOptima(puntos: { lat: number, lng: number }[]): Observable<any> {
    console.log(puntos);
    return this.http.post<any>(`${this.apiUrl}/ruta-optima`, { puntos });
  }




  panel = signal<DynamicPanelState | null>(null);

  // Simple preview (comprobante u otros recursos) to show inside the Dynamic Island
  previewUrl = signal<string | null>(null);
  previewTitle = signal<string | null>(null);

  openPreview(url: string, title?: string) {
    this.previewUrl.set(url);
    this.previewTitle.set(title || 'Preview');
  }

  closePreview() {
    this.previewUrl.set(null);
    this.previewTitle.set(null);
  }

  openPanel(state: Omit<DynamicPanelState, 'open'>) {
    this.panel.set({ ...state, open: true });
  }

  closePanel() {
 this.panel.set(null);
  }

  togglePanel(state: Omit<DynamicPanelState, 'open'>) {
    const p = this.panel();
    if (!p || !p.open || p.id !== state.id) {
      this.openPanel(state);
    } else {
      this.closePanel();
    }
  }
}
