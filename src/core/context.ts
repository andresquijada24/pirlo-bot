import type { Repositories } from '../db/repositories/types.js';
import { DomainError } from './errors.js';
import type { Actor, Club, ClubContext } from './types.js';

/**
 * Determina sobre qué club actúa el usuario en un servidor de Discord.
 *
 *   - Servidor sin clubes → CLUB_NOT_REGISTERED.
 *   - Un solo club → ese club (el parámetro `slug`, si llega, debe coincidir).
 *   - Varios clubes (modalidad multiclub) → hace falta `slug`; si falta → CLUB_AMBIGUOUS.
 *
 * Solo se consideran los clubes vinculados a ESTE servidor: desde un servidor nunca se puede
 * operar sobre un club de otro servidor, aunque se conozca su identificador.
 */
export async function resolveClub(
  repos: Pick<Repositories, 'clubs'>,
  guildId: string,
  slug?: string,
): Promise<Club> {
  const all = await repos.clubs.listByGuild(guildId);
  const clubs = all.filter((c) => c.status === 'activo');

  if (clubs.length === 0 && all.some((c) => c.status === 'pendiente')) {
    throw new DomainError(
      'CLUB_NOT_REGISTERED',
      '⏳ El club de este servidor está pendiente de aprobación por PIRLO BOT. Te avisaremos por mensaje privado.',
    );
  }
  if (clubs.length === 0 && all.some((c) => c.status === 'rechazado')) {
    throw new DomainError('CLUB_NOT_REGISTERED', 'El club de este servidor no fue aprobado por PIRLO BOT.');
  }
  if (clubs.length === 0) {
    throw new DomainError(
      'CLUB_NOT_REGISTERED',
      'Este servidor no tiene ningún club registrado. Un administrador puede usar /club registrar.',
    );
  }

  if (slug !== undefined) {
    const match = clubs.find((c) => c.slug === slug);
    if (!match) {
      throw new DomainError('NOT_FOUND', `No hay ningún club "${slug}" en este servidor.`);
    }
    return match;
  }

  if (clubs.length > 1) {
    const names = clubs.map((c) => `\`${c.slug}\``).join(', ');
    throw new DomainError(
      'CLUB_AMBIGUOUS',
      `Este servidor tiene varios clubes (${names}). Indica cuál con la opción "club".`,
    );
  }

  return clubs[0] as Club;
}

/** Resuelve club y membresía del actor. La membresía se busca SIEMPRE dentro del club resuelto. */
export async function resolveContext(
  repos: Pick<Repositories, 'clubs' | 'memberships'>,
  actor: Actor,
  slug?: string,
): Promise<ClubContext> {
  const club = await resolveClub(repos, actor.guildId, slug);
  const membership = await repos.memberships.findActiveByDiscordUser(club.id, actor.discordUserId);
  return { actor, club, membership };
}
