import { isDomainError } from '../core/errors.js';
import { ProviderError, type ExternalSession, type StatsProvider } from '../providers/types.js';
import type { SyncRepository } from './types.js';

/**
 * Motor de sincronización incremental de un proveedor hacia UN club.
 *
 * Orden:
 *   1. Se descarga todo lo cambiado desde el último cursor: jugadores, sesiones y borrados.
 *   2. Se aplican jugadores (para que las sesiones ya encuentren la ficha vinculada), luego
 *      borrados y por último sesiones, en orden de `updatedAt`.
 *   3. El nuevo cursor es la hora del servidor MÁS ANTIGUA de las descargas. Si el tiempo
 *      se agota a mitad, se guarda como cursor la versión de la última sesión aplicada: la
 *      siguiente ejecución continúa desde ahí (repetir una sesión no la duplica).
 *
 * Una sesión borrada en origen entre la descarga de sesiones y la de borrados puede volver
 * a insertarse en esta pasada; como el cursor es anterior al borrado, la siguiente pasada
 * lo vuelve a aplicar. El resultado converge sin perder datos.
 */

export interface SyncDeps {
  repo: SyncRepository;
  provider: StatsProvider;
  clubId: string;
  /** Tiempo máximo para aplicar sesiones (ms). Por defecto 45 s. */
  budgetMs?: number;
  now?: () => number;
  log?: { error: (obj: object, msg: string) => void };
}

export interface SyncResult {
  status: 'ok' | 'parcial' | 'error' | 'omitida';
  message?: string;
  players?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  deleted?: number;
  cursor?: string | null;
}

const ms = (iso: string) => Date.parse(iso);
const earliest = (a: string, b: string) => (ms(a) <= ms(b) ? a : b);

/** El proveedor puede repetir registros entre páginas: se queda la versión más reciente. */
function dedupe<T extends { externalId: string; updatedAt?: string }>(items: T[]): T[] {
  const byId = new Map<string, T>();
  for (const it of items) {
    const prev = byId.get(it.externalId);
    if (!prev || !prev.updatedAt || !it.updatedAt || ms(it.updatedAt) >= ms(prev.updatedAt)) {
      byId.set(it.externalId, it);
    }
  }
  return [...byId.values()];
}

const byVersion = (a: ExternalSession, b: ExternalSession) =>
  ms(a.updatedAt) - ms(b.updatedAt) || a.externalId.localeCompare(b.externalId);

/** Mensaje apto para guardarse y mostrarse a un admin. Nunca incluye secretos. */
function safeMessage(err: unknown): string {
  if (err instanceof ProviderError) return err.message;
  if (isDomainError(err) && err.code !== 'INTERNAL') return err.message;
  return 'Error interno durante la sincronización.';
}

export async function runSync(deps: SyncDeps): Promise<SyncResult> {
  const { repo, provider, clubId } = deps;
  const now = deps.now ?? Date.now;
  const budget = deps.budgetMs ?? 45_000;

  const configured = await repo.clubProvider(clubId);
  if (configured !== provider.id) {
    return {
      status: 'omitida',
      message:
        configured === null
          ? 'El club configurado no existe.'
          : `El club usa el proveedor "${configured}", no "${provider.id}".`,
    };
  }

  const since = await repo.lastCursor(clubId, provider.id);
  const runId = await repo.startRun(clubId, provider.id, since);
  const started = now();

  try {
    const players = await provider.playersSince(since);
    const sessions = await provider.sessionsSince(since);
    const deletions = provider.capabilities.deletions && provider.deletionsSince
      ? await provider.deletionsSince(since)
      : null;

    let cursor = earliest(players.serverTime, sessions.serverTime);
    if (deletions) cursor = earliest(cursor, deletions.serverTime);

    const playerItems = dedupe(players.items);
    const applied = playerItems.length
      ? await repo.applyPlayers(clubId, provider.id, playerItems)
      : 0;

    let deleted = 0;
    for (const d of deletions?.items ?? []) {
      if (await repo.applyDeletion(clubId, provider.id, d)) deleted++;
    }

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let partial = false;
    let lastApplied: string | null = null;
    for (const s of dedupe(sessions.items).sort(byVersion)) {
      if (now() - started > budget) {
        partial = true;
        break;
      }
      const r = await repo.applySession(clubId, provider.id, s);
      if (r === 'insertada') inserted++;
      else if (r === 'actualizada') updated++;
      else unchanged++;
      lastApplied = s.updatedAt;
    }
    // Tiempo agotado: se continúa desde la última sesión aplicada (o desde donde se empezó).
    const next: string | null = partial ? (lastApplied ?? since) : cursor;

    await repo.finishRun(clubId, runId, {
      status: 'ok',
      cursorAfter: next,
      rowsInserted: inserted,
      rowsUpdated: updated + deleted,
      errorMessage: partial ? 'Parcial: continúa en la próxima ejecución.' : null,
    });
    return {
      status: partial ? 'parcial' : 'ok',
      players: applied,
      inserted,
      updated,
      unchanged,
      deleted,
      cursor: next,
    };
  } catch (err) {
    const message = safeMessage(err);
    deps.log?.error({ err, clubId, provider: provider.id }, 'Sincronización fallida');
    await repo.finishRun(clubId, runId, {
      status: 'error',
      cursorAfter: null,
      rowsInserted: 0,
      rowsUpdated: 0,
      errorMessage: message,
    });
    return { status: 'error', message };
  }
}
