import type { ExternalDeletion, ExternalMatch, ExternalPlayer, ExternalSession, ProviderId } from '../providers/types.js';

export type SessionApplyResult = 'insertada' | 'actualizada' | 'sin_cambios';

export interface SyncRunSummary {
  id: string;
  status: 'en_curso' | 'ok' | 'error';
  startedAt: string;
  finishedAt: string | null;
  cursorAfter: string | null;
  rowsInserted: number;
  rowsUpdated: number;
  errorMessage: string | null;
}

export interface FinishRunInput {
  status: 'ok' | 'error';
  cursorAfter: string | null;
  rowsInserted: number;
  rowsUpdated: number;
  errorMessage: string | null;
}

/**
 * Acceso a datos que necesita la sincronización. Todo método exige `clubId`: un proveedor
 * escribe solo en el club al que está vinculado.
 */
export interface SyncRepository {
  /** Proveedor configurado para el club, o null si el club no existe. */
  clubProvider(clubId: string): Promise<ProviderId | null>;
  lastRun(clubId: string, provider: ProviderId): Promise<SyncRunSummary | null>;
  /** Cursor de la última ejecución correcta (próximo `since`). */
  lastCursor(clubId: string, provider: ProviderId): Promise<string | null>;
  /**
   * Abre una ejecución. Las que llevan "en curso" demasiado tiempo se cierran como error.
   * Lanza CONFLICT si ya hay otra en curso.
   */
  startRun(clubId: string, provider: ProviderId, cursorBefore: string | null): Promise<string>;
  finishRun(clubId: string, runId: string, input: FinishRunInput): Promise<void>;
  applyPlayers(clubId: string, provider: ProviderId, players: ExternalPlayer[]): Promise<number>;
  applySession(clubId: string, provider: ProviderId, session: ExternalSession): Promise<SessionApplyResult>;
  applyDeletion(clubId: string, provider: ProviderId, deletion: ExternalDeletion): Promise<boolean>;
  /** Versión en origen más reciente del calendario guardado (null: nunca se importó). */
  lastMatchVersion(clubId: string, provider: ProviderId): Promise<string | null>;
  applyMatch(clubId: string, provider: ProviderId, match: ExternalMatch): Promise<SessionApplyResult>;
}
