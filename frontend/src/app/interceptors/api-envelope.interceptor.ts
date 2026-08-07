import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { catchError, map, Observable, throwError } from 'rxjs';
import { sanitizeUserErrorMessage, toUserErrorMessage } from '../shared/errors/user-error-message';

type ApiEnvelope<T = unknown> = {
  success: boolean;
  data: T;
  message?: string;
  errorCode?: string;
};

function isApiEnvelope(value: unknown): value is ApiEnvelope {
  if (!value || typeof value !== 'object') return false;
  return 'success' in value && 'data' in value;
}

function getFriendlyErrorMessage(errorCode?: string, fallback?: string): string {
  const byCode: Record<string, string> = {
    OVERBOOKING_CONFLICT: 'No hay cupos suficientes para este tour en la fecha seleccionada.',
    TOUR_RULE_INFANTE_NOT_ALLOWED: 'Este tour no permite infantes. Ajusta los pasajeros para continuar.',
    TOUR_RULE_MIN_AGE: 'La edad minima para ninos en este tour no se cumple.',
    RESERVA_NOT_FOUND: 'No se encontro la reserva solicitada.',
    PUNTO_DUPLICATE_EXACT: 'Ya existe un punto con ese nombre y esa direccion.',
    AUDIT_REQUIRED: 'No fue posible registrar la auditoria del cambio. Intenta nuevamente.',
    BAD_REQUEST: 'La solicitud tiene datos invalidos. Revisa el formulario.',
    ADVISOR_NOT_FOUND: 'El usuario no existe o ya no tiene el rol Asesor.',
    ADVISOR_ONLY: 'Esta información está disponible únicamente para asesores.',
    ADMIN_ONLY: 'Solo los administradores autorizados pueden gestionar turnos.',
    INVALID_SCHEDULE: 'La jornada debe incluir los siete días de la semana.',
    INVALID_SCHEDULE_DAY: 'La jornada contiene días inválidos o repetidos.',
    INVALID_SCHEDULE_TIME: 'Revisa las horas de entrada y salida.',
    INVALID_SCHEDULE_RANGE: 'La salida debe ser posterior a la entrada.',
    SCHEDULE_AFTER_11PM: 'La salida máxima permitida es a las 11:00 p. m.',
    INTERNAL_ERROR: 'Ocurrio un error del servidor. Intenta de nuevo en unos minutos.',
  };

  if (errorCode && byCode[errorCode]) {
    return byCode[errorCode];
  }

  return sanitizeUserErrorMessage(
    fallback,
    'No se pudo completar la operación solicitada.'
  );
}

export const apiEnvelopeInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  return next(req).pipe(
    map((event) => {
      if (!(event instanceof HttpResponse)) return event;

      const body = event.body;
      if (!isApiEnvelope(body)) return event;

      if (body.success === true) {
        return event.clone({ body: body.data });
      }

      const friendlyMessage = getFriendlyErrorMessage(body.errorCode, body.message);
      throw new HttpErrorResponse({
        status: 400,
        statusText: 'Bad Request',
        url: event.url || req.url,
        error: {
          ...body,
          message: friendlyMessage,
        },
      });
    }),
    catchError((error: HttpErrorResponse) => {
      const envelope = isApiEnvelope(error?.error) ? error.error : null;
      const errorCode = envelope?.errorCode;
      const fallback = envelope?.message || error?.error?.message || error?.message;

      const friendlyMessage = errorCode || envelope
        ? getFriendlyErrorMessage(errorCode, fallback)
        : toUserErrorMessage(error);
      const errorBody = error?.error && typeof error.error === 'object'
        ? error.error
        : {};

      return throwError(
        () =>
          new HttpErrorResponse({
            status: error.status || 0,
            statusText: error.statusText || 'Request failed',
            url: error.url || req.url,
            error: {
              ...errorBody,
              message: friendlyMessage,
            },
          })
      );
    })
  );
};
