const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const {
  detectarTipoComprobante,
  prepararComprobante,
  guardarComprobanteAtomico,
} = require('../utils/comprobanteArchivo');

test('detecta el contenido real y rechaza archivos falsos o PDF incompletos', () => {
  assert.deepEqual(detectarTipoComprobante(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 0, 0, 0])), {
    mime: 'image/jpeg',
    extension: '.jpg',
  });
  assert.equal(detectarTipoComprobante(Buffer.from('%PDF-1.7\nobjeto sin cierre')), null);
  assert.deepEqual(detectarTipoComprobante(Buffer.from('%PDF-1.7\n1 0 obj\nendobj\n%%EOF')), {
    mime: 'application/pdf',
    extension: '.pdf',
  });
  assert.equal(detectarTipoComprobante(Buffer.from('contenido ejecutable falso')), null);
});

test('rechaza cuando el MIME declarado no coincide con el contenido', async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 4, background: '#ffffff' },
  }).png().toBuffer();

  await assert.rejects(
    prepararComprobante({ buffer: png, mimetype: 'application/pdf', originalname: 'falso.pdf' }),
    (error) => error?.status === 400 && error?.errorCode === 'INVALID_RECEIPT_CONTENT'
  );
});

test('recomprime imágenes, limita dimensiones y elimina metadatos', async () => {
  const original = await sharp({
    create: { width: 2800, height: 120, channels: 3, background: '#3484f0' },
  })
    .withMetadata({ orientation: 6, comment: 'dato privado de prueba' })
    .jpeg({ quality: 95 })
    .toBuffer();

  const prepared = await prepararComprobante({
    buffer: original,
    mimetype: 'image/jpeg',
    originalname: '../../captura original.jpeg',
  });
  const metadata = await sharp(prepared.buffer).metadata();

  assert.equal(prepared.mime, 'image/jpeg');
  assert.equal(prepared.extension, '.jpg');
  assert.equal(prepared.originalName, 'captura original.jpeg');
  assert.ok(metadata.width <= 2500);
  assert.ok(metadata.height <= 2500);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.equal(metadata.orientation, undefined);
});

test('guarda con UUID y escritura atómica sin dejar temporales', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sir-comprobante-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const pdf = await prepararComprobante({
    buffer: Buffer.from('%PDF-1.7\n1 0 obj\nendobj\n%%EOF'),
    mimetype: 'application/pdf',
    originalname: 'comprobante.pdf',
  });
  const saved = await guardarComprobanteAtomico(directory, pdf);
  const entries = await fs.readdir(directory);

  assert.match(saved.fileName, /^[0-9a-f-]{36}\.pdf$/);
  assert.deepEqual(entries, [saved.fileName]);
  assert.deepEqual(await fs.readFile(saved.absolutePath), pdf.buffer);
});
