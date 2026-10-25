import type { CachedMatch, EA_MATCH_TYPES, EA_PLATFORMS } from './ingest.js';

/**
 * Convierte un partido de EA Pro Clubs (tal como quedó en la caché) en filas de PIRLO.
 *
 * Reglas:
 * - EA envía casi todos los números como texto. Un valor ausente o con formato inesperado es
 *   "sin dato" (null), nunca 0.
 * - Se guardan los jugadores de ambos equipos; el lado 'rival' solo existe dentro del club que
 *   jugó el partido y nunca cuenta para rankings ni estadísticas de la plantilla.
 */

export type EaSide = 'propio' | 'rival';
export type EaResult = 'victoria' | 'empate' | 'derrota';

export interface EaPlayerLine {
  side: EaSide;
  eaPlayerId: string;
  gamertag: string;
  position: string | null;
  secondsPlayed: number | null;
  rating: number | null;
  goals: number | null;
  assists: number | null;
  shots: number | null;
  passesMade: number | null;
  passesAttempted: number | null;
  tacklesMade: number | null;
  tacklesAttempted: number | null;
  saves: number | null;
  goalsConceded: number | null;
  redCards: number | null;
  manOfTheMatch: boolean | null;
}

export interface ProcessedEaMatch {
  matchId: string;
  platform: (typeof EA_PLATFORMS)[number];
  eaClubId: string;
  matchType: (typeof EA_MATCH_TYPES)[number];
  playedAt: string;
  goalsFor: number | null;
  goalsAgainst: number | null;
  result: EaResult | null;
  opponentEaClubId: string | null;
  opponentName: string | null;
  players: EaPlayerLine[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Entero no negativo (EA lo envía como "3" o 3). Cualquier otra cosa: sin dato. */
export function eaInt(v: unknown, max = 32_767): number | null {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n <= max ? n : null;
}

/** Nota de 0 a 10 con hasta 2 decimales. */
export function eaRating(v: unknown): number | null {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!/^\d{1,2}(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return n >= 0 && n <= 10 ? n : null;
}

function eaFlag(v: unknown): boolean | null {
  const n = eaInt(v);
  return n === null ? null : n > 0;
}

function eaText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length >= 1 && s.length <= max ? s : null;
}

function playerLines(raw: unknown, side: EaSide): EaPlayerLine[] {
  if (!isRecord(raw)) return [];
  const out: EaPlayerLine[] = [];
  for (const [eaPlayerId, p] of Object.entries(raw)) {
    if (!/^\d{1,20}$/.test(eaPlayerId) || !isRecord(p)) continue;
    const gamertag = eaText(p.playername, 40);
    if (!gamertag) continue;
    out.push({
      side,
      eaPlayerId,
      gamertag,
      position: eaText(p.pos, 20),
      secondsPlayed: eaInt(p.secondsPlayed, 1_000_000),
      rating: eaRating(p.rating),
      goals: eaInt(p.goals),
      assists: eaInt(p.assists),
      shots: eaInt(p.shots),
      passesMade: eaInt(p.passesmade),
      passesAttempted: eaInt(p.passattempts),
      tacklesMade: eaInt(p.tacklesmade),
      tacklesAttempted: eaInt(p.tackleattempts),
      saves: eaInt(p.saves),
      goalsConceded: eaInt(p.goalsconceded),
      redCards: eaInt(p.redcards),
      manOfTheMatch: eaFlag(p.mom),
    });
  }
  return out;
}

/**
 * Procesa un partido de la caché para el club de EA `cached.eaClubId`.
 * Devuelve null si el partido no tiene la forma esperada (p. ej. sin exactamente un rival).
 */
export function processEaMatch(
  cached: Omit<CachedMatch, 'payload'> & { payload: unknown },
): ProcessedEaMatch | null {
  const payload = cached.payload;
  if (!isRecord(payload) || !isRecord(payload.clubs)) return null;
  const ours = payload.clubs[cached.eaClubId];
  const opponentIds = Object.keys(payload.clubs).filter((k) => k !== cached.eaClubId);
  if (!isRecord(ours) || opponentIds.length !== 1) return null;
  const opponentEaClubId = opponentIds[0]!;
  const opponent = payload.clubs[opponentEaClubId];
  const opp = isRecord(opponent) ? opponent : {};

  const goalsFor = eaInt(ours.goals);
  const goalsAgainst = eaInt(opp.goals) ?? eaInt(ours.goalsAgainst);
  const result: EaResult | null =
    goalsFor === null || goalsAgainst === null
      ? null
      : goalsFor > goalsAgainst
        ? 'victoria'
        : goalsFor < goalsAgainst
          ? 'derrota'
          : 'empate';
  const details = isRecord(opp.details) ? opp.details : {};
  const players = isRecord(payload.players) ? payload.players : {};

  return {
    matchId: cached.matchId,
    platform: cached.platform,
    eaClubId: cached.eaClubId,
    matchType: cached.matchType,
    playedAt: cached.playedAt,
    goalsFor,
    goalsAgainst,
    result,
    opponentEaClubId: /^\d{1,12}$/.test(opponentEaClubId) ? opponentEaClubId : null,
    opponentName: eaText(details.name, 80),
    players: [
      ...playerLines(players[cached.eaClubId], 'propio'),
      ...playerLines(players[opponentEaClubId], 'rival'),
    ],
  };
}
