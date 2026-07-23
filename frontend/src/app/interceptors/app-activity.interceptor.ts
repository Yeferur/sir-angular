import { HttpContextToken, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { AppActivityService } from '../services/app-activity.service';

/** Permite excluir búsquedas incrementales, precargas o refrescos de fondo. */
export const SILENT_APP_ACTIVITY = new HttpContextToken<boolean>(() => false);

export const appActivityInterceptor: HttpInterceptorFn = (request, next) => {
  if (request.context.get(SILENT_APP_ACTIVITY)) return next(request);

  const finish = inject(AppActivityService).begin();
  return next(request).pipe(finalize(finish));
};
