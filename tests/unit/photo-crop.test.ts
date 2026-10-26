import { describe, expect, it } from 'vitest';
import { normalizePhoto, parseCrop, PHOTO_WIDTH } from '../../src/render/photo.js';

// Imágenes sintéticas: solo existen en estas pruebas.
async function screenshot() {
  const { default: sharp } = await import('sharp');
  // Captura 1600×900 gris con una «tarjeta» roja vertical de 288×400 en (200, 250).
  const card = await sharp({
    create: { width: 288, height: 400, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer();
  return new Uint8Array(
    await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#808080' } })
      .composite([{ input: card, left: 200, top: 250 }])
      .png()
      .toBuffer(),
  );
}

async function pixels(b64: string) {
  const { default: sharp } = await import('sharp');
  const { data, info } = await sharp(Buffer.from(b64, 'base64'))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i]!, data[i + 1]!, data[i + 2]!] as [number, number, number];
  };
  return { info, at };
}

describe('foto del jugador: recorte de la tarjeta', () => {
  it('lee el recorte del formulario y descarta valores raros', () => {
    expect(
      parseCrop({
        recorte_x: '0.125',
        recorte_y: '0.27778',
        recorte_w: '0.18',
        recorte_h: '0.44444',
      }),
    ).toEqual({
      x: 0.125,
      y: 0.27778,
      w: 0.18,
      h: 0.44444,
    });
    expect(parseCrop({})).toBeNull();
    expect(
      parseCrop({ recorte_x: '-1', recorte_y: '0', recorte_w: '0.5', recorte_h: '0.5' }),
    ).toBeNull();
    expect(
      parseCrop({ recorte_x: '0.8', recorte_y: '0', recorte_w: '0.5', recorte_h: '0.5' }),
    ).toBeNull();
    expect(
      parseCrop({ recorte_x: '1e3', recorte_y: '0', recorte_w: '0.5', recorte_h: '0.5' }),
    ).toBeNull();
  });

  it('con recorte sale la tarjeta entera, al ras: su propia forma, sin franjas ni restos', async () => {
    const crop = { x: 200 / 1600, y: 250 / 900, w: 288 / 1600, h: 400 / 900 };
    const { info, at } = await pixels(await normalizePhoto(await screenshot(), crop));
    expect(info.width).toBe(PHOTO_WIDTH);
    expect(info.height).toBe(Math.round((PHOTO_WIDTH * 400) / 288));
    // Rojo en el centro y en las cuatro esquinas: ni gris de la captura ni franjas de fondo.
    for (const [x, y] of [
      [info.width / 2, info.height / 2],
      [3, 3],
      [info.width - 4, 3],
      [3, info.height - 4],
      [info.width - 4, info.height - 4],
    ] as const) {
      const [r, g, b] = at(Math.round(x), Math.round(y));
      expect(r > 200 && g + b < 80).toBe(true);
    }
  });

  it('una imagen ya recortada (vertical) se muestra entera', async () => {
    const { default: sharp } = await import('sharp');
    const card = new Uint8Array(
      await sharp({ create: { width: 360, height: 500, channels: 3, background: '#00ff00' } })
        .png()
        .toBuffer(),
    );
    const { info, at } = await pixels(await normalizePhoto(card));
    // Entera y con su forma (360×500 → 480×667): verde hasta los bordes, sin recortes ni franjas.
    expect([info.width, info.height]).toEqual([PHOTO_WIDTH, Math.round((PHOTO_WIDTH * 500) / 360)]);
    expect(at(2, Math.round(info.height / 2))[1]).toBeGreaterThan(200);
    expect(at(PHOTO_WIDTH / 2, 3)[1]).toBeGreaterThan(200);
  });
});
