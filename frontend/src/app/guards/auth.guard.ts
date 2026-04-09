import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/Login/login-service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const token = auth.getToken();
  const user = auth.getUser();
  const isTokenValid = !!token && !!user?.exp && Date.now() < user.exp * 1000;

  if (isTokenValid) {
    return true;
  }

  router.navigateByUrl('/');
  return false;
};
