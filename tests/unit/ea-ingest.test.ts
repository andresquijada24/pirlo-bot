import { describe, expect, it } from 'vitest';
import { parseIngest } from '../../src/providers/ea/ingest.js';

// Partido con la forma de la API de EA; ids y gamertags ficticios.
const match = (matchId: string, clubs: string[] = ['111', '222']) => ({
  matchId,
  timestamp: 1792894060,
  timeAgo: { number: 9, unit: 'hours' },
  clubs: Object.fromEntries(clubs.map((c) => [c, { goals: '2', result: '1' }])),
  players: { '111': { '1': { playername: 'JugadorFicticio', goals: '1', rating: '7.70' } } },
});

describe('parseIngest', () => {
  it('guarda los partidos del club pedido tal cual llegan', () => {
    const r = parseIngest({ platform: 'common-gen5', eaClubId: '111', matchType: 'leagueMatch', matches: [match('900001')] });
    expect(r.rejected).toBe(0);
    expect(r.matches[0]).toMatchObject({
      platform: 'common-gen5',
      eaClubId: '111',
      matchId: '900001',
      matchType: 'leagueMatch',
      playedAt: '2026-10-25T02:07:40.000Z',
    });
    expect(r.matches[0]!.payload).toEqual(match('900001'));
  });

  it('descarta partidos en los que no jugó ese club o con formato inesperado', () => {
    const r = parseIngest({
      platform: 'common-gen5',
      eaClubId: '111',
      matchType: 'leagueMatch',
      matches: [match('900002', ['333', '444']), { foo: 'bar' }, match('900003')],
    });
    expect(r.matches.map((m) => m.matchId)).toEqual(['900003']);
    expect(r.rejected).toBe(2);
  });

  it('rechaza plataformas, tipos o ids no válidos', () => {
    const base = { platform: 'common-gen5', eaClubId: '111', matchType: 'leagueMatch', matches: [] };
    expect(() => parseIngest({ ...base, platform: 'pc' })).toThrow();
    expect(() => parseIngest({ ...base, matchType: 'rank' })).toThrow();
    expect(() => parseIngest({ ...base, eaClubId: '../x' })).toThrow();
    expect(() => parseIngest({ ...base, matches: Array(26).fill(match('1')) })).toThrow();
  });
});
