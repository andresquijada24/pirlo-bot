/**
 * Contrato común de proveedores de estadísticas.
 *
 * Principios:
 * - Cada proveedor declara sus CAPACIDADES. No se asume que todos ofrecen lo mismo.
 * - Un dato que la fuente no ofrece es `null`, nunca `0`. PIRLO BOT no inventa estadísticas.
 * - La sincronización es incremental mediante un cursor opaco propio de cada proveedor.
 *
 * Implementaciones previstas: maritimo (API autenticada), ourproclub (acceso autorizado),
 * ea (stub hasta tener acceso verificable) y manual (registro por DT/capitán).
 */

export type ProviderId = 'maritimo' | 'ourproclub' | 'ea' | 'manual';

export interface ProviderCapabilities {
  goals: boolean;
  assists: boolean;
  tackles: boolean;
  /** 'verified': la fuente confirma portería imbatida; 'unverified': solo se puede deducir. */
  cleanSheets: 'verified' | 'unverified' | 'none';
  sessions: boolean;
  seasons: boolean;
}

/** Referencia mínima a un club que necesita un proveedor. Nunca incluye secretos. */
export interface ClubRef {
  clubId: string;
  externalClubId: string | null;
}

export interface ExternalPlayer {
  externalId: string;
  displayName: string;
  gamertag: string | null;
  position: string | null;
}

export interface ExternalPlayerStats {
  externalPlayerId: string;
  positionPlayed: string | null;
  goals: number | null;
  assists: number | null;
  tacklesMade: number | null;
  tacklesAttempted: number | null;
  cleanSheetVerified: boolean | null;
}

export interface ExternalMatch {
  externalId: string;
  playedAt: string; // ISO 8601
  externalSessionId: string | null;
  externalSeasonId: string | null;
  opponentName: string | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  /** Versión o fecha de modificación en origen, para detectar correcciones históricas. */
  sourceVersion: string | null;
  players: ExternalPlayerStats[];
}

export interface MatchPage {
  matches: ExternalMatch[];
  nextCursor: string | null;
}

export interface StatsProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  listPlayers(club: ClubRef): Promise<ExternalPlayer[]>;
  fetchMatchesSince(club: ClubRef, cursor: string | null): Promise<MatchPage>;
}
