import { beforeEach, describe, expect, it } from 'vitest';
import { commandsByName, componentHandlers } from '../../src/discord/commands/index.js';
import { routeInteraction, type RouterDeps } from '../../src/discord/router.js';
import { clearDarkBackground, CREST_SIZE, normalizeCrest } from '../../src/render/crest.js';
import { renderMatchCardSvg } from '../../src/render/match-card.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';
import { MANAGE_GUILD, slash, str, textOf } from '../helpers/interactions.js';

// Imagen ficticia generada en la prueba (un cuadrado de color), nunca un logo real.
async function sampleImage(width = 300, height = 200): Promise<Uint8Array> {
  const { default: sharp } = await import('sharp');
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 160, b: 0 } } })
    .jpeg()
    .toBuffer();
  return new Uint8Array(buf);
}

describe('normalizeCrest', () => {
  it('convierte a PNG cuadrado de 256 px en base64', async () => {
    const { default: sharp } = await import('sharp');
    const b64 = await normalizeCrest(await sampleImage());
    const meta = await sharp(Buffer.from(b64, 'base64')).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', CREST_SIZE, CREST_SIZE]);
  });

  it('rechaza lo que no es una imagen', async () => {
    let msg = '';
    await normalizeCrest(new TextEncoder().encode('<svg onload=alert(1)>')).catch((e: Error) => (msg = e.message));
    expect(msg).toMatch('no es una imagen válida');
  });
});

describe('quitar el fondo oscuro', () => {
  it('el negro unido al borde se vuelve transparente; lo oscuro del interior se conserva', () => {
    // 5x5: fondo negro, anillo dorado y un punto negro dentro del anillo.
    const w = 5;
    const px = new Uint8Array(w * w * 4);
    const set = (x: number, y: number, rgb: [number, number, number]) => {
      px.set([...rgb, 255], (y * w + x) * 4);
    };
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) set(x, y, [5, 5, 5]);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) set(x, y, [230, 170, 20]);
    set(2, 2, [0, 0, 0]);
    set(0, 2, [60, 45, 5]); // resplandor tenue en el borde
    clearDarkBackground(px, w, w);
    const alpha = (x: number, y: number) => px[(y * w + x) * 4 + 3];
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(2, 2)).toBe(255);
    expect(alpha(1, 1)).toBe(255);
    const glow = alpha(0, 2)!;
    expect(glow > 0 && glow < 255).toBe(true);
  });

  it('con la opción, el PNG resultante tiene transparencia', async () => {
    const { default: sharp } = await import('sharp');
    const img = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite([
        {
          input: await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 240, g: 180, b: 0 } } })
            .png()
            .toBuffer(),
          top: 22,
          left: 22,
        },
      ])
      .jpeg()
      .toBuffer();
    const b64 = await normalizeCrest(new Uint8Array(img), { removeDarkBackground: true });
    const { data } = await sharp(Buffer.from(b64, 'base64')).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0); // esquina transparente
    const center = ((CREST_SIZE / 2) * CREST_SIZE + CREST_SIZE / 2) * 4;
    expect(data[center + 3]).toBe(255);
  });
});

describe('/club escudo', () => {
  const OWNER = { userId: '800000000000000001', name: 'Dueño', permissions: MANAGE_GUILD };
  const DT = { userId: '800000000000000002', name: 'Entrenador' };
  const URL_IMG = 'https://cdn.discordapp.com/attachments/1/2/escudo.jpg';
  let env: ReturnType<typeof createMemoryRepos>;
  let deps: RouterDeps;
  let downloads = 0;
  const run = (i: Parameters<typeof routeInteraction>[0]) => routeInteraction(i, deps);
  const escudo = (who: { userId: string; name: string; permissions?: string }, extra: ReturnType<typeof str>[] = []) => {
    const i = slash(who, 'club', 'escudo', [{ name: 'imagen', type: 11, value: '7' }, ...extra]) as unknown as {
      data: Record<string, unknown>;
    };
    i.data.resolved = { attachments: { '7': { id: '7', url: URL_IMG, filename: 'escudo.jpg', size: 5000 } } };
    return run(i as never);
  };

  beforeEach(async () => {
    env = createMemoryRepos();
    downloads = 0;
    const image = await sampleImage();
    deps = {
      commands: commandsByName,
      components: componentHandlers,
      repos: env.repos,
      downloadBytes: async (url) => {
        expect(url).toBe(URL_IMG);
        downloads++;
        return image;
      },
    };
    await run(slash(OWNER, 'club', 'registrar', [str('nombre', 'Club Prueba'), str('identificador', 'club-prueba')]));
    env.addMember(env.state.clubs[0]!.id, DT.userId, 'dt');
  });

  it('solo un admin; sin descargar nada si no lo es', async () => {
    expect(textOf(await escudo(DT))).toMatch('Solo un admin');
    expect(downloads).toBe(0);
    expect(textOf(await escudo(OWNER))).toMatch('guardado');
    const crest = await env.repos.clubs.crest(env.state.clubs[0]!.id);
    expect(crest !== null && crest.startsWith('iVBORw0KGgo')).toBe(true);
  });

  it('se puede quitar', async () => {
    await escudo(OWNER);
    const quitar = slash(OWNER, 'club', 'escudo', [{ name: 'quitar', type: 5, value: true }]);
    expect(textOf(await run(quitar))).toMatch('quitado');
    expect(await env.repos.clubs.crest(env.state.clubs[0]!.id)).toBeNull();
  });

  it('la tarjeta usa el escudo del club; el rival sigue con iniciales', async () => {
    await escudo(OWNER);
    const crest = await env.repos.clubs.crest(env.state.clubs[0]!.id);
    const svg = renderMatchCardSvg({
      recap: {
        matchId: '1',
        matchType: 'leagueMatch',
        playedAt: '2026-10-25T02:07:40.000Z',
        goalsFor: 1,
        goalsAgainst: 0,
        result: 'victoria',
        opponentName: 'Rival Ficticio',
        players: [],
      },
      clubName: 'Club Prueba',
      timeZone: 'America/Caracas',
      clubCrestPng: crest,
    });
    // Logo de PIRLO + escudo del club.
    expect((svg.match(/<image /g) ?? []).length).toBe(2);
    expect(svg).toMatch(`base64,${crest}`);
  });
});
