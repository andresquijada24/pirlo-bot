import type { EaRecap, SessionRecap, SessionRecapPlayer } from '../../db/repositories/types.js';

/**
 * Agrupa partidos de EA en SESIONES (los jugados el mismo día en la zona horaria del club) para
 * publicarlos con la misma tarjeta de resumen que los clubes por sesión. Con EA hay marcador de
 * cada partido, así que también salen las porterías a cero. Lo que EA no da queda en null.
 */

export interface EaSession extends SessionRecap {
  /** Partidos de la sesión, del más antiguo al más reciente. */
  matches: EaRecap[];
}

/** Día local (AAAA-MM-DD) de un instante en una zona horaria. */
export function localDay(iso: string, timeZone: string): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const add = (a: number | null, b: number | null) => (b === null ? a : (a ?? 0) + b);

export function eaSessions(
  recaps: EaRecap[],
  timeZone: string,
  /** Media de calificación de la temporada por nombre (en minúsculas). */
  seasonRatings: ReadonlyMap<string, number> = new Map(),
): EaSession[] {
  const byDay = new Map<string, EaRecap[]>();
  for (const r of [...recaps].sort((a, b) => a.playedAt.localeCompare(b.playedAt))) {
    const day = localDay(r.playedAt, timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), r]);
  }
  return [...byDay.entries()].map(([day, matches]) => {
    const players = new Map<string, SessionRecapPlayer & { ratingSum: number; rated: number }>();
    for (const m of matches) {
      for (const p of m.players) {
        const key = p.name.toLowerCase();
        const cur =
          players.get(key) ??
          ({
            name: p.name,
            playerId: null,
            matchesPlayed: 0,
            rating: null,
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
            seasonRating: seasonRatings.get(key) ?? null,
            ratingSum: 0,
            rated: 0,
          } satisfies SessionRecapPlayer & { ratingSum: number; rated: number });
        cur.matchesPlayed = (cur.matchesPlayed ?? 0) + 1;
        cur.goals = add(cur.goals, p.goals);
        cur.assists = add(cur.assists, p.assists);
        cur.shots = add(cur.shots, p.shots);
        cur.passesMade = add(cur.passesMade, p.passesMade);
        cur.passesAttempted = add(cur.passesAttempted, p.passesAttempted);
        cur.tacklesMade = add(cur.tacklesMade, p.tacklesMade);
        cur.tacklesAttempted = add(cur.tacklesAttempted, p.tacklesAttempted);
        cur.saves = add(cur.saves, p.saves);
        if (p.rating !== null) {
          cur.ratingSum += p.rating;
          cur.rated++;
        }
        players.set(key, cur);
      }
    }
    const count = (k: NonNullable<EaRecap['result']>) =>
      matches.filter((m) => m.result === k).length;
    const scored = matches.filter((m) => m.goalsAgainst !== null);
    return {
      sessionId: `ea:${day}:${matches[0]!.matchId}`,
      playedOn: day,
      publishedAt: matches.at(-1)!.playedAt,
      matchesPlayed: matches.length,
      wins: count('victoria'),
      draws: count('empate'),
      losses: count('derrota'),
      cleanSheets: scored.length ? scored.filter((m) => m.goalsAgainst === 0).length : null,
      matches,
      players: [...players.values()].map(({ ratingSum, rated, ...p }) => ({
        ...p,
        rating: rated ? Math.round((ratingSum / rated) * 10) / 10 : null,
      })),
    };
  });
}
