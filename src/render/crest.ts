import { validation } from '../core/errors.js';

/** Lado del escudo guardado (px). En la tarjeta se dibuja a ~110 px; el doble da nitidez. */
export const CREST_SIZE = 256;
/** Límite en base64 (coincide con la restricción de clubs.crest_png). */
export const CREST_MAX_BASE64 = 200_000;

/**
 * Convierte la imagen que sube un admin (PNG, JPG o WebP) en un PNG cuadrado de 256 px con fondo
 * transparente y la devuelve en base64. Rechaza lo que no sea una imagen válida.
 */
export async function normalizeCrest(bytes: Uint8Array): Promise<string> {
  const { default: sharp } = await import('sharp');
  let meta;
  try {
    meta = await sharp(bytes, { limitInputPixels: 4096 * 4096 }).metadata();
  } catch {
    throw validation('El archivo no es una imagen válida. Usa PNG o JPG.');
  }
  if (!meta.format || !['png', 'jpeg', 'webp'].includes(meta.format)) {
    throw validation('Formato no admitido. Usa PNG o JPG.');
  }
  const base = sharp(bytes, { limitInputPixels: 4096 * 4096 })
    .rotate()
    .resize(CREST_SIZE, CREST_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  let png = await base.clone().png({ compressionLevel: 9 }).toBuffer();
  if (png.toString('base64').length > CREST_MAX_BASE64) {
    png = await base.clone().png({ compressionLevel: 9, palette: true }).toBuffer();
  }
  const b64 = png.toString('base64');
  if (b64.length > CREST_MAX_BASE64) throw validation('El escudo es demasiado detallado; prueba con otra imagen.');
  return b64;
}
