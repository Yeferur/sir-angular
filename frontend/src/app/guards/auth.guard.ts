import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/Login/login-service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const token = auth.getToken();
  const user = auth.getUser();
  const isTokenValid = !!token && !!user?.exp && Date.now() < user.exp * 1000;

  if (isTokenValid) {
    return true;
  }

  // `/` comparte el punto de entrada del login en App. Permitir su
  // activaciÃ³n anÃ³nima evita un ciclo `/` -> `/` mientras el shell pÃºblico
  // muestra el formulario; el acceso privado sigue bloqueado por
  // `viewLoggedIn` y por los guards de las rutas protegidas.
  if (state.url === '/') {
    return true;
  }

  router.navigateByUrl('/');
  return false;
};
