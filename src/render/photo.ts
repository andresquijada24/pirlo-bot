import { validation } from '../core/errors.js';

/** Foto del jugador en su ficha: retrato 4:5. */
export const PHOTO_WIDTH = 480;
export const PHOTO_HEIGHT = 600;
/** Límite en base64 (la base de datos admite hasta 270 000 caracteres). */
const PHOTO_MAX_BASE64 = 260_000;

/**
 * Recorta y reduce la captura de The Grounds (PNG/JPG/WebP) a un retrato JPEG en base64.
 * El recorte se centra en la zona con más detalle (el jugador), no en el fondo.
 */
export async function normalizePhoto(bytes: Uint8Array): Promise<string> {
  const { default: sharp } = await import('sharp');
  let meta;
  try {
    meta = await sharp(bytes, { limitInputPixels: 8192 * 8192 }).metadata();
  } catch {
    throw validation('El archivo no es una imagen válida. Usa PNG o JPG.');
  }
  if (!meta.format || !['png', 'jpeg', 'webp'].includes(meta.format)) {
    throw validation('Formato no admitido. Usa PNG o JPG.');
  }
  const base = sharp(bytes, { limitInputPixels: 8192 * 8192 })
    .rotate()
    .resize(PHOTO_WIDTH, PHOTO_HEIGHT, { fit: 'cover', position: sharp.strategy.attention })
    .flatten({ background: '#0f172a' });
  for (const quality of [82, 70, 58]) {
    const b64 = (await base.clone().jpeg({ quality, mozjpeg: true }).toBuffer()).toString('base64');
    if (b64.length <= PHOTO_MAX_BASE64) return b64;
  }
  throw validation('La imagen tiene demasiado detalle; prueba con otra captura.');
}
