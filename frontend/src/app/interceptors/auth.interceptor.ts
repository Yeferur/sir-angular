import { HttpInterceptorFn } from '@angular/common/http';
import { throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('token') || localStorage.getItem('auth_token');

  let request = req;

  const isAuthRequest =
    req.url.endsWith('/login') ||
    req.url.includes('/auth/forgot-password') ||
    req.url.includes('/auth/reset-password');

  if (token && req.url.startsWith(environment.apiUrl) && !isAuthRequest) {
    request = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  return next(request).pipe(
    catchError((error) => {
      if (error.status === 401 && !isAuthRequest) {
        localStorage.removeItem('token');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_permissions');
        localStorage.removeItem('user_menu');
      }
      return throwError(() => error);
    })
  );
};
