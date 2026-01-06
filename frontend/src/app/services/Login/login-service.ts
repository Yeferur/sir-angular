import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DynamicIslandGlobalService } from '../DynamicNavbar/global';
import { jwtDecode } from 'jwt-decode';
import { PermisosService, MenuItem } from '../Permisos/permisos.service';

interface JwtPayload {
  id: string;
  username: string;
  name: string;
  apellidos: string;
  email: string;
  exp: number;
}

interface LoginResponse {
  token: string;
  permisos?: string[];
  menu?: MenuItem[];
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  public apiUrl = environment.apiUrl;
  private loggedIn$ = new BehaviorSubject<boolean>(this.hasToken());
  private logoutTimer: any;

  constructor(
    private http: HttpClient,
    private navbar: DynamicIslandGlobalService,
    private permisosService: PermisosService
  ) {
    this.initSessionFromStorage();
  }

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.apiUrl}/login`, { username, password }).pipe(
      tap(response => {
        // ✅ token
        this.setSession(response.token);

        // ✅ permisos + menú inmediato (sin refresh)
        this.permisosService.setSessionData(
          response.permisos || [],
          response.menu || []
        );
      })
    );
  }

  private setSession(token: string) {
    localStorage.setItem('token', token);
    const payload = this.decodeToken(token);

    if (payload?.exp) {
      const expiresInMs = (payload.exp * 1000) - Date.now();
      if (this.logoutTimer) clearTimeout(this.logoutTimer);

      this.logoutTimer = setTimeout(() => {
        this.logout();
      }, expiresInMs);
    }

    this.loggedIn$.next(true);
  }

  logout(): void {
    this.logoutRequest().subscribe({
      next: () => this.clearSession(),
      error: () => this.clearSession()
    });
  }

  private logoutRequest(): Observable<any> {
    const token = this.getToken();
    if (!token) {
      return new Observable(observer => observer.complete());
    }

    const userId = this.getUser()?.id;
    if (!userId) {
      return new Observable(observer => {
        observer.error('No se pudo obtener userId del token.');
        observer.complete();
      });
    }

    return this.http.post(`${this.apiUrl}/logout`, { userId }, {
      headers: this.getAuthHeaders()
    });
  }

  private clearSession() {
    localStorage.removeItem('token');

    // ✅ limpiar permisos + menú también
    this.permisosService.limpiarPermisos();

    this.loggedIn$.next(false);
    this.navbar.mode.set('login');

    if (this.logoutTimer) clearTimeout(this.logoutTimer);
  }

  isLoggedIn(): Observable<boolean> {
    return this.loggedIn$.asObservable();
  }

  private hasToken(): boolean {
    return !!localStorage.getItem('token');
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  getUser(): JwtPayload | null {
    const token = this.getToken();
    return token ? this.decodeToken(token) : null;
  }

  private decodeToken(token: string): JwtPayload {
    try {
      return jwtDecode<JwtPayload>(token);
    } catch (error) {
      console.error('Error decodificando token:', error);
      return null;
    }
  }

  private initSessionFromStorage() {
    const token = this.getToken();
    if (token) {
      const payload = this.decodeToken(token);
      if (payload?.exp && Date.now() < payload.exp * 1000) {
        this.setSession(token);

        // ✅ rehidratar permisos/menu de storage o backend
        // rápido: storage
        this.permisosService.cargarPermisosDesdeLocalStorage();

        // si quieres refrescar desde backend:
        // this.permisosService.loadSessionData({ token }).catch(() => {});
      } else {
        this.clearSession();
      }
    }
  }

  getAuthHeaders(): HttpHeaders {
    return new HttpHeaders({
      Authorization: `Bearer ${this.getToken()}`
    });
  }
}
