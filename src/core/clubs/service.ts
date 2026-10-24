import type { Repositories } from '../../db/repositories/types.js';
import { permissionDenied } from '../errors.js';
import { assertCan } from '../permissions/index.js';
import type { Actor, ChannelPurpose, ClubContext } from '../types.js';
import { clubNameSchema, parse, slugSchema, snowflakeSchema } from '../validation.js';

/**
 * Registra un club en el servidor actual. Solo quien tiene "Gestionar servidor" en Discord.
 * Quien lo registra queda como admin del club (operación atómica en la base de datos).
 */
export async function registerClub(
  repos: Pick<Repositories, 'clubs'>,
  actor: Actor,
  input: { slug: string; name: string; guildName: string | null },
): Promise<{ clubId: string; membershipId: string; slug: string }> {
  if (!actor.isGuildManager) {
    throw permissionDenied('Solo quien puede gestionar el servidor puede registrar un club.');
  }
  const slug = parse(slugSchema, input.slug);
  const name = parse(clubNameSchema, input.name);
  const result = await repos.clubs.register({
    guildId: actor.guildId,
    guildName: input.guildName,
    slug,
    name,
    adminDiscordId: actor.discordUserId,
    adminDisplayName: actor.displayName,
  });
  return { ...result, slug };
}

/** Asigna un canal del servidor a un propósito del club (anuncios, convocatorias…). */
export async function configureChannel(
  repos: Pick<Repositories, 'channels' | 'audit'>,
  ctx: ClubContext,
  purpose: ChannelPurpose,
  channelId: string,
): Promise<void> {
  assertCan(ctx, 'club.configure');
  const id = parse(snowflakeSchema, channelId);
  // El guildId sale del contexto: solo se pueden usar canales del servidor donde se ejecuta.
  await repos.channels.set(ctx.club.id, ctx.actor.guildId, purpose, id);
  await repos.audit.log({
    clubId: ctx.club.id,
    actorDiscordId: ctx.actor.discordUserId,
    action: 'club.channel.set',
    entity: 'channel',
    entityId: id,
    details: { purpose },
  });
}
