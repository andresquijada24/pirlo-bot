import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseRating,
  readMatchImage,
  resolvePlayerName,
  similarity,
  toClubMatch,
  type MatchImageRead,
  type Ocr,
} from '../../src/providers/ourproclub/match-image.js';
import { renderResultCardSvg, resultOf } from '../../src/render/result-card.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/ourproclub/${name}`, import.meta.url));

const player = (name: string, goals = 0, assists = 0) => ({
  name,
  rating: 7,
  goals,
  assists,
  shots: 0,
  dribbles: 0,
  passesMade: 0,
  passesAttempted: 0,
  tacklesMade: 0,
  tacklesAttempted: 0,
  interceptions: 0,
  blocks: 0,
  clearances: 0,
  saves: 0,
});
const read = (over: Partial<MatchImageRead> = {}): MatchImageRead => ({
  home: { name: 'KUNDNAV FC', score: 4 },
  away: { name: 'MARITIMO CF', score: 4 },
  competition: 'LIGA',
  humans: { home: 5, away: 3 },
  players: [player('Raalro', 3), player('apirlo5', 1, 1)],
  ...over,
});

describe('nombres leídos de la imagen', () => {
  it('corrige el gamertag con el conocido del club e ignora los iconos', () => {
    const known = ['Raalro', 'apirlo5', 'nedus'];
    expect(resolvePlayerName('apirloS BO Ey', known)).toBe('apirlo5');
    expect(resolvePlayerName('apirloSs OO ES', known)).toBe('apirlo5');
    expect(resolvePlayerName('Radlro BB @®', known)).toBe('Raalro');
    expect(resolvePlayerName('nedus OO ©', known)).toBe('nedus');
    // Gamertag partido por el lector o con espacio.
    expect(resolvePlayerName('willl_ mich', ['willl_mich', 'nedus'])).toBe('willl_mich');
    expect(resolvePlayerName('RM CAAMs ©', ['RM CAAMs', 'nedus'])).toBe('RM CAAMs');
    // Desconocido: primera palabra tal cual.
    expect(resolvePlayerName('Fichaje99 @', known)).toBe('Fichaje99');
    expect(resolvePlayerName('  ', known)).toBeNull();
  });

  it('el nombre del club se compara sin acentos ni mayúsculas', () => {
    expect(similarity('Marítimo CF', 'MARITIMO CF')).toBe(1);
    expect(similarity('Marítimo CF', 'KUNDNAV FC')).toBeLessThan(0.5);
  });
});

describe('partido del club a partir de la lectura', () => {
  it('visitante: el club a la izquierda de la tarjeta, jugadores humanos de su lado', () => {
    const m = toClubMatch(read(), ['Marítimo CF'], '2026-10-26')!;
    expect([m.home, m.goalsFor, m.goalsAgainst, m.opponentName]).toEqual([
      false,
      4,
      4,
      'KUNDNAV FC',
    ]);
    expect(m.humans).toEqual({ club: 3, rival: 5 });
    expect(resultOf(m).label).toBe('EMPATE');
  });

  it('sin seguridad no hay partido: club no reconocido o números que no cuadran', () => {
    const reasons: string[] = [];
    expect(toClubMatch(read(), ['Otro Club'], null, (r) => reasons.push(r))).toBeNull();
    expect(reasons).toEqual([
      'el club no aparece en el marcador («KUNDNAV FC» contra «MARITIMO CF»)',
    ]);
    // 5 goles de jugadores con 4 del club: lectura errónea.
    expect(toClubMatch(read({ players: [player('Raalro', 5)] }), ['Marítimo CF'], null)).toBeNull();
    expect(
      toClubMatch(read({ players: [player('Raalro', 0, 5)] }), ['Marítimo CF'], null),
    ).toBeNull();
  });

  it('la tarjeta del partido muestra el marcador y no mete HTML de los nombres', () => {
    const m = toClubMatch(
      read({ away: { name: 'MARITIMO CF', score: 4 }, home: { name: 'Rival <b>', score: 1 } }),
      ['Marítimo CF'],
      '2026-10-26',
    )!;
    const svg = renderResultCardSvg({ match: m, clubName: 'Marítimo CF', source: 'Our Pro Club' });
    expect(svg).toMatch('<title>Marítimo CF 4–1 Rival &lt;b&gt;</title>');
    expect(svg).not.toMatch('<b>');
  });

  it('una imagen que no es de Our Pro Club no se lee', async () => {
    const sharp = (await import('sharp')).default;
    const square = await sharp({
      create: { width: 800, height: 800, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    const ocr: Ocr = { read: async () => '' };
    expect(await readMatchImage(square, ocr)).toBeNull();
    // 16:9 pero sin texto: tampoco.
    const blank = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    expect(await readMatchImage(blank, ocr)).toBeNull();
  });
});

describe('calificación', () => {
  it('siempre con un decimal; si el punto se pierde, se recupera', () => {
    expect([
      parseRating('7.7'),
      parseRating('77'),
      parseRating('100'),
      parseRating('10.0'),
    ]).toEqual([7.7, 7.7, 10, 10]);
    expect([parseRating('7'), parseRating(''), parseRating('11.5'), parseRating('0.0')]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
});

describe('filas de la tabla', () => {
  it('encuentra cada fila por sí sola (la separación cambia según los jugadores)', async () => {
    // Lector ficticio: todo «legible»; así solo cuenta cuántas filas se detectan.
    const ocr: Ocr = {
      read: async (_png, { chars }) =>
        chars?.includes('.') ? '7.0' : chars === '0123456789' ? '1' : chars ? '-' : 'Jugador',
    };
    const counts: number[] = [];
    for (const f of [
      'partido-kundnav-4-4.png',
      'partido-hutch-3-0.png',
      'partido-oooupii-0-0.png',
      'partido-gln-santos-0-10.png',
      'amistoso-mecha-brs-2-1.png',
    ])
      counts.push((await readMatchImage(fixture(f), ocr))?.players.length ?? -1);
    expect(counts).toEqual([3, 2, 2, 2, 11]);
  });
});

// Lectura real con el lector gratuito sobre imágenes reales de Our Pro Club. En CI siempre se
// ejecuta; en local, solo si tesseract.js está instalado.
const tesseract = await import('tesseract.js')
  .then(() => import('../../src/providers/ourproclub/tesseract.js'))
  .then((m) => m.createTesseractOcr)
  .catch((err: unknown) => {
    if (process.env.CI) throw err;
    return null;
  });
const withOcr = tesseract ? it : it.skip;

// [nombre, calif., goles, asistencias, tiros, regates, pases completados, intentados,
//  entradas ganadas, intentadas, intercepciones, bloqueos, despejes, paradas]
type Row = [string, ...(number | null)[]];
const EXPECTED: Record<
  string,
  { home: boolean; score: [number, number]; rival: string; competition?: string; rows: Row[] }
> = {
  'partido-kundnav-4-4.png': {
    home: false,
    score: [4, 4],
    rival: 'KUNDNAV FC',
    rows: [
      ['Raalro', 9.4, 3, 0, 5, 15, 17, 21, 0, 1, 0, 0, 0, 0],
      ['apirlo5', 8.8, 1, 1, 2, 26, 23, 34, 1, 3, 3, 0, 0, 0],
      ['nedus', 6.9, 0, 3, 0, 13, 121, 140, 11, 18, 3, 0, 0, 0],
    ],
  },
  'partido-hutch-3-0.png': {
    home: true,
    score: [3, 0],
    rival: 'HUTCH FC',
    rows: [
      ['Raalro', 9.4, 2, 1, 7, 15, 14, 19, 1, 2, 3, 0, 0, 0],
      ['apirlo5', 7.2, 1, 2, 2, 8, 117, 142, 7, 19, 3, 1, 0, 0],
    ],
  },
  'partido-oooupii-0-0.png': {
    home: true,
    score: [0, 0],
    rival: 'OOOUPII',
    rows: [
      ['Raalro', 6.1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0],
      ['apirlo5', 6.1, 0, 0, 0, 1, 5, 6, 0, 0, 0, 0, 0, 0],
    ],
  },
  'partido-gln-santos-0-10.png': {
    home: true,
    score: [0, 10],
    rival: 'GLN SANTOS',
    rows: [
      ['apirlo5', 6.4, 0, 0, 3, 13, 107, 138, 10, 23, 3, 0, 0, 0],
      ['Raalro', 6.3, 0, 0, 1, 17, 24, 29, 1, 2, 0, 0, 0, 0],
    ],
  },
  // Amistosos de 11 jugadores: filas más separadas, cifras de color y guiones finos. EA no da
  // regates, intercepciones, bloqueos ni despejes en amistosos: sin dato (null), no 0.
  'amistoso-mecha-brs-2-1.png': {
    home: false,
    score: [1, 2],
    rival: 'MECHA BRS',
    competition: 'AMISTOSO',
    rows: [
      ['apirlo5', 8.0, 0, 0, 0, null, 22, 31, 3, 5, null, null, null, 0],
      ['fIakjto', 7.9, 0, 0, 1, null, 9, 13, 2, 3, null, null, null, 0],
      ['nedus', 7.8, 0, 0, 0, null, 16, 24, 2, 2, null, null, null, 0],
      ['Kamikazeeeplay', 7.7, 0, 1, 0, null, 8, 13, 4, 11, null, null, null, 0],
      ['willl_mich', 7.2, 0, 0, 0, null, 13, 24, 2, 2, null, null, null, 0],
      ['ReisHjN', 7.2, 1, 0, 2, null, 12, 13, 1, 4, null, null, null, 0],
      ['ChinoMaKina', 6.9, 0, 0, 0, null, 7, 10, 0, 4, null, null, null, 0],
      ['Raalro', 6.7, 0, 0, 0, null, 6, 7, 1, 1, null, null, null, 0],
      ['Cabimas123', 6.5, 0, 0, 0, null, 10, 14, 1, 1, null, null, null, 0],
      ['MigueVinotinto9', 5.9, 0, 0, 1, null, 9, 12, 0, 4, null, null, null, 0],
      ['RM CAAMs', 5.4, 0, 0, 0, null, 2, 3, 0, 0, null, null, null, 3],
    ],
  },
  'amistoso-yerb4teros-1-0.png': {
    home: true,
    score: [1, 0],
    rival: 'YERB4TEROS GG',
    competition: 'AMISTOSO',
    rows: [
      ['Gabogame3821877', 7.7, 0, 0, 0, null, 19, 25, 2, 6, null, null, null, 0],
      ['ChinoMaKina', 7.5, 0, 0, 0, null, 15, 16, 1, 2, null, null, null, 0],
      ['apirlo5', 7.3, 0, 0, 0, null, 17, 25, 2, 4, null, null, null, 0],
      ['nedus', 7.2, 0, 0, 1, null, 15, 18, 0, 0, null, null, null, 0],
      ['MigueVinotinto9', 7.0, 1, 0, 3, null, 7, 14, 1, 8, null, null, null, 0],
      ['Cabimas123', 7.0, 0, 0, 0, null, 17, 21, 1, 2, null, null, null, 0],
      ['Kamikazeeeplay', 7.0, 0, 0, 0, null, 13, 15, 1, 4, null, null, null, 0],
      ['mmls0390', 6.9, 0, 0, 0, null, 10, 12, 1, 1, null, null, null, 0],
      ['fIakjto', 6.8, 0, 0, 0, null, 13, 14, 0, 0, null, null, null, 0],
      ['ReisHjN', 6.3, 0, 0, 0, null, 14, 16, 1, 2, null, null, null, 0],
      ['RM CAAMs', 6.1, 0, 0, 0, null, 9, 11, 0, 0, null, null, null, 1],
    ],
  },
};

// Gamertags conocidos del club (como los que PIRLO tiene de sus fichas y sesiones).
const KNOWN = [
  'Raalro',
  'apirlo5',
  'nedus',
  'willl_mich',
  'RM CAAMs',
  'fIakjto',
  'Kamikazeeeplay',
  'ChinoMaKina',
  'Cabimas123',
  'ReisHjN',
  'mmls0390',
];

describe('lectura real de imágenes de Our Pro Club', () => {
  withOcr(
    'lee marcador, rival y todas las columnas de cada jugador sin errores',
    async () => {
      const ocr = await tesseract!();
      try {
        for (const [file, exp] of Object.entries(EXPECTED)) {
          const r = await readMatchImage(fixture(file), ocr, KNOWN);
          expect(r !== null).toBe(true);
          const m = toClubMatch(r!, ['Marítimo CF'], '2026-10-26');
          expect(m !== null).toBe(true);
          // En esa tipografía «O» y «0» son casi iguales: el nombre del rival se compara sin distinguirlas.
          const o0 = (v: string) => v.replace(/0/g, 'O');
          expect([m!.home, m!.goalsFor, m!.goalsAgainst, o0(m!.opponentName)]).toEqual([
            exp.home,
            ...exp.score,
            o0(exp.rival),
          ]);
          expect(m!.competition).toBe(exp.competition ?? 'LIGA');
          expect(
            m!.players.map((p) => [
              p.name,
              p.rating,
              p.goals,
              p.assists,
              p.shots,
              p.dribbles,
              p.passesMade,
              p.passesAttempted,
              p.tacklesMade,
              p.tacklesAttempted,
              p.interceptions,
              p.blocks,
              p.clearances,
              p.saves,
            ]),
          ).toEqual(exp.rows);
        }
      } finally {
        await ocr.close();
      }
    },
    180_000,
  );
});
