import { INTER } from './assets/inter.js';

/**
 * Texto en SVG como trazos (no como <text>): el PNG sale igual en cualquier servidor, aunque no
 * tenga fuentes instaladas. Usa los glifos de Inter generados en assets/inter.ts.
 */

export type Weight = 'bold' | 'medium';
type Font = { unitsPerEm: number; glyphs: Record<string, readonly [number, string]> };
const FONTS = INTER as unknown as Record<Weight, Font>;
const FALLBACK = '?';

function glyph(font: Font, ch: string): readonly [number, string] {
  return font.glyphs[ch] ?? font.glyphs[FALLBACK]!;
}

/** Ancho en píxeles del texto a ese tamaño. */
export function measure(text: string, size: number, weight: Weight = 'medium'): number {
  const font = FONTS[weight];
  let units = 0;
  for (const ch of text) units += glyph(font, ch)[0];
  return (units * size) / font.unitsPerEm;
}

/** Recorta el texto con "…" para que quepa en maxWidth. */
export function fit(text: string, maxWidth: number, size: number, weight: Weight = 'medium'): string {
  if (measure(text, size, weight) <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 1 && measure(`${chars.join('')}…`, size, weight) > maxWidth) chars.pop();
  return `${chars.join('')}…`;
}

export interface TextOptions {
  size: number;
  weight?: Weight;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  opacity?: number;
  /** Espaciado extra entre letras, en píxeles. */
  tracking?: number;
}

/** Dibuja texto con la línea base en (x, y). */
export function text(value: string, x: number, y: number, o: TextOptions): string {
  const weight = o.weight ?? 'medium';
  const font = FONTS[weight];
  const scale = o.size / font.unitsPerEm;
  const tracking = (o.tracking ?? 0) / scale;
  const chars = [...value];
  const width = measure(value, o.size, weight) + (o.tracking ?? 0) * Math.max(chars.length - 1, 0);
  const start = o.anchor === 'middle' ? x - width / 2 : o.anchor === 'end' ? x - width : x;
  let cursor = 0;
  const paths: string[] = [];
  for (const ch of chars) {
    const [advance, d] = glyph(font, ch);
    if (d) paths.push(`<path transform="translate(${Math.round(cursor)} 0)" d="${d}"/>`);
    cursor += advance + tracking;
  }
  const opacity = o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : '';
  return (
    `<g transform="translate(${start.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(5)} ${(-scale).toFixed(5)})"` +
    ` fill="${o.fill ?? '#fff'}"${opacity}>${paths.join('')}</g>`
  );
}
