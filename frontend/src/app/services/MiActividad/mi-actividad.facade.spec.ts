import {
  activityFeedCounts,
  contextualNotificationPriority,
  isDerivedActivityNotification,
  pendingActionLabel,
  planContextualBatch,
  reminderPresentationState,
} from './mi-actividad.facade';
import { SirNotification } from '../Notificaciones/notificaciones.service';
import { OperationalPending, PersonalReminder } from '../Pendientes/pendientes.service';

describe('MiActividadFacade: proyección del feed', () => {
  const now = new Date('2026-09-26T15:00:00.000Z').getTime();
  const reminder = (overrides: Partial<PersonalReminder> = {}): PersonalReminder => ({
    idRecordatorio: '7', titulo: 'Prueba', descripcion: null,
    fecha: '2026-09-26T16:00:00.000Z', recurrencia: null, intervalo: null,
    recordarTodoElDia: false, intervaloTodoElDia: null, enviarCorreo: false,
    siguienteTrigger: '2026-09-26T16:00:00.000Z', estado: 'ACTIVO',
    suprimidoHasta: null, estaSuprimido: false, entidadTipo: null, entidadId: null,
    fechaCreacion: '', fechaActualizacion: '', ...overrides,
  });
  const pending = (overrides: Partial<OperationalPending> = {}): OperationalPending => ({
    idPendiente: '5', regla: 'TEST', entidadTipo: 'RESERVA', entidadId: '10', titulo: 'Reserva',
    descripcion: null, prioridad: 'MEDIA', estado: 'ACTIVO', fechaOperacion: null, fechaLimite: null,
    suprimidoHasta: null, estaSuprimido: false, siguienteRecordatorio: null, permiteDescarte: false,
    requiereJustificacion: false, posposicionMaxMinutos: null, primeraDeteccion: '', ultimaDeteccion: '', datos: null,
    ...overrides,
  });
  const notification = (overrides: Partial<SirNotification> = {}): SirNotification => ({
    idNotificacion: '90', tipo: 'APP_UPDATE', titulo: 'Novedad', mensaje: '', entidadTipo: null,
    entidadId: null, datos: null, leida: false, fechaLectura: null, fechaCreacion: '', ...overrides,
  });

  it('mantiene un recordatorio futuro consultable sin sumarlo al badge', () => {
    const future = reminder();
    expect(reminderPresentationState(future, now)).toBe('PROGRAMADO');
    expect(activityFeedCounts([], [future], [], now)).toEqual({
      todos: 1, pendientes: 0, recordatorios: 1, novedades: 0, badge: 0,
    });
  });

  it('al vencer usa una sola tarjeta y no duplica su notificación derivada', () => {
    const due = reminder({ siguienteTrigger: '2026-09-26T14:00:00.000Z' });
    const derived = notification({ tipo: 'RECORDATORIO', entidadTipo: 'RECORDATORIO', entidadId: '7' });
    expect(reminderPresentationState(due, now)).toBe('ATENDER');
    expect(isDerivedActivityNotification(derived)).toBeTrue();
    expect(activityFeedCounts([], [due], [derived], now)).toEqual({
      todos: 1, pendientes: 0, recordatorios: 1, novedades: 0, badge: 1,
    });
  });

  it('fusiona pendiente y notificación asociada y conserva novedades independientes', () => {
    const associated = notification({ tipo: 'PENDIENTE', datos: { pendienteId: '5' } });
    const independent = notification();
    expect(activityFeedCounts([pending()], [], [associated, independent], now)).toEqual({
      todos: 2, pendientes: 1, recordatorios: 0, novedades: 1, badge: 1,
    });
  });

  it('usa acciones contextuales para reserva, programación y comisiones', () => {
    expect(pendingActionLabel(pending())).toBe('Ver reserva');
    expect(pendingActionLabel(pending({ entidadTipo: 'PROGRAMACION_CAMBIO' }))).toBe('Revisar cambios');
    expect(pendingActionLabel(pending({ entidadTipo: 'OPERACION', entidadId: 'commissions', datos: { ruta: '/Comisiones' } }))).toBe('Ver comisiones');
  });

  it('resume una ráfaga de cinco avisos y conserva el orden de prioridad', () => {
    const burst = [
      notification({ idNotificacion: '1', tipo: 'PENDIENTE', datos: { prioridad: 'MEDIA' } }),
      notification({ idNotificacion: '2', tipo: 'RECORDATORIO' }),
      notification({ idNotificacion: '3', tipo: 'PENDIENTE', datos: { prioridad: 'CRITICA' } }),
      notification({ idNotificacion: '4', tipo: 'APP_UPDATE' }),
      notification({ idNotificacion: '5', tipo: 'PENDIENTE', datos: { prioridad: 'ALTA' } }),
    ];
    const plan = planContextualBatch(burst);
    expect(plan.summary).toBeTrue();
    expect(plan.notifications.map(item => item.idNotificacion)).toEqual(['3', '2', '5', '1', '4']);
    expect(contextualNotificationPriority(plan.notifications[0])).toBe(4);
  });
});
