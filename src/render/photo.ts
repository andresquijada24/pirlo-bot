import { validation } from '../core/errors.js';

/** Foto del jugador en su ficha: retrato 4:5. */
export const PHOTO_WIDTH = 480;
export const PHOTO_HEIGHT = 600;
/** Límite en base64 (la base de datos admite hasta 270 000 caracteres). */
const PHOTO_MAX_BASE64 = 260_000;

/** Recorte elegido por el jugador, en fracciones de la imagen (0–1). */
export interface PhotoCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Lee el recorte de un formulario; null si falta o no tiene sentido (se usa el automático). */
export function parseCrop(form: Record<string, unknown>): PhotoCrop | null {
  const n = (k: string) => {
    const v = form[`recorte_${k}`];
    const num = typeof v === 'string' && /^\d(\.\d{1,6})?$/.test(v) ? Number(v) : NaN;
    return num >= 0 && num <= 1 ? num : NaN;
  };
  const c = { x: n('x'), y: n('y'), w: n('w'), h: n('h') };
  if (Object.values(c).some((v) => Number.isNaN(v))) return null;
  if (c.w < 0.02 || c.h < 0.02 || c.x + c.w > 1.0001 || c.y + c.h > 1.0001) return null;
  return c;
}

/** Imagen ya recortada a la tarjeta (vertical): se muestra entera, tal cual. */
const isPortrait = (w: number, h: number) => w / h >= 0.45 && w / h <= 1.05;

/**
 * Convierte la captura de The Grounds (PNG/JPG/WebP) en un retrato JPEG 4:5 en base64.
 * - Con recorte (elegido en la web) o con una imagen ya vertical: se muestra entera, tal cual
 *   (la tarjeta completa, centrada sobre el fondo de la ficha).
 * - Captura completa sin recorte: se recorta centrada en la zona con más detalle (el jugador).
 */
export async function normalizePhoto(bytes: Uint8Array, crop: PhotoCrop | null = null): Promise<string> {
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
  // Dimensiones ya giradas según EXIF (lo que ve el jugador al elegir el recorte).
  const turned = (meta.orientation ?? 1) >= 5;
  const W = (turned ? meta.height : meta.width) ?? 0;
  const H = (turned ? meta.width : meta.height) ?? 0;
  let base = sharp(bytes, { limitInputPixels: 8192 * 8192 }).rotate();
  const area =
    crop && W > 0 && H > 0
      ? {
          left: Math.min(W - 1, Math.round(crop.x * W)),
          top: Math.min(H - 1, Math.round(crop.y * H)),
          width: 0,
          height: 0,
        }
      : null;
  if (area && crop) {
    area.width = Math.max(1, Math.min(W - area.left, Math.round(crop.w * W)));
    area.height = Math.max(1, Math.min(H - area.top, Math.round(crop.h * H)));
    // rotate() y extract() en la misma cadena: se materializa el giro antes de recortar.
    base = sharp(await base.toBuffer(), { limitInputPixels: 8192 * 8192 }).extract(area);
  }
  const whole = area !== null || isPortrait(W, H);
  base = whole
    ? base.resize(PHOTO_WIDTH, PHOTO_HEIGHT, { fit: 'contain', background: '#0f172a' })
    : base.resize(PHOTO_WIDTH, PHOTO_HEIGHT, { fit: 'cover', position: sharp.strategy.attention });
  base = base.flatten({ background: '#0f172a' });
  for (const quality of [82, 70, 58]) {
    const b64 = (await base.clone().jpeg({ quality, mozjpeg: true }).toBuffer()).toString('base64');
    if (b64.length <= PHOTO_MAX_BASE64) return b64;
  }
  throw validation('La imagen tiene demasiado detalle; prueba con otra captura.');
}
