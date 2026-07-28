import { Injectable, signal } from "@angular/core";
import { WebSocketService } from "../WebSocket/web-socket";
import { HttpClient } from "@angular/common/http";
import { environment } from "../../../environments/environment";
import { Observable, Subject, of } from "rxjs";
import { catchError, finalize, switchMap, takeUntil } from "rxjs/operators";

export type EstadoSesion = 'activa' | 'inactiva' | 'cerrada';

export interface Usuario {
  id_user: string;
  username: string;
  name: string;
  apellidos: string;
  email: string;
  activo: boolean;
  rol: string;
}

@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private usuarios = signal<Usuario[]>([]);
  private estados = signal<Map<string, EstadoSesion>>(new Map());
  private cargando = signal(false);
  private errorCarga = signal<string | null>(null);
  private reload$ = new Subject<void>();
  private destroy$ = new Subject<void>();
  private usuariosConectados = new Set<string>();
  private hasPresenceSnapshot = false;

  constructor(
    private ws: WebSocketService,
    private http: HttpClient
  ) {
    this.reload$
      .pipe(
        switchMap(() => {
          this.cargando.set(true);
          this.errorCarga.set(null);
          return this.obtenerUsuariosYSesiones().pipe(
            catchError((error) => {
              this.errorCarga.set(error?.error?.message || error?.error?.error || 'No se pudieron cargar los usuarios.');
              return of(null);
            }),
            finalize(() => this.cargando.set(false))
          );
        }),
        takeUntil(this.destroy$)
      )
      .subscribe((data) => {
        if (data) this.aplicarUsuariosYSesiones(data.usuarios, data.sesiones);
      });

    this.recargar();

    // Escuchar WebSocket
    this.ws.presenceEvents$.subscribe(msg => {
      if (msg.type === 'usuarios_conectados_actualizados') {
        this.hasPresenceSnapshot = true;
        this.usuariosConectados = new Set((msg.usuarios || []).map((id: unknown) => String(id)));
        this.recargar();
      }
    });
  }

  private obtenerUsuariosYSesiones(): Observable<{ usuarios: Usuario[]; sesiones: { id_user: string }[] }> {
    return this.http.get<{ usuarios: Usuario[]; sesiones: { id_user: string }[] }>(
      `${environment.apiUrl}/usuarios-sesiones`
    );
  }

  private aplicarUsuariosYSesiones(usuarios: Usuario[], sesiones: { id_user: string }[]): void {
    const sesionesActivas = new Set((sesiones || []).map((sesion) => String(sesion.id_user)));
    const estadosMap = new Map<string, EstadoSesion>();

    for (const user of usuarios || []) {
      const id = String(user.id_user);
      if (!user.activo || !sesionesActivas.has(id)) {
        estadosMap.set(id, 'cerrada');
      } else if (this.hasPresenceSnapshot && !this.usuariosConectados.has(id)) {
        estadosMap.set(id, 'inactiva');
      } else {
        estadosMap.set(id, 'activa');
      }
    }

    this.usuarios.set(usuarios || []);
    this.estados.set(estadosMap);
  }

  recargar(): void {
    this.reload$.next();
  }

  getUsuariosSignal() {
    return this.usuarios;
  }

  getEstadosSignal() {
    return this.estados;
  }

  getCargandoSignal() {
    return this.cargando;
  }

  getErrorCargaSignal() {
    return this.errorCarga;
  }

  // Forzar cierre de sesión (solo admin)
  forzarCierreSesion(userId: string): Observable<any> {
    return this.http.post(`${environment.apiUrl}/forceLogout`, { userId });
  }

  // Crear usuario (admin). If payload is FormData, post as multipart/form-data
  crearUsuario(payload: any): Observable<any> {
    if (payload instanceof FormData) {
      return this.http.post(`${environment.apiUrl}/usuarios`, payload);
    }
    return this.http.post(`${environment.apiUrl}/usuarios`, payload);
  }

  // Obtener usuario por ID
  obtenerUsuario(id: string): Observable<any> {
    return this.http.get(`${environment.apiUrl}/usuarios/${id}`);
  }

  // Obtener perfil del usuario autenticado
  getMiPerfil(): Observable<any> {
    return this.http.get(`${environment.apiUrl}/perfil`);
  }

  // Actualizar perfil del usuario autenticado (campos seguros)
  actualizarMiPerfil(payload: {
    Nombres_Apellidos: string;
    Telefono_Usuario?: string | null;
    Correo: string;
    Contrasena?: string;
    Contrasena_Actual?: string;
  }): Observable<any> {
    return this.http.put(`${environment.apiUrl}/perfil`, payload);
  }

  // Actualizar usuario
  actualizarUsuario(id: string, payload: any): Observable<any> {
    return this.http.put(`${environment.apiUrl}/usuarios/${id}`, payload);
  }

  // Eliminar usuario
  eliminarUsuario(id: string): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/usuarios/${id}`);
  }

  marcarUsuarioInactivo(id: string): { user: Usuario | null; estado: EstadoSesion | undefined; index: number } {
    const currentUsers = this.usuarios();
    const index = currentUsers.findIndex((u) => String(u.id_user) === String(id));
    if (index < 0) {
      return { user: null, estado: undefined, index: -1 };
    }

    const user = currentUsers[index];
    const estado = this.estados().get(String(id));

    this.usuarios.update((list) => list.map((u) => (
      String(u.id_user) === String(id) ? { ...u, activo: false } : u
    )));
    this.estados.update((map) => {
      const next = new Map(map);
      next.set(String(id), 'cerrada');
      return next;
    });

    return { user, estado, index };
  }

  restoreUsuarioInSignal(user: Usuario, estado: EstadoSesion | undefined, index = -1): void {
    this.usuarios.update((list) => {
      const next = list.filter((item) => String(item.id_user) !== String(user.id_user));
      if (index >= 0 && index <= next.length) {
        next.splice(index, 0, user);
      } else {
        next.push(user);
      }
      return next;
    });

    this.estados.update((map) => {
      const next = new Map(map);
      next.set(String(user.id_user), estado || 'inactiva');
      return next;
    });
  }

  // 🎥 Avatar methods

  /**
   * Upload profile photo (FormData with 'avatar' field)
   */
  uploadAvatar(formData: FormData): Observable<any> {
    return this.http.post(`${environment.apiUrl}/perfil/foto`, formData);
  }

  /**
   * Delete profile photo
   */
  deleteAvatar(): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/perfil/foto`);
  }

}
