import type { Repositories } from '../../db/repositories/types.js';
import { assertCan } from '../permissions/index.js';
import type { ClubContext, Season } from '../types.js';
import { parse, seasonNameSchema } from '../validation.js';

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
