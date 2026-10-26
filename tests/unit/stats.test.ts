import { describe, expect, it } from 'vitest';
import { aggregate, rank, type SessionStatRow } from '../../src/core/stats/service.js';

// Filas ficticias de v_player_session_season_stats, solo para pruebas.
const row = (over: Partial<SessionStatRow>): SessionStatRow => ({
  seasonId: null,
  playerId: null,
  source: 'maritimo',
  sourcePlayerId: 'x',
  name: 'X',
  sessions: 1,
  matchesPlayed: null,
  goals: null,
  assists: null,
  shots: null,
  dribbles: null,
  passesMade: null,
  passesAttempted: null,
  tacklesMade: null,
  tacklesAttempted: null,
  interceptions: null,
  blocks: null,
  clearances: null,
  saves: null,
  ratingPoints: null,
  ratedMatches: null,
  cleanSheets: null,
  ...over,
});

describe('aggregate', () => {
  it('suma varias temporadas y fichas de un mismo jugador vinculado', () => {
    const [t] = aggregate(
      [
        row({ playerId: 'p1', sourcePlayerId: 'a', seasonId: 's1', sessions: 2, goals: 3, matchesPlayed: 4, ratingPoints: 28, ratedMatches: 4 }),
        row({ playerId: 'p1', sourcePlayerId: 'gt:alt', seasonId: 's2', sessions: 1, goals: 1, matchesPlayed: 2, ratingPoints: 16, ratedMatches: 2 }),
      ],
      new Map([['p1', 'Andrés']]),
    );
    expect(t).toMatchObject({ name: 'Andrés', linked: true, sessions: 3, goals: 4, matchesPlayed: 6, avgRating: 7.33 });
  });

  it('sin dato sigue siendo sin dato (null), no cero', () => {
    const [t] = aggregate([row({ goals: 2, assists: null, saves: null })]);
    expect(t).toMatchObject({ goals: 2, assists: null, saves: null, avgRating: null, passPct: null });
    // Con las asistencias sin dato, G+A tampoco se puede afirmar.
    expect(t!.goalContributions).toBeNull();
  });

  it('G+A solo se calcula con goles y asistencias conocidos', () => {
    expect(aggregate([row({})])[0]!.goalContributions).toBeNull();
    expect(aggregate([row({ goals: 2, assists: 1 })])[0]!.goalContributions).toBe(3);
  });

  it('calcula porcentajes con los totales, no promediando porcentajes', () => {
    const [t] = aggregate([
      row({ playerId: 'p', passesMade: 9, passesAttempted: 10 }),
      row({ playerId: 'p', sourcePlayerId: 'y', passesMade: 41, passesAttempted: 90 }),
    ]);
    expect(t!.passPct).toBe(50);
  });

  it('separa a los jugadores sin vincular por su id del proveedor', () => {
    const totals = aggregate([
      row({ sourcePlayerId: 'a', name: 'Uno', goals: 1 }),
      row({ sourcePlayerId: 'b', name: 'Dos', goals: 1 }),
    ]);
    expect(totals.map((t) => [t.name, t.linked])).toEqual([['Uno', false], ['Dos', false]]);
  });
});

describe('rank', () => {
  const totals = aggregate([
    row({ playerId: 'a', name: 'Ana', goals: 5, matchesPlayed: 10, ratingPoints: 70, ratedMatches: 10, passesMade: 40, passesAttempted: 49 }),
    row({ playerId: 'b', name: 'Beto', goals: 5, matchesPlayed: 3, ratingPoints: 27, ratedMatches: 3, passesMade: 80, passesAttempted: 100 }),
    row({ playerId: 'c', name: 'Caro', goals: 2, matchesPlayed: 6, ratingPoints: 39, ratedMatches: 6 }),
    row({ playerId: 'd', name: 'Dani', goals: 0 }),
    row({ playerId: 'e', name: 'Eva', goals: null }),
  ]);

  it('ordena de mayor a menor y los empates comparten puesto', () => {
    const r = rank(totals, 'goles');
    expect(r.map((e) => [e.position, e.totals.name, e.value])).toEqual([
      [1, 'Ana', 5],
      [1, 'Beto', 5],
      [3, 'Caro', 2],
    ]);
  });

  it('deja fuera a quien no tiene el dato o tiene cero', () => {
    const names = rank(totals, 'goles').map((e) => e.totals.name);
    expect(names).not.toContain('Dani');
    expect(names).not.toContain('Eva');
  });

  it('la nota exige un mínimo de partidos con nota', () => {
    expect(rank(totals, 'nota').map((e) => e.totals.name)).toEqual(['Ana', 'Caro']);
  });

  it('la precisión de pase exige un mínimo de pases intentados', () => {
    expect(rank(totals, 'pases').map((e) => [e.totals.name, e.value])).toEqual([['Beto', 80]]);
  });

  it('respeta el límite', () => {
    expect(rank(totals, 'goles', 1).map((e) => e.totals.name)).toEqual(['Ana', 'Beto']);
  });
});
