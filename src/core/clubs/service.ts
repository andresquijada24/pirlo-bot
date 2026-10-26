import type { Repositories } from '../../db/repositories/types.js';
import { permissionDenied } from '../errors.js';
import { assertCan } from '../permissions/index.js';
import type { Actor, ChannelPurpose, ClubContext } from '../types.js';
import { clubNameSchema, parse, slugSchema, snowflakeSchema, websiteSchema } from '../validation.js';

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

/**
 * Conecta un club que ya existe (por su identificador) al servidor actual, p. ej. para pasar del
 * servidor de pruebas al servidor real sin perder plantilla, sesiones ni temporadas.
 * Requiere "Gestionar servidor" en este servidor y ser admin del club (lo comprueba la base de datos).
 */
export async function connectClubToGuild(
  repos: Pick<Repositories, 'clubs'>,
  actor: Actor,
  input: { slug: string; guildName: string | null },
): Promise<{ clubId: string; slug: string }> {
  if (!actor.isGuildManager) {
    throw permissionDenied('Solo quien puede gestionar este servidor puede conectar un club a él.');
  }
  const slug = parse(slugSchema, input.slug);
  const clubId = await repos.clubs.connectGuild({
    slug,
    guildId: actor.guildId,
    guildName: input.guildName,
    actorDiscordId: actor.discordUserId,
  });
  return { clubId, slug };
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

/**
 * Desconecta el club del servidor desde el que se ejecuta el comando (p. ej. el de pruebas, tras
 * pasar al servidor real). Solo un admin del club (no basta con gestionar el servidor de Discord).
 * No puede ser el último servidor del club. Los canales configurados en él se quitan.
 */
export async function disconnectFromGuild(repos: Pick<Repositories, 'clubs'>, ctx: ClubContext): Promise<void> {
  if (ctx.membership?.role !== 'admin') {
    throw permissionDenied('Solo un admin del club puede desconectarlo de un servidor.');
  }
  await repos.clubs.disconnectGuild(ctx.club.id, ctx.actor.guildId, ctx.actor.discordUserId);
}

/** Guarda (o quita, con null) el escudo del club. Solo un admin del club. */
export async function setClubCrest(
  repos: Pick<Repositories, 'clubs'>,
  ctx: ClubContext,
  pngBase64: string | null,
): Promise<void> {
  if (ctx.membership?.role !== 'admin') {
    throw permissionDenied('Solo un admin del club puede cambiar el escudo.');
  }
  await repos.clubs.setCrest(ctx.club.id, pngBase64, ctx.actor.discordUserId);
}

/** URL pública de la web de PIRLO BOT. */
export const PUBLIC_BASE_URL = 'https://pirlo-bot.vercel.app';

/** Activa o desactiva la página web pública del club. Solo un admin del club. */
export async function setClubWeb(
  repos: Pick<Repositories, 'clubs'>,
  ctx: ClubContext,
  isPublic: boolean,
): Promise<string> {
  if (ctx.membership?.role !== 'admin') {
    throw permissionDenied('Solo un admin del club puede activar o desactivar la página web.');
  }
  await repos.clubs.setWebPublic(ctx.club.id, isPublic, ctx.actor.discordUserId);
  return `${PUBLIC_BASE_URL}/club/${ctx.club.slug}`;
}

/** Guarda (o quita, con null) el sitio web oficial del club. Solo un admin del club. */
export async function setClubWebsite(
  repos: Pick<Repositories, 'clubs'>,
  ctx: ClubContext,
  url: string | null,
): Promise<string | null> {
  if (ctx.membership?.role !== 'admin') {
    throw permissionDenied('Solo un admin del club puede cambiar su sitio web.');
  }
  const clean = url === null ? null : parse(websiteSchema, url);
  await repos.clubs.setWebsite(ctx.club.id, clean, ctx.actor.discordUserId);
  return clean;
}
