const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const MAX_IMAGE_PIXELS = 40_000_000;

const MIME_ALIASES = new Map([
  ['image/jpeg', 'image/jpeg'],
  ['image/jpg', 'image/jpeg'],
  ['image/png', 'image/png'],
  ['application/pdf', 'application/pdf'],
]);

function crearErrorArchivo(message, errorCode = 'INVALID_RECEIPT_CONTENT') {
  const error = new Error(message);
  error.status = 400;
  error.errorCode = errorCode;
  return error;
}

function detectarTipoComprobante(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', extension: '.jpg' };
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', extension: '.png' };
  }
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    const tail = buffer.subarray(Math.max(0, buffer.length - 4096)).toString('latin1');
    if (tail.includes('%%EOF')) return { mime: 'application/pdf', extension: '.pdf' };
  }
  return null;
}

async function prepararComprobante(file) {
  const detected = detectarTipoComprobante(file?.buffer);
  if (!detected) {
    throw crearErrorArchivo('El comprobante no contiene una imagen JPG, PNG o un PDF válido.');
  }

  const declaredMime = MIME_ALIASES.get(String(file?.mimetype || '').toLowerCase());
  if (declaredMime && declaredMime !== detected.mime) {
    throw crearErrorArchivo('El contenido del comprobante no coincide con el tipo de archivo informado.');
  }

  let buffer;
  try {
    if (detected.mime === 'image/jpeg') {
      buffer = await sharp(file.buffer, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS })
        .rotate()
        .resize({ width: 2500, height: 2500, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
    } else if (detected.mime === 'image/png') {
      buffer = await sharp(file.buffer, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS })
        .rotate()
        .resize({ width: 2500, height: 2500, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
    } else {
      buffer = Buffer.from(file.buffer);
    }
  } catch (_) {
    throw crearErrorArchivo('No fue posible procesar el comprobante. Verifica que el archivo no esté dañado.');
  }

  return {
    buffer,
    mime: detected.mime,
    extension: detected.extension,
    originalName: path.basename(String(file?.originalname || `comprobante${detected.extension}`)).slice(0, 255),
  };
}

async function guardarComprobanteAtomico(directory, preparedFile) {
  if (!preparedFile?.buffer || !/^\.(jpg|png|pdf)$/.test(preparedFile.extension || '')) {
    throw crearErrorArchivo('El comprobante procesado no es válido.');
  }

  await fs.mkdir(directory, { recursive: true });
  const fileName = `${randomUUID()}${preparedFile.extension}`;
  const finalPath = path.join(directory, fileName);
  const temporaryPath = path.join(directory, `.${fileName}.${randomUUID()}.tmp`);

  try {
    await fs.writeFile(temporaryPath, preparedFile.buffer, { flag: 'wx' });
    await fs.rename(temporaryPath, finalPath);
    return { fileName, absolutePath: finalPath };
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => false);
    await fs.unlink(finalPath).catch(() => false);
    throw error;
  }
}

module.exports = {
  detectarTipoComprobante,
  prepararComprobante,
  guardarComprobanteAtomico,
};
