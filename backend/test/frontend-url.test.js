const test = require('node:test');
const assert = require('node:assert/strict');

const { buildFrontendUrl, getFrontendBaseUrl } = require('../utils/frontend-url');

test('construye enlaces únicamente sobre el origen HTTP(S) configurado', () => {
  const env = { FRONTEND_URL: 'https://sir.viajesmaxitours.co/configuracion?origen=correo' };
  assert.equal(getFrontendBaseUrl(env), 'https://sir.viajesmaxitours.co');
  assert.equal(
    buildFrontendUrl('/MiHorario', env),
    'https://sir.viajesmaxitours.co/MiHorario'
  );
});

test('rechaza URL relativa, protocolos inseguros y credenciales embebidas', () => {
  for (const value of [
    'sir.viajesmaxitours.co',
    'ftp://sir.viajesmaxitours.co',
    'https://usuario:secreto@sir.viajesmaxitours.co',
  ]) {
    assert.throws(
      () => getFrontendBaseUrl({ FRONTEND_URL: value, NODE_ENV: 'production' }),
      (error) => error.code === 'FRONTEND_URL_INVALID'
    );
  }
});

test('exige FRONTEND_URL en producción y conserva localhost sólo para desarrollo', () => {
  assert.throws(
    () => getFrontendBaseUrl({ NODE_ENV: 'production' }),
    (error) => error.code === 'FRONTEND_URL_INVALID'
  );
  assert.equal(getFrontendBaseUrl({ NODE_ENV: 'development' }), 'http://localhost:4200');
});

test('exige HTTPS en producción aunque la URL HTTP sea absoluta', () => {
  assert.throws(
    () => getFrontendBaseUrl({
      NODE_ENV: 'production',
      FRONTEND_URL: 'http://sir.viajesmaxitours.co',
    }),
    (error) => error.code === 'FRONTEND_URL_INVALID'
  );
});
