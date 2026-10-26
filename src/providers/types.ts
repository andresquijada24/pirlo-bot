/**
 * Contrato común de proveedores de estadísticas.
 *
 * Principios:
 * - Cada proveedor declara sus CAPACIDADES. No se asume que todos ofrecen lo mismo.
 * - Un dato que la fuente no ofrece es `null`, nunca `0`. PIRLO BOT no inventa estadísticas.
 * - Sincronización incremental: se pide "lo que cambió desde <fecha>" y el proveedor devuelve
 *   también la hora del servidor, que será el punto de partida de la siguiente sincronización.
 * - Granularidad explícita: un proveedor puede informar por PARTIDO o por SESIÓN (varios
 *   partidos seguidos, como los resúmenes de OurProClub).
 *
 * Implementaciones: maritimo (API api_v1), ourproclub, ea (stub) y manual.
 */

export type ProviderId = 'maritimo' | 'ourproclub' | 'ea' | 'manual';

export interface ProviderCapabilities {
  granularity: 'partido' | 'sesion';
  goals: boolean;
  assists: boolean;
  tackles: boolean;
  passes: boolean;
  rating: boolean;
  /** 'verified': la fuente confirma portería imbatida; 'none': no hay dato. */
  cleanSheets: 'verified' | 'unverified' | 'none';
  /** El proveedor informa registros borrados. */
  deletions: boolean;
}

export interface ExternalPlayer {
  externalId: string;
  gamertag: string;
  platform: 'ps' | 'xbox' | 'pc' | null;
  positions: string[];
  shirtNumber: number | null;
  active: boolean;
  updatedAt: string;
}

/** Métricas de un jugador en una sesión. Cada métrica ausente es null. */
export interface ExternalSessionPlayerStats {
  /** Id estable del jugador en el proveedor; null si no tiene ficha en el club de origen. */
  externalPlayerId: string | null;
  /** Nombre tal como lo publica la fuente (puede cambiar con el tiempo). */
  gamertag: string;
  matchesPlayed: number | null;
  rating: number | null;
  goals: number | null;
  assists: number | null;
  goalsManual: number | null;
  assistsManual: number | null;
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
}

export interface ExternalSession {
  externalId: string;
  publishedAt: string;
  /** Fecha de juego (AAAA-MM-DD) según el corte de día del proveedor. */
  playedOn: string;
  matchesPlayed: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  /** Si es una copia publicada dos veces, id de la sesión original. */
  duplicateOf: string | null;
  /** Versión en origen: cambia cuando la sesión o sus filas se corrigen. */
  updatedAt: string;
  players: ExternalSessionPlayerStats[];
}

/** Partido del calendario del proveedor (competición y marcador, sin estadísticas). */
export interface ExternalMatch {
  externalId: string;
  competition: 'liga' | 'copa' | 'amistoso' | 'torneo' | 'relampago';
  name: string | null;
  opponent: string | null;
  startsAt: string;
  /** Estado en origen (finalizado, cancelado…). */
  state: string;
  goalsFor: number | null;
  goalsAgainst: number | null;
  updatedAt: string;
}

export interface ExternalDeletion {
  kind: 'jugador' | 'sesion' | 'partido';
  externalId: string;
  deletedAt: string;
}

/** Resultado de una consulta incremental completa (todas las páginas). */
export interface Pull<T> {
  items: T[];
  /** Hora del servidor al empezar: será el próximo `since`. */
  serverTime: string;
}

export interface StatsProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  /** Comprueba conexión y credenciales. */
  ping(): Promise<{ ok: true; serverTime: string }>;
  playersSince(since: string | null): Promise<Pull<ExternalPlayer>>;
  sessionsSince(since: string | null): Promise<Pull<ExternalSession>>;
  deletionsSince?(since: string | null): Promise<Pull<ExternalDeletion>>;
  /** Calendario del club (para separar liga, copa y amistosos). */
  matchesSince?(since: string | null): Promise<Pull<ExternalMatch>>;
}

/** Error de un proveedor. `message` es apto para mostrarse a un admin; nunca incluye secretos. */
export class ProviderError extends Error {
  constructor(
    readonly kind: 'auth' | 'rate_limited' | 'unavailable' | 'invalid_response' | 'request',
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
