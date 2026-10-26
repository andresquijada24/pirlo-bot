import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// El detector se ejecuta en el navegador; aquí se carga el mismo archivo en un contexto aislado.
type Box = { x: number; y: number; w: number; h: number } | null;
const sandbox: { detectarTarjeta?: (data: Uint8Array, w: number, h: number) => Box } = {};
runInNewContext(readFileSync(new URL('../../public/tarjeta.js', import.meta.url), 'utf8'), sandbox);
const detect = sandbox.detectarTarjeta!;

/** Captura sintética: interfaz oscura, tarjeta verde/dorada, texto blanco e íconos dorados pequeños. */
async function screenshot(card: { left: number; top: number } | null) {
  const { default: sharp } = await import('sharp');
  const parts: { input: Buffer; left: number; top: number }[] = [];
  const box = (w: number, h: number, color: string) =>
    sharp({ create: { width: w, height: h, channels: 3, background: color } })
      .png()
      .toBuffer();
  if (card) {
    parts.push({ input: await box(288, 400, '#c9a227'), left: card.left, top: card.top });
    parts.push({ input: await box(250, 280, '#2fbf4a'), left: card.left + 19, top: card.top + 20 });
  }
  parts.push({ input: await box(500, 40, '#f1f1f1'), left: 700, top: 300 }); // texto blanco
  parts.push({ input: await box(40, 40, '#c9a227'), left: 1300, top: 600 }); // ícono dorado
  const full = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: '#111622' },
  })
    .composite(parts)
    .png()
    .toBuffer();
  const { data, info } = await sharp(full)
    .resize({ width: 320 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), w: info.width, h: info.height };
}

describe('marco automático sobre la tarjeta', () => {
  it('encuentra la tarjeta en la captura e ignora texto e íconos', async () => {
    const s = await screenshot({ left: 200, top: 250 });
    const r = detect(s.data, s.w, s.h)!;
    expect(r).not.toBeNull();
    const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
    expect(
      near(r.x, 200 / 1600) &&
        near(r.y, 250 / 900) &&
        near(r.w, 288 / 1600) &&
        near(r.h, 400 / 900),
    ).toBe(true);
  });

  it('sin tarjeta no inventa una: el marco queda centrado', async () => {
    const s = await screenshot(null);
    expect(detect(s.data, s.w, s.h)).toBeNull();
  });
});
