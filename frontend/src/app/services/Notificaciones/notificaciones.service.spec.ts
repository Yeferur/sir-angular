import { SirNotification, notificationDisplayTitle } from './notificaciones.service';

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
