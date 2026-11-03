import { SirNotification, notificationDisplayTitle, rejectedOperationTarget } from './notificaciones.service';

describe('Título de novedades de SIR', () => {
  const update = (version: string): SirNotification => ({
    idNotificacion: version,
    tipo: 'APP_UPDATE',
    titulo: 'SIR tiene una nueva actualización',
    mensaje: '',
    entidadTipo: 'APP_UPDATE',
    entidadId: version,
    datos: { version },
    leida: false,
    fechaLectura: null,
    fechaCreacion: '',
  });

  it('distingue las dos versiones históricas sin alterar sus datos', () => {
    expect(notificationDisplayTitle(update('v1.2.0-beta'))).toBe('SIR tiene una nueva actualización · v1.2.0-beta');
    expect(notificationDisplayTitle(update('v1.3.0-beta'))).toBe('SIR tiene una nueva actualización · v1.3.0-beta');
  });

  it('no agrega la versión dos veces si ya figura en el título', () => {
    const item = update('v1.4.0');
    item.titulo += ' · v1.4.0';
    expect(notificationDisplayTitle(item)).toBe(item.titulo);
  });
});

describe('Destino de avisos por rechazo de entidad', () => {
  const rejected = (datos: Record<string, unknown>): SirNotification => ({
    idNotificacion: '1', tipo: 'ENTIDAD_REPORTANTE_RECHAZADA', titulo: '', mensaje: '',
    entidadTipo: 'ENTIDAD_REPORTANTE_RECHAZADA', entidadId: 'evento-1', datos,
    leida: false, fechaLectura: null, fechaCreacion: '',
  });

  it('usa el tipo e ID explícitos para abrir la operación en su drawer global', () => {
    expect(rejectedOperationTarget(rejected({ operacionTipo: 'RESERVA', operacionId: 'R 1' })))
      .toEqual({ type: 'RESERVA', id: 'R 1' });
  });

  it('reconoce los enlaces actuales de edición como destino de reserva o transfer', () => {
    expect(rejectedOperationTarget(rejected({ ruta: '/Transfers/EditarTransfer/31' })))
      .toEqual({ type: 'TRANSFER', id: '31' });
    expect(rejectedOperationTarget(rejected({ route: '/Reservas/EditarReserva/R%201' })))
      .toEqual({ type: 'RESERVA', id: 'R 1' });
  });
});
