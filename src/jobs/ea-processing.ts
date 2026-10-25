import type { Repositories } from '../db/repositories/types.js';
import { processEaMatch } from '../providers/ea/matches.js';

/**
 * Procesa los partidos de EA guardados en la caché para cada club con consentimiento.
 * Se ejecuta en la tarea programada. Sin partidos en la caché (no hay fuente autorizada), no hace nada.
 */

export interface EaProcessingResult {
  clubs: number;
  processed: number;
  /** Partidos con formato inesperado: se dejan en la caché sin procesar. */
  skipped: number;
  errors: string[];
}

const PER_CLUB = 20;

export async function runEaProcessing(deps: {
  repos: Pick<Repositories, 'ea'>;
  log?: { error: (obj: object, msg: string) => void };
}): Promise<EaProcessingResult> {
  const result: EaProcessingResult = { clubs: 0, processed: 0, skipped: 0, errors: [] };
  const links = await deps.repos.ea.listLinks();
  for (const link of links) {
    result.clubs++;
    try {
      const r = await processClubEaMatches(deps.repos, link.clubId, PER_CLUB);
      result.processed += r.processed;
      result.skipped += r.skipped;
    } catch (err) {
      // Un club con problemas no detiene a los demás. No se registran datos del partido.
      deps.log?.error({ err, clubId: link.clubId }, 'Fallo al procesar partidos de EA');
      result.errors.push(link.clubId);
    }
  }
  return result;
}

/** Procesa los partidos pendientes de un club. Lo usan la tarea programada y la importación manual. */
export async function processClubEaMatches(
  repos: Pick<Repositories, 'ea'>,
  clubId: string,
  limit = PER_CLUB,
  /** Hora límite (ms desde epoch): lo que no dé tiempo se procesa en la próxima tarea. */
  deadline = Infinity,
): Promise<{ processed: number; skipped: number }> {
  let processed = 0;
  let skipped = 0;
  for (const cached of await repos.ea.pending(clubId, limit)) {
    if (Date.now() > deadline) break;
    const match = processEaMatch(cached);
    if (!match) {
      skipped++;
      continue;
    }
    if (await repos.ea.apply(clubId, match)) processed++;
  }
  return { processed, skipped };
}
