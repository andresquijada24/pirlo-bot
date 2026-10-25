import type { EaLink, EaMatchSummary, Repositories } from '../../db/repositories/types.js';
import { EA_PLATFORMS } from '../../providers/ea/ingest.js';
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
