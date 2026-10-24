import { assertCan } from '../permissions/index.js';
import type { ClubContext, Membership, Season } from '../types.js';
import type { Repositories } from '../../db/repositories/types.js';

/**
 * Estadísticas por sesión (MARÍTIMO CF y proveedores similares).
 *
 * Reglas:
 * - Un total es null si NINGUNA fila tiene el dato: "sin dato" no es "cero".
 * - Los porcentajes y la nota solo se muestran en rankings con un mínimo de muestra,
 *   para que dos partidos afortunados no encabecen la tabla.
 */

/** Fila de v_player_session_season_stats (ya excluye sesiones duplicadas). */
export interface SessionStatRow {
  seasonId: string | null;
  playerId: string | null;
  source: string;
  sourcePlayerId: string;
  name: string;
  sessions: number;
  matchesPlayed: number | null;
  goals: number | null;
  assists: number | null;
  shots: number | null;
  dribbles: number | null;
  passesMade: number | null;
  passesAttempted: number | null;
  tacklesMade: number | null;
  tacklesAttempted: number | null;
  interceptions: number | null;
  blocks: number | null;
  clearances: number | null;
  saves: number | null;
  ratingPoints: number | null;
  ratedMatches: number | null;
}

export interface PlayerTotals {
  key: string;
  playerId: string | null;
  name: string;
  linked: boolean;
  sessions: number;
  matchesPlayed: number | null;
  goals: number | null;
  assists: number | null;
  goalContributions: number | null;
  shots: number | null;
  dribbles: number | null;
  passesMade: number | null;
  passesAttempted: number | null;
  passPct: number | null;
  tacklesMade: number | null;
  tacklesAttempted: number | null;
  tacklePct: number | null;
  interceptions: number | null;
  blocks: number | null;
  clearances: number | null;
  saves: number | null;
  avgRating: number | null;
  ratedMatches: number | null;
}

const SUMMED = [
  'matchesPlayed', 'goals', 'assists', 'shots', 'dribbles', 'passesMade', 'passesAttempted',
  'tacklesMade', 'tacklesAttempted', 'interceptions', 'blocks', 'clearances', 'saves',
  'ratingPoints', 'ratedMatches',
] as const;
type Summed = (typeof SUMMED)[number];

const addNullable = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : a + b;
const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;
const pct = (made: number | null, attempted: number | null) =>
  made !== null && attempted !== null && attempted > 0 ? round((100 * made) / attempted, 1) : null;

/**
 * Agrupa filas por jugador. Un jugador vinculado suma todas sus fichas; uno sin vincular se
 * identifica por su id en el proveedor.
 */
export function aggregate(rows: SessionStatRow[], names: ReadonlyMap<string, string> = new Map()): PlayerTotals[] {
  const groups = new Map<string, { first: SessionStatRow; sessions: number; sums: Record<Summed, number | null> }>();
  for (const r of rows) {
    const key = r.playerId ?? `${r.source}:${r.sourcePlayerId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        first: r,
        sessions: 0,
        sums: Object.fromEntries(SUMMED.map((k) => [k, null])) as Record<Summed, number | null>,
      };
      groups.set(key, g);
    }
    g.sessions += r.sessions;
    for (const k of SUMMED) g.sums[k] = addNullable(g.sums[k], r[k]);
  }

  return [...groups.entries()].map(([key, g]) => {
    const s = g.sums;
    const playerId = g.first.playerId;
    return {
      key,
      playerId,
      name: (playerId && names.get(playerId)) || g.first.name,
      linked: playerId !== null,
      sessions: g.sessions,
      matchesPlayed: s.matchesPlayed,
      goals: s.goals,
      assists: s.assists,
      goalContributions: s.goals === null && s.assists === null ? null : (s.goals ?? 0) + (s.assists ?? 0),
      shots: s.shots,
      dribbles: s.dribbles,
      passesMade: s.passesMade,
      passesAttempted: s.passesAttempted,
      passPct: pct(s.passesMade, s.passesAttempted),
      tacklesMade: s.tacklesMade,
      tacklesAttempted: s.tacklesAttempted,
      tacklePct: pct(s.tacklesMade, s.tacklesAttempted),
      interceptions: s.interceptions,
      blocks: s.blocks,
      clearances: s.clearances,
      saves: s.saves,
      avgRating:
        s.ratingPoints !== null && s.ratedMatches !== null && s.ratedMatches > 0
          ? round(s.ratingPoints / s.ratedMatches, 2)
          : null,
      ratedMatches: s.ratedMatches,
    };
  });
}

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------

export interface RankingMetric {
  label: string;
  value: (t: PlayerTotals) => number | null;
  /** Muestra mínima para entrar en el ranking (null = sin mínimo). */
  minimum?: { value: (t: PlayerTotals) => number | null; at: number; label: string };
  format?: (n: number) => string;
}

export const MIN_PASSES = 50;
export const MIN_TACKLES = 20;
export const MIN_RATED_MATCHES = 5;

export const RANKING_METRICS = {
  goles: { label: 'Goles', value: (t) => t.goals },
  asistencias: { label: 'Asistencias', value: (t) => t.assists },
  ga: { label: 'Goles + asistencias', value: (t) => t.goalContributions },
  partidos: { label: 'Partidos jugados', value: (t) => t.matchesPlayed },
  nota: {
    label: 'Nota media',
    value: (t) => t.avgRating,
    minimum: { value: (t) => t.ratedMatches, at: MIN_RATED_MATCHES, label: 'partidos con nota' },
    format: (n) => n.toFixed(2),
  },
  pases: {
    label: 'Precisión de pase',
    value: (t) => t.passPct,
    minimum: { value: (t) => t.passesAttempted, at: MIN_PASSES, label: 'pases intentados' },
    format: (n) => `${n.toFixed(1)} %`,
  },
  entradas: { label: 'Entradas ganadas', value: (t) => t.tacklesMade },
  precision_entradas: {
    label: 'Precisión de entradas',
    value: (t) => t.tacklePct,
    minimum: { value: (t) => t.tacklesAttempted, at: MIN_TACKLES, label: 'entradas intentadas' },
    format: (n) => `${n.toFixed(1)} %`,
  },
  intercepciones: { label: 'Intercepciones', value: (t) => t.interceptions },
  tiros: { label: 'Tiros', value: (t) => t.shots },
  regates: { label: 'Regates', value: (t) => t.dribbles },
  paradas: { label: 'Paradas', value: (t) => t.saves },
} satisfies Record<string, RankingMetric>;
export type RankingMetricId = keyof typeof RANKING_METRICS;

export interface RankingEntry {
  position: number;
  totals: PlayerTotals;
  value: number;
}

/** Ordena de mayor a menor; los empates comparten posición. Sin dato o sin muestra: fuera. */
export function rank(totals: PlayerTotals[], metricId: RankingMetricId, limit = 10): RankingEntry[] {
  const metric: RankingMetric = RANKING_METRICS[metricId];
  const eligible = totals
    .map((t) => ({ totals: t, value: metric.value(t) }))
    .filter((e): e is { totals: PlayerTotals; value: number } => e.value !== null)
    .filter((e) => !metric.minimum || (metric.minimum.value(e.totals) ?? 0) >= metric.minimum.at)
    .filter((e) => e.value > 0 || metric.minimum !== undefined)
    .sort((a, b) => b.value - a.value || a.totals.name.localeCompare(b.totals.name, 'es'));

  const out: RankingEntry[] = [];
  for (const [i, e] of eligible.entries()) {
    const prev = out[i - 1];
    const position = prev && prev.value === e.value ? prev.position : i + 1;
    if (position > limit) break;
    out.push({ position, ...e });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Casos de uso
// ---------------------------------------------------------------------------

export type SeasonScope = 'actual' | 'todas';

/** Temporada a consultar: la actual si existe; "todas" (o sin temporada actual) = historial. */
export async function resolveSeason(
  repos: Repositories,
  ctx: ClubContext,
  scope: SeasonScope,
): Promise<Season | null> {
  if (scope === 'todas') return null;
  const seasons = await repos.seasons.list(ctx.club.id);
  return seasons.find((s) => s.isCurrent) ?? null;
}

async function memberNames(repos: Repositories, clubId: string): Promise<Map<string, string>> {
  const roster = await repos.memberships.listActive(clubId);
  return new Map(roster.map((m) => [m.playerId, m.displayName]));
}

export async function playerStats(
  repos: Repositories,
  ctx: ClubContext,
  member: Membership,
  season: Season | null,
): Promise<PlayerTotals | null> {
  assertCan(ctx, 'stats.view');
  const rows = await repos.stats.sessionRows(ctx.club.id, season?.id ?? null);
  const mine = rows.filter((r) => r.playerId === member.playerId);
  if (mine.length === 0) return null;
  const [totals] = aggregate(mine, new Map([[member.playerId, member.displayName]]));
  return totals ?? null;
}

export async function ranking(
  repos: Repositories,
  ctx: ClubContext,
  metricId: RankingMetricId,
  season: Season | null,
  limit = 10,
): Promise<RankingEntry[]> {
  assertCan(ctx, 'stats.view');
  const [rows, names] = await Promise.all([
    repos.stats.sessionRows(ctx.club.id, season?.id ?? null),
    memberNames(repos, ctx.club.id),
  ]);
  return rank(aggregate(rows, names), metricId, limit);
}
