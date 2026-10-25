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
      for (const cached of await deps.repos.ea.pending(link.clubId, PER_CLUB)) {
        const match = processEaMatch(cached);
        if (!match) {
          result.skipped++;
          continue;
        }
        if (await deps.repos.ea.apply(link.clubId, match)) result.processed++;
      }
    } catch (err) {
      // Un club con problemas no detiene a los demás. No se registran datos del partido.
      deps.log?.error({ err, clubId: link.clubId }, 'Fallo al procesar partidos de EA');
      result.errors.push(link.clubId);
    }
  }
  return result;
}
