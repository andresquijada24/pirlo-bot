import type { Repositories } from '../db/repositories/types.js';
import type { GuildApi } from '../discord/onboarding.js';
import { normalizeCrest } from '../render/crest.js';

/**
 * Escudo automático: a los clubes activos sin escudo se les pone el ícono de su servidor de
 * Discord (solo servidores que son únicamente suyos). Nunca sustituye un escudo subido por el
 * club, y el club puede cambiarlo o quitarlo cuando quiera con /club escudo.
 */
export interface AutoCrestResult {
  checked: number;
  saved: number;
}

export async function runAutoCrests(deps: {
  repos: Pick<Repositories, 'clubs'>;
  api: Pick<GuildApi, 'guildIcon'>;
  /** Normaliza la imagen (256 px, PNG en base64). Inyectable para pruebas. */
  normalize?: (bytes: Uint8Array) => Promise<string>;
  limit?: number;
  log?: { error: (obj: object, msg: string) => void };
}): Promise<AutoCrestResult> {
  const result: AutoCrestResult = { checked: 0, saved: 0 };
  if (!deps.api.guildIcon) return result;
  const normalize = deps.normalize ?? ((b: Uint8Array) => normalizeCrest(b));
  for (const club of await deps.repos.clubs.withoutCrest(deps.limit ?? 10)) {
    result.checked++;
    for (const guildId of club.guildIds) {
      try {
        const icon = await deps.api.guildIcon(guildId);
        if (!icon) continue;
        if (await deps.repos.clubs.setAutoCrest(club.clubId, await normalize(icon))) result.saved++;
        break;
      } catch (err) {
        deps.log?.error({ err, clubId: club.clubId }, 'No se pudo poner el escudo automático');
      }
    }
  }
  return result;
}
