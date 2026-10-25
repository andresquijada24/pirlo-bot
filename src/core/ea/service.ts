import type { EaLink, EaMatchSummary, Repositories } from '../../db/repositories/types.js';
import { EA_MATCH_TYPES, EA_PLATFORMS, parseIngest } from '../../providers/ea/ingest.js';
import { processClubEaMatches } from '../../jobs/ea-processing.js';
import { permissionDenied, validation } from '../errors.js';
import { assertCan } from '../permissions/index.js';
import type { ClubContext } from '../types.js';

/**
 * Consentimiento de cada club para usar sus partidos de EA.
 *
 * Solo un admin del club puede darlo o retirarlo (lo comprueba también la base de datos). Sin
 * consentimiento, PIRLO no guarda ni procesa partidos de ese club de EA. El consentimiento del
 * club no sustituye al de EA: PIRLO solo procesa partidos que lleguen por una fuente autorizada.
 */

export type EaPlatform = (typeof EA_PLATFORMS)[number];

export const EA_PLATFORM_LABELS: Record<EaPlatform, string> = {
  'common-gen5': 'PS5 / Xbox Series / PC',
  'common-gen4': 'PS4 / Xbox One',
};

function assertAdmin(ctx: ClubContext, what: string): void {
  if (ctx.membership?.role !== 'admin')
    throw permissionDenied(`Solo un admin del club puede ${what}.`);
}

export async function linkEaClub(
  repos: Pick<Repositories, 'ea'>,
  ctx: ClubContext,
  input: { platform: string; eaClubId: string },
): Promise<EaLink> {
  assertAdmin(ctx, 'vincular el club de EA');
  const eaClubId = input.eaClubId.trim();
  if (!/^\d{1,12}$/.test(eaClubId))
    throw validation('El ID del club de EA son solo números, p. ej. 55341.');
  const platform = EA_PLATFORMS.find((p) => p === input.platform);
  if (!platform) throw validation('Plataforma no válida.');
  await repos.ea.link(ctx.club.id, platform, eaClubId, ctx.actor.discordUserId);
  const link = await repos.ea.getLink(ctx.club.id);
  if (!link) throw validation('No se pudo guardar el vínculo.');
  return link;
}

export async function unlinkEaClub(
  repos: Pick<Repositories, 'ea'>,
  ctx: ClubContext,
): Promise<boolean> {
  assertAdmin(ctx, 'retirar el consentimiento de EA');
  return repos.ea.unlink(ctx.club.id, ctx.actor.discordUserId);
}

export async function eaStatus(
  repos: Pick<Repositories, 'ea'>,
  ctx: ClubContext,
): Promise<{ link: EaLink | null; recent: EaMatchSummary[] }> {
  assertCan(ctx, 'sync.view');
  const link = await repos.ea.getLink(ctx.club.id);
  // Los partidos ya procesados se muestran aunque se haya retirado el consentimiento.
  return { link, recent: await repos.ea.recent(ctx.club.id, 5) };
}

export type EaMatchType = (typeof EA_MATCH_TYPES)[number];

export interface EaImportResult {
  received: number;
  /** Partidos nuevos guardados (los repetidos se ignoran). */
  stored: number;
  /** Partidos del archivo en los que no jugó el club de EA vinculado, o con formato inesperado. */
  rejected: number;
  processed: number;
}

/**
 * Importa un archivo de partidos de EA que un admin o DT guardó desde su navegador (la página de
 * partidos de su club). PIRLO no lee de EA: solo procesa lo que la persona sube. Solo se aceptan
 * partidos del club de EA vinculado con consentimiento a este club.
 */
export async function importEaFile(
  repos: Pick<Repositories, 'ea' | 'eaCapture'>,
  ctx: ClubContext,
  input: { text: string; matchType: string },
): Promise<EaImportResult> {
  assertCan(ctx, 'sync.view');
  const link = await repos.ea.getLink(ctx.club.id);
  if (!link)
    throw validation('Primero un admin tiene que vincular el club de EA con `/club ea vincular`.');
  const matchType = EA_MATCH_TYPES.find((t) => t === input.matchType);
  if (!matchType) throw validation('Tipo de partido no válido.');

  let raw: unknown;
  try {
    raw = JSON.parse(input.text);
  } catch {
    throw validation(
      'El archivo no es el de EA: debe empezar por `[` y contener los partidos tal cual.',
    );
  }
  if (!Array.isArray(raw)) throw validation('El archivo no es una lista de partidos de EA.');
  let parsed;
  try {
    parsed = parseIngest({
      platform: link.platform,
      eaClubId: link.eaClubId,
      matchType,
      matches: raw,
    });
  } catch {
    throw validation('El archivo no tiene el formato de partidos de EA (máximo 25 partidos).');
  }
  const stored = await repos.eaCapture.store(parsed.matches);
  // Discord espera la respuesta en menos de 3 s: lo que no se procese ahora lo hace la tarea
  // programada (cada 15 min).
  const { processed } = await processClubEaMatches(repos, ctx.club.id, 25, Date.now() + 1_000);
  return { received: raw.length, stored, rejected: parsed.rejected, processed };
}
