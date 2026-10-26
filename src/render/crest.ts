import { validation } from '../core/errors.js';

/** Lado del escudo guardado (px). En la tarjeta se dibuja a ~110 px; el doble da nitidez. */
export const CREST_SIZE = 256;
/** Límite en base64 (coincide con la restricción de clubs.crest_png). */
export const CREST_MAX_BASE64 = 200_000;

/**
 * Convierte la imagen que sube un admin (PNG, JPG o WebP) en un PNG cuadrado de 256 px con fondo
 * transparente y la devuelve en base64. Rechaza lo que no sea una imagen válida.
 */
export async function normalizeCrest(
  bytes: Uint8Array,
  options: { removeDarkBackground?: boolean } = {},
): Promise<string> {
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
  let source: Uint8Array = bytes;
  if (options.removeDarkBackground) {
    const { data, info } = await sharp(bytes, { limitInputPixels: 4096 * 4096 })
      .rotate()
      .resize(512, 512, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    clearDarkBackground(data, info.width, info.height);
    source = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  }
  const base = sharp(source, { limitInputPixels: 4096 * 4096 })
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

/** Brillo (canal máximo) por debajo del cual un píxel unido al borde se considera fondo. */
const DARK = 96;
/** Brillo hasta el que el fondo se considera negro puro (ruido de compresión incluido). */
const NOISE = 28;

/**
 * Quita el fondo oscuro de un escudo (RGBA en bruto, se modifica en el sitio): recorre desde los
 * bordes los píxeles oscuros conectados y los vuelve transparentes. Lo oscuro que no toca el fondo
 * (contornos, detalles interiores) se conserva. Los brillos tenues (resplandores) quedan
 * semitransparentes según su brillo, para fundirse con el fondo de la tarjeta sin halo negro.
 */
export function clearDarkBackground(px: Uint8Array, width: number, height: number): void {
  const bright = (i: number) => Math.max(px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!);
  const seen = new Uint8Array(width * height);
  const queue: number[] = [];
  const push = (i: number) => {
    if (!seen[i] && bright(i) <= DARK) {
      seen[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const x = i % width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (i >= width) push(i - width);
    if (i < width * (height - 1)) push(i + width);
  }
  for (let i = 0; i < width * height; i++) {
    if (!seen[i]) continue;
    const b = bright(i);
    // Por debajo de NOISE es negro de fondo (incluido el ruido del JPG): totalmente transparente.
    const alpha = Math.min(1, Math.max(0, (b - NOISE) / (DARK - NOISE))) ** 1.3;
    if (alpha < 0.04) {
      px[i * 4 + 3] = 0;
      continue;
    }
    // Se aclara el color en proporción: el resplandor conserva su tono al perder el negro de fondo.
    const gain = Math.min(255 / Math.max(b, 1), 1 / alpha);
    for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.min(255, Math.round(px[i * 4 + c]! * gain));
    px[i * 4 + 3] = Math.round(alpha * 255);
  }
}
