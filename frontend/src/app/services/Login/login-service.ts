import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DynamicIslandGlobalService } from '../DynamicNavbar/global';
import { jwtDecode } from 'jwt-decode';

// La interfaz con lo que quieras incluir en tu JWT
interface JwtPayload {
  id: string;
  username: string;
  name: string;
  apellidos: string;
  email: string;
  exp: number; // Timestamp UNIX
}

interface LoginResponse {
  token: string;
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
    private navbar: DynamicIslandGlobalService
  ) {
    this.initSessionFromStorage();
  }

  /**
   * Inicia sesión
   */
  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.apiUrl}/login`, { username, password }).pipe(
      tap(response => {
        this.setSession(response.token);
      })
    );
  }

  /**
   * Guarda token, programa logout y notifica
   */
  private setSession(token: string) {
    localStorage.setItem('token', token);
    const payload = this.decodeToken(token);

    if (payload?.exp) {
      const expiresInMs = (payload.exp * 1000) - Date.now();
      console.log(`⏰ Token expira en ${Math.round(expiresInMs / 1000)} segundos`);

      if (this.logoutTimer) {
        clearTimeout(this.logoutTimer);
      }
      this.logoutTimer = setTimeout(() => {
        this.logout();
      }, expiresInMs);
    }

    this.loggedIn$.next(true);
  }

  /**
   * Cierra sesión desde la UI: hace logout en backend y limpia todo
   */
  logout(): void {
    this.logoutRequest().subscribe({
      next: () => {
        console.log('✅ Sesión cerrada en backend');
        this.clearSession();
      },
      error: (err) => {
        console.error('⚠️ Error cerrando sesión en backend', err);
        this.clearSession(); // Igualmente limpiar local
      }
    });
  }

  /**
   * Hace request al backend para cerrar sesión
   */
  private logoutRequest(): Observable<any> {
    const token = this.getToken();
    if (!token) {
      return new Observable(observer => {
        observer.complete();
      });
    }

    // Sacamos userId del token decodificado
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


  /**
   * Limpia almacenamiento local, notifica y resetea timers
   */
  private clearSession() {
    localStorage.removeItem('token');
    this.loggedIn$.next(false);
    this.navbar.mode.set('login');
    if (this.logoutTimer) {
      clearTimeout(this.logoutTimer);
    }
  }

  /**
   * Retorna observable del estado de autenticación
   */
  isLoggedIn(): Observable<boolean> {
    return this.loggedIn$.asObservable();
  }

  /**
   * Verifica si hay token
   */
  private hasToken(): boolean {
    return !!localStorage.getItem('token');
  }

  /**
   * Obtiene el token
   */
  getToken(): string | null {
    return localStorage.getItem('token');
  }

  /**
   * Devuelve datos del usuario decodificados
   */
  getUser(): JwtPayload | null {
    const token = this.getToken();
    return token ? this.decodeToken(token) : null;
  }

  /**
   * Decodifica un JWT
   */
  private decodeToken(token: string): JwtPayload {
    try {
      return jwtDecode<JwtPayload>(token);
    } catch (error) {
      console.error('Error decodificando token:', error);
      return null;
    }
  }

  /**
   * Si hay token al cargar, reactiva sesión
   */
  private initSessionFromStorage() {
    const token = this.getToken();
    if (token) {
      const payload = this.decodeToken(token);
      if (payload?.exp && Date.now() < payload.exp * 1000) {
        this.setSession(token);
      } else {
        this.clearSession();
      }
    }
  }

  /**
   * Headers con token
   */
  getAuthHeaders(): HttpHeaders {
    return new HttpHeaders({
      Authorization: `Bearer ${this.getToken()}`
    });
  }
}
