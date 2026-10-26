import { describe, expect, it } from 'vitest';
import { normalizePhoto, parseCrop, PHOTO_HEIGHT, PHOTO_WIDTH } from '../../src/render/photo.js';

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

  it('con recorte sale la tarjeta entera, tal cual, sin el resto de la captura', async () => {
    const crop = { x: 200 / 1600, y: 250 / 900, w: 288 / 1600, h: 400 / 900 };
    const { info, at } = await pixels(await normalizePhoto(await screenshot(), crop));
    expect([info.width, info.height]).toEqual([PHOTO_WIDTH, PHOTO_HEIGHT]);
    const [r, g, b] = at(PHOTO_WIDTH / 2, PHOTO_HEIGHT / 2);
    expect(r).toBeGreaterThan(200);
    expect(g + b).toBeLessThan(60);
    // La tarjeta llena el alto (nada del gris de la captura) y a los lados queda el fondo de la ficha.
    expect(at(PHOTO_WIDTH / 2, 4)[0]).toBeGreaterThan(200);
    const [r2, g2, b2] = at(3, PHOTO_HEIGHT / 2);
    expect(r2 < 40 && g2 < 50 && b2 < 70).toBe(true);
  });

  it('una imagen ya recortada (vertical) se muestra entera', async () => {
    const { default: sharp } = await import('sharp');
    const card = new Uint8Array(
      await sharp({ create: { width: 360, height: 500, channels: 3, background: '#00ff00' } })
        .png()
        .toBuffer(),
    );
    const { at } = await pixels(await normalizePhoto(card));
    expect(at(PHOTO_WIDTH / 2, PHOTO_HEIGHT / 2)[1]).toBeGreaterThan(200);
    expect(at(2, PHOTO_HEIGHT / 2)[1]).toBeLessThan(60); // franja de fondo a los lados: no se recortó
    expect(at(PHOTO_WIDTH / 2, 3)[1]).toBeGreaterThan(200); // ni arriba
  });
});
