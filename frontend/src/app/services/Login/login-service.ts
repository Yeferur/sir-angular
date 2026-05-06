import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, from, switchMap } from 'rxjs';
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

interface GenericMessageResponse {
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  public apiUrl = environment.apiUrl;
  private loggedIn$ = new BehaviorSubject<boolean>(false);
  private sessionBootstrapping$ = new BehaviorSubject<boolean>(false);
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
      switchMap((response) => from(this.prepareSession(response)))
    );
  }

  forgotPassword(email: string): Observable<GenericMessageResponse> {
    return this.http.post<GenericMessageResponse>(`${this.apiUrl}/auth/forgot-password`, { email });
  }

  resetPassword(token: string, password: string): Observable<GenericMessageResponse> {
    return this.http.post<GenericMessageResponse>(`${this.apiUrl}/auth/reset-password`, { token, password });
  }

private setSession(token: string) {
  localStorage.setItem('token', token);
  const payload = this.decodeToken(token);

  if (payload?.exp) {
    const expiresInMs = (payload.exp * 1000) - Date.now();

    if (this.logoutTimer) {
      clearTimeout(this.logoutTimer);
    }

    if (expiresInMs <= 0) {
      this.logout();
      return;
    }

    const MAX_SAFE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
    const timeoutMs = Math.min(expiresInMs, MAX_SAFE_TIMEOUT_MS);

    this.logoutTimer = setTimeout(() => {
      const currentToken = this.getToken();
      const currentPayload = currentToken ? this.decodeToken(currentToken) : null;

      if (!currentPayload?.exp || Date.now() >= currentPayload.exp * 1000) {
        this.logout();
        return;
      }

      this.setSession(currentToken);
    }, timeoutMs);
  }
}

  private async prepareSession(response: LoginResponse): Promise<LoginResponse> {
    const token = response?.token;
    if (!token) {
      throw new Error('SESSION_PREPARATION_FAILED');
    }

    this.sessionBootstrapping$.next(true);

    try {
      this.setSession(token);

      this.permisosService.setSessionData(
        response.permisos || [],
        response.menu || []
      );

      const loaded = await this.permisosService.loadSessionData({ token });
      if (!loaded) {
        throw new Error('SESSION_PREPARATION_FAILED');
      }

      this.loggedIn$.next(true);
      return response;
    } catch (error) {
      this.clearLocalSession();
      throw error;
    } finally {
      this.sessionBootstrapping$.next(false);
    }
  }

  logout(): void {
    if (!this.getToken()) {
      this.clearLocalSession();
      return;
    }

    this.logoutRequest().subscribe({
      next: () => this.clearLocalSession(),
      error: () => this.clearLocalSession()
    });
  }

  private logoutRequest(): Observable<any> {
    if (!this.getToken()) {
      return new Observable(observer => observer.complete());
    }

    return this.http.post(`${this.apiUrl}/logout`, {}, {
      headers: this.getAuthHeaders()
    });
  }

  logoutAllSessions(): Observable<GenericMessageResponse> {
    if (!this.getToken()) {
      return new Observable<GenericMessageResponse>(observer => observer.complete());
    }

    return this.http.post<GenericMessageResponse>(`${this.apiUrl}/logout/all`, {}, {
      headers: this.getAuthHeaders()
    });
  }

  clearLocalSession() {
    localStorage.removeItem('token');
    localStorage.removeItem('auth_token');

    // ✅ limpiar permisos + menú también
    this.permisosService.limpiarPermisos();

    this.loggedIn$.next(false);
    this.sessionBootstrapping$.next(false);
    this.navbar.mode.set('login');

    if (this.logoutTimer) clearTimeout(this.logoutTimer);
  }

  isLoggedIn(): Observable<boolean> {
    return this.loggedIn$.asObservable();
  }

  isSessionBootstrapping(): Observable<boolean> {
    return this.sessionBootstrapping$.asObservable();
  }

  private hasToken(): boolean {
    return !!this.getToken();
  }

  getToken(): string | null {
    return localStorage.getItem('token') || localStorage.getItem('auth_token');
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
        void this.restoreSessionFromToken(token);
      } else {
        this.clearLocalSession();
      }
    }
  }

  private async restoreSessionFromToken(token: string): Promise<void> {
    this.sessionBootstrapping$.next(true);

    try {
      this.setSession(token);
      const loaded = await this.permisosService.loadSessionData({ token });
      if (!loaded) {
        throw new Error('SESSION_PREPARATION_FAILED');
      }
      this.loggedIn$.next(true);
    } catch (error) {
      this.clearLocalSession();
    } finally {
      this.sessionBootstrapping$.next(false);
    }
  }

  getAuthHeaders(): HttpHeaders {
    return new HttpHeaders({
      Authorization: `Bearer ${this.getToken()}`
    });
  }
}
