const test = require('node:test');
const assert = require('node:assert/strict');

const { isStrongPassword } = require('../utils/password-policy');

test('la política compartida exige longitud, minúscula, mayúscula, número y símbolo', () => {
  for (const weak of [
    'Aa1!aaa',
    'AAAAAAAA1!',
    'aaaaaaaa1!',
    'Aaaaaaaa!!',
    'Aaaaaaaa11',
  ]) {
    assert.equal(isStrongPassword(weak), false, weak);
  }
  assert.equal(isStrongPassword('S1r-Segura!'), true);
});
