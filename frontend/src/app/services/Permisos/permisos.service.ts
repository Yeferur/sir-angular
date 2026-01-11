import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, forkJoin, of, firstValueFrom } from 'rxjs';
import { tap, catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface Permiso {
  codigo: string;
  accion: string;
  modulo: string;
  nombreModulo: string;
  descripcion: string;
}

export interface MenuItem {
  id: number;
  nombre: string;
  codigo: string;
  icono: string;
  ruta: string;
  orden: number;
}

export interface Rol {
  Id_Rol: number;
  Nombre_Rol: string;
  Descripcion: string;
  Activo: number;
}

export interface Modulo {
  Id_Modulo: number;
  Nombre_Modulo: string;
  Codigo_Modulo: string;
  Descripcion: string;
  Icono: string;
  Ruta: string;
  Orden: number;
  Activo: number;
}

export interface PermisoCompleto {
  Id_Permiso: number;
  Codigo_Permiso: string;
  Accion: string;
  Descripcion: string;
  Id_Modulo: number;
  Nombre_Modulo: string;
  Codigo_Modulo: string;
}

@Injectable({
  providedIn: 'root'
})
export class PermisosService {
  private baseUrl = environment.apiUrl;

  // permisos actuales (solo códigos)
  private permisosSubject = new BehaviorSubject<string[]>([]);
  public permisos$ = this.permisosSubject.asObservable();

  // menú dinámico
  private menuSubject = new BehaviorSubject<MenuItem[]>([]);
  public menu$ = this.menuSubject.asObservable();

  // estado de carga
  private readySubject = new BehaviorSubject<boolean>(false);
  public ready$ = this.readySubject.asObservable();

  constructor(private http: HttpClient) {}

  // =====================================================
  // CARGA RÁPIDA: localStorage + backend
  // =====================================================

  async loadSessionData(options?: { token?: string | null }): Promise<void> {
    // 1) hidratar desde localStorage
    this.cargarPermisosDesdeLocalStorage();

    // 2) si no hay token, listo
    const token = options?.token ?? this.getTokenFromStorage();
    if (!token) {
      this.readySubject.next(true);
      return;
    }

    // 3) refresca desde backend
    try {
      // Solo solicitamos los permisos desde backend.
      // El menú se mantiene estático/en el layout y no depende de la tabla `modulos`.
      await firstValueFrom(
        this.obtenerMisPermisos().pipe(catchError(() => of({ permisos: [] as Permiso[] })), map(() => true))
      );

      this.readySubject.next(true);
    } catch (e) {
      console.error('[PermisosService] loadSessionData error:', e);
      this.readySubject.next(true);
    }
  }

  private getTokenFromStorage(): string | null {
    return localStorage.getItem('token') || localStorage.getItem('auth_token');
  }

  // =====================================================
  // ENDPOINTS USUARIO ACTUAL
  // =====================================================

  obtenerMisPermisos(): Observable<{ permisos: Permiso[] }> {
    return this.http.get<{ permisos: Permiso[] }>(`${this.baseUrl}/me/permisos`).pipe(
      tap(response => {
        const codigosPermisos = (response.permisos || []).map(p => p.codigo);
        this.permisosSubject.next(codigosPermisos);
        localStorage.setItem('user_permissions', JSON.stringify(codigosPermisos));
      })
    );
  }

  obtenerMiMenu(): Observable<{ menu: MenuItem[] }> {
    return this.http.get<{ menu: MenuItem[] }>(`${this.baseUrl}/me/menu`).pipe(
      tap(response => {
        this.menuSubject.next(response.menu || []);
        localStorage.setItem('user_menu', JSON.stringify(response.menu || []));
      })
    );
  }

  // =====================================================
  // ✅ LOGIN INMEDIATO (SIN REFRESH)
  // =====================================================

  /**
   * Se llama justo después del /login para hidratar al instante.
   */
  setSessionData(permisos: string[] = [], menu: MenuItem[] = []): void {
    const safePermisos = Array.isArray(permisos) ? permisos : [];
    const safeMenu = Array.isArray(menu) ? menu : [];

    this.permisosSubject.next(safePermisos);
    this.menuSubject.next(safeMenu);

    localStorage.setItem('user_permissions', JSON.stringify(safePermisos));
    localStorage.setItem('user_menu', JSON.stringify(safeMenu));

    this.readySubject.next(true);
  }

  // =====================================================
  // VALIDACIONES
  // =====================================================

  tienePermiso(codigoPermiso: string): boolean {
    return this.permisosSubject.value.includes(codigoPermiso);
  }

  tieneAlgunPermiso(codigosPermisos: string[]): boolean {
    const permisos = this.permisosSubject.value;
    return codigosPermisos.some(codigo => permisos.includes(codigo));
  }

  tieneTodosPermisos(codigosPermisos: string[]): boolean {
    const permisos = this.permisosSubject.value;
    return codigosPermisos.every(codigo => permisos.includes(codigo));
  }

  // =====================================================
  // LOCALSTORAGE
  // =====================================================

  cargarPermisosDesdeLocalStorage(): void {
    const permisos = localStorage.getItem('user_permissions');
    const menu = localStorage.getItem('user_menu');

    if (permisos) {
      try { this.permisosSubject.next(JSON.parse(permisos)); } catch {}
    }

    if (menu) {
      try { this.menuSubject.next(JSON.parse(menu)); } catch {}
    }
  }

  limpiarPermisos(): void {
    this.permisosSubject.next([]);
    this.menuSubject.next([]);
    this.readySubject.next(false);
    localStorage.removeItem('user_permissions');
    localStorage.removeItem('user_menu');
  }

  // =====================================================
  // ADMIN
  // =====================================================

  obtenerRoles(): Observable<{ roles: Rol[] }> {
    return this.http.get<{ roles: Rol[] }>(`${this.baseUrl}/roles`);
  }

  crearRol(nombreRol: string, descripcion: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/roles`, { nombreRol, descripcion });
  }

  actualizarRol(idRol: number, nombreRol: string, descripcion: string, activo: number): Observable<any> {
    return this.http.put(`${this.baseUrl}/roles/${idRol}`, { nombreRol, descripcion, activo });
  }

  eliminarRol(idRol: number): Observable<any> {
    return this.http.delete(`${this.baseUrl}/roles/${idRol}`);
  }

  obtenerModulos(): Observable<{ modulos: Modulo[] }> {
    return this.http.get<{ modulos: Modulo[] }>(`${this.baseUrl}/modulos`);
  }

  obtenerPermisos(): Observable<{ permisos: PermisoCompleto[] }> {
    return this.http.get<{ permisos: PermisoCompleto[] }>(`${this.baseUrl}/permisos`);
  }

  obtenerPermisosPorRol(idRol: number): Observable<{ permisos: PermisoCompleto[] }> {
    return this.http.get<{ permisos: PermisoCompleto[] }>(`${this.baseUrl}/roles/${idRol}/permisos`);
  }

  asignarPermiso(idRol: number, idPermiso: number): Observable<any> {
    return this.http.post(`${this.baseUrl}/rol-permisos`, { idRol, idPermiso });
  }

  revocarPermiso(idRol: number, idPermiso: number): Observable<any> {
    return this.http.request('delete', `${this.baseUrl}/rol-permisos`, {
      body: { idRol, idPermiso }
    });
  }

  invalidarCache(userId?: number): Observable<any> {
    return this.http.post(`${this.baseUrl}/cache/invalidar`, { userId });
  }
}
