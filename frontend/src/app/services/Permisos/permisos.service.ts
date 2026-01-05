import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
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
  
  // Observable para permisos del usuario actual
  private permisosSubject = new BehaviorSubject<string[]>([]);
  public permisos$ = this.permisosSubject.asObservable();
  
  // Observable para menú del usuario actual
  private menuSubject = new BehaviorSubject<MenuItem[]>([]);
  public menu$ = this.menuSubject.asObservable();

  constructor(private http: HttpClient) {}

  /**
   * Obtener permisos del usuario actual
   */
  obtenerMisPermisos(): Observable<{ permisos: Permiso[] }> {
    return this.http.get<{ permisos: Permiso[] }>(`${this.baseUrl}/me/permisos`).pipe(
      tap(response => {
        const codigosPermisos = response.permisos.map(p => p.codigo);
        this.permisosSubject.next(codigosPermisos);
        
        // Guardar en localStorage para persistencia
        localStorage.setItem('user_permissions', JSON.stringify(codigosPermisos));
      })
    );
  }

  /**
   * Obtener menú dinámico del usuario actual
   */
  obtenerMiMenu(): Observable<{ menu: MenuItem[] }> {
    return this.http.get<{ menu: MenuItem[] }>(`${this.baseUrl}/me/menu`).pipe(
      tap(response => {
        this.menuSubject.next(response.menu);
        
        // Guardar en localStorage para persistencia
        localStorage.setItem('user_menu', JSON.stringify(response.menu));
      })
    );
  }

  /**
   * Verificar si el usuario tiene un permiso específico
   */
  tienePermiso(codigoPermiso: string): boolean {
    const permisos = this.permisosSubject.value;
    return permisos.includes(codigoPermiso);
  }

  /**
   * Verificar si el usuario tiene al menos uno de varios permisos
   */
  tieneAlgunPermiso(codigosPermisos: string[]): boolean {
    const permisos = this.permisosSubject.value;
    return codigosPermisos.some(codigo => permisos.includes(codigo));
  }

  /**
   * Verificar si el usuario tiene todos los permisos especificados
   */
  tieneTodosPermisos(codigosPermisos: string[]): boolean {
    const permisos = this.permisosSubject.value;
    return codigosPermisos.every(codigo => permisos.includes(codigo));
  }

  /**
   * Cargar permisos y menú desde localStorage (útil al iniciar la app)
   */
  cargarPermisosDesdeLocalStorage(): void {
    const permisos = localStorage.getItem('user_permissions');
    const menu = localStorage.getItem('user_menu');
    
    if (permisos) {
      this.permisosSubject.next(JSON.parse(permisos));
    }
    
    if (menu) {
      this.menuSubject.next(JSON.parse(menu));
    }
  }

  /**
   * Limpiar permisos y menú (útil al cerrar sesión)
   */
  limpiarPermisos(): void {
    this.permisosSubject.next([]);
    this.menuSubject.next([]);
    localStorage.removeItem('user_permissions');
    localStorage.removeItem('user_menu');
  }

  // =====================================================
  // Endpoints de administración (solo para admins)
  // =====================================================

  /**
   * Obtener todos los roles
   */
  obtenerRoles(): Observable<{ roles: Rol[] }> {
    return this.http.get<{ roles: Rol[] }>(`${this.baseUrl}/roles`);
  }

  /**
   * Crear nuevo rol
   */
  crearRol(nombreRol: string, descripcion: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/roles`, { nombreRol, descripcion });
  }

  /**
   * Actualizar rol existente
   */
  actualizarRol(idRol: number, nombreRol: string, descripcion: string, activo: number): Observable<any> {
    return this.http.put(`${this.baseUrl}/roles/${idRol}`, { nombreRol, descripcion, activo });
  }

  /**
   * Eliminar rol
   */
  eliminarRol(idRol: number): Observable<any> {
    return this.http.delete(`${this.baseUrl}/roles/${idRol}`);
  }

  /**
   * Obtener todos los módulos
   */
  obtenerModulos(): Observable<{ modulos: Modulo[] }> {
    return this.http.get<{ modulos: Modulo[] }>(`${this.baseUrl}/modulos`);
  }

  /**
   * Obtener todos los permisos disponibles
   */
  obtenerPermisos(): Observable<{ permisos: PermisoCompleto[] }> {
    return this.http.get<{ permisos: PermisoCompleto[] }>(`${this.baseUrl}/permisos`);
  }

  /**
   * Obtener permisos de un rol específico
   */
  obtenerPermisosPorRol(idRol: number): Observable<{ permisos: PermisoCompleto[] }> {
    return this.http.get<{ permisos: PermisoCompleto[] }>(`${this.baseUrl}/roles/${idRol}/permisos`);
  }

  /**
   * Asignar permiso a un rol
   */
  asignarPermiso(idRol: number, idPermiso: number): Observable<any> {
    return this.http.post(`${this.baseUrl}/rol-permisos`, { idRol, idPermiso });
  }

  /**
   * Revocar permiso de un rol
   */
  revocarPermiso(idRol: number, idPermiso: number): Observable<any> {
    return this.http.request('delete', `${this.baseUrl}/rol-permisos`, {
      body: { idRol, idPermiso }
    });
  }

  /**
   * Invalidar cache de permisos (útil después de cambiar roles/permisos)
   */
  invalidarCache(userId?: number): Observable<any> {
    return this.http.post(`${this.baseUrl}/cache/invalidar`, { userId });
  }
}
