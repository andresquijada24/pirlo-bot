import { describe, expect, it } from 'vitest';
import { createDiscordPoster } from '../../src/discord/poster.js';
import type { EaRecap, EaRecapPlayer } from '../../src/db/repositories/types.js';
import { cardHeight, initials, renderMatchCardSvg, svgToPng } from '../../src/render/match-card.js';
import { fit, measure } from '../../src/render/text.js';

// Datos ficticios, solo para pruebas.
const player = (over: Partial<EaRecapPlayer> & { name: string }): EaRecapPlayer => ({
  position: null,
  goals: null,
  assists: null,
  rating: null,
  shots: null,
  passesMade: null,
  passesAttempted: null,
  tacklesMade: null,
  tacklesAttempted: null,
  saves: null,
  manOfTheMatch: null,
  ...over,
});
const recap: EaRecap = {
  matchId: '1',
  matchType: 'leagueMatch',
  playedAt: '2026-10-25T02:07:40.000Z',
  goalsFor: 3,
  goalsAgainst: 1,
  result: 'victoria',
  opponentName: 'Rival Ficticio',
  players: [
    player({ name: 'Ana', position: 'forward', goals: 2, rating: 8.4, passesMade: 10, passesAttempted: 12, manOfTheMatch: true }),
    player({ name: 'Beto', position: 'midfielder', goals: 1, assists: 2, rating: 7.1 }),
  ],
};
const input = { recap, clubName: 'Club Prueba FC', timeZone: 'America/Caracas' };

describe('texto como trazos', () => {
  it('mide y recorta con "…" lo que no cabe', () => {
    expect(measure('AAAA', 20, 'bold') > measure('AA', 20, 'bold')).toBe(true);
    const short = fit('UnGamertagMuyLargoQueNoCabe', 120, 24, 'bold');
    expect(short.endsWith('…')).toBe(true);
    expect(measure(short, 24, 'bold') <= 120).toBe(true);
    expect(fit('Ana', 120, 24)).toBe('Ana');
  });

  it('iniciales del escudo genérico', () => {
    expect(initials('LACRITAS FC')).toBe('LF');
    expect(initials('Orion')).toBe('OR');
    expect(initials('Élite Ballers')).toBe('EB');
  });
});

describe('tarjeta del partido', () => {
  it('SVG válido, del alto que piden los jugadores, sin <text> ni imágenes externas', () => {
    const svg = renderMatchCardSvg(input);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toMatch(`height="${cardHeight(2)}"`);
    expect(svg).not.toMatch('<text');
    // La única imagen es el logo de PIRLO incrustado.
    expect((svg.match(/<image /g) ?? []).length).toBe(1);
    expect(svg).not.toMatch(/href="https?:/);
    expect(svg).toMatch('<title>Club Prueba FC 3 – 1 Rival Ficticio</title>');
  });

  it('cuantos más jugadores, más alta', () => {
    expect(cardHeight(6) > cardHeight(2)).toBe(true);
    const empty = renderMatchCardSvg({ ...input, recap: { ...recap, players: [], goalsFor: null, result: null } });
    expect(empty).toMatch('<title>Club Prueba FC VS Rival Ficticio</title>');
  });

  it('se convierte a PNG', async () => {
    const png = await svgToPng(renderMatchCardSvg(input));
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});

describe('adjuntos en Discord', () => {
  it('envía multipart con payload_json y files[n], sin exponer el token en el cuerpo', async () => {
    let seen: { headers: Record<string, string>; body: FormData } | null = null;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      seen = { headers: init.headers as Record<string, string>, body: init.body as FormData };
      return new Response(JSON.stringify({ id: '123456789012345678' }), { status: 200 });
    }) as unknown as typeof fetch;
    const poster = createDiscordPoster('token-ficticio', fakeFetch);
    const res = await poster.post('930000000000000007', { content: 'hola' }, [
      { name: 'partido-1.png', data: new Uint8Array([1, 2, 3]), contentType: 'image/png' },
    ]);
    expect(res.id).toBe('123456789012345678');
    const s = seen as unknown as { headers: Record<string, string>; body: FormData };
    expect(s.headers['content-type']).toBeUndefined();
    const payload = JSON.parse(String(s.body.get('payload_json')));
    expect(payload).toEqual({ content: 'hola', attachments: [{ id: 0, filename: 'partido-1.png' }] });
    expect(s.body.get('files[0]') instanceof Blob).toBe(true);
    expect(String(s.body.get('payload_json'))).not.toMatch('token-ficticio');
  });
});
