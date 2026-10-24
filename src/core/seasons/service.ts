import type { Repositories } from '../../db/repositories/types.js';
import { assertCan } from '../permissions/index.js';
import type { ClubContext, Season } from '../types.js';
import { DomainError, validation } from '../errors.js';
import { calendarDateSchema, parse, seasonNameSchema } from '../validation.js';

export async function createSeason(
  repos: Pick<Repositories, 'seasons'>,
  ctx: ClubContext,
  input: { name: string; makeCurrent: boolean },
): Promise<Season> {
  assertCan(ctx, 'season.manage');
  return repos.seasons.create(
    ctx.club.id,
    parse(seasonNameSchema, input.name),
    input.makeCurrent,
    ctx.actor.discordUserId,
  );
}

export async function listSeasons(
  repos: Pick<Repositories, 'seasons'>,
  ctx: ClubContext,
): Promise<Season[]> {
  assertCan(ctx, 'club.view');
  return repos.seasons.list(ctx.club.id);
}

/**
 * Pone fecha de inicio (y de fin, opcional) a una temporada y reasigna las sesiones del club según
 * su fecha. Sin nombre se usa la temporada actual. Solo admin.
 */
export async function setSeasonDates(
  repos: Pick<Repositories, 'seasons'>,
  ctx: ClubContext,
  input: { seasonName?: string | null | undefined; startsOn: string; endsOn?: string | null | undefined },
): Promise<{ season: Season; moved: number }> {
  assertCan(ctx, 'season.manage');
  const startsOn = parse(calendarDateSchema, input.startsOn);
  const endsOn = input.endsOn ? parse(calendarDateSchema, input.endsOn) : null;
  if (endsOn !== null && endsOn < startsOn) {
    throw validation('La fecha de fin no puede ser anterior a la de inicio.');
  }

  const seasons = await repos.seasons.list(ctx.club.id);
  const wanted = input.seasonName?.trim().toLowerCase();
  const season = wanted
    ? seasons.find((s) => s.name.trim().toLowerCase() === wanted)
    : seasons.find((s) => s.isCurrent);
  if (!season) {
    if (wanted) throw new DomainError('NOT_FOUND', 'No existe una temporada con ese nombre en este club.');
    throw validation('No hay temporada actual. Indica el nombre de la temporada.');
  }

  const moved = await repos.seasons.setDates(ctx.club.id, season.id, startsOn, endsOn, ctx.actor.discordUserId);
  return { season: { ...season, startsOn, endsOn }, moved };
}
