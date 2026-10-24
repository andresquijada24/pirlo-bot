import type { APIApplicationCommandStringOption } from 'discord-api-types/v10';
import { resolveContext } from '../../core/context.js';
import type { ClubContext, ClubRole } from '../../core/types.js';
import { OT } from '../constants.js';
import { optString } from '../interaction.js';
import type { CommandContext } from './types.js';

/** Opción "club": solo hace falta en servidores con varios clubes. */
export const clubOption: APIApplicationCommandStringOption = {
  type: OT.String,
  name: 'club',
  description: 'Identificador del club (solo si el servidor tiene varios)',
  required: false,
  max_length: 40,
};

export const ROLE_LABELS: Record<ClubRole, string> = {
  admin: 'Admin',
  dt: 'DT',
  capitan: 'Capitán',
  jugador: 'Jugador',
};

export const roleChoices = (Object.keys(ROLE_LABELS) as ClubRole[]).map((r) => ({
  name: ROLE_LABELS[r],
  value: r,
}));

/** Resuelve el club (y la membresía del actor) para el comando en curso. */
export function contextFor(ctx: CommandContext): Promise<ClubContext> {
  return resolveContext(ctx.repos, ctx.actor, optString(ctx.command, 'club'));
}

/** Menciona a un usuario de Discord (las respuestas no notifican: allowed_mentions vacío). */
export const mention = (discordUserId: string | null) => (discordUserId ? `<@${discordUserId}>` : '—');
