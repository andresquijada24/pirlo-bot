import type { APIInteraction } from 'discord-api-types/v10';

/**
 * Construye interacciones de Discord de PRUEBA (formato de la API v10).
 * Los IDs son ficticios y no corresponden a servidores ni usuarios reales.
 */
export const TEST_GUILD = '900000000000000001';
export const OTHER_GUILD = '900000000000000002';

/** Permisos: "Gestionar servidor" = 32. */
export const MANAGE_GUILD = '32';

interface Who {
  userId: string;
  name?: string;
  guildId?: string;
  permissions?: string;
}

function member(who: Who) {
  return {
    user: { id: who.userId, username: who.name ?? `user${who.userId.slice(-3)}`, global_name: null },
    nick: who.name ?? null,
    permissions: who.permissions ?? '0',
    roles: [],
  };
}

type Opt = { name: string; type: number; value?: string | boolean; options?: Opt[] };

export function slash(who: Who, name: string, sub: string | null, options: Opt[] = []): APIInteraction {
  const data = {
    id: '1',
    type: 1,
    name,
    options: sub ? [{ name: sub, type: 1, options }] : options,
  };
  return {
    id: '1',
    application_id: '1562889315657195530',
    type: 2,
    token: 't',
    version: 1,
    guild_id: who.guildId ?? TEST_GUILD,
    member: member(who),
    data,
  } as unknown as APIInteraction;
}

export function button(who: Who, customId: string, messageId?: string, channelId = '930000000000000001'): APIInteraction {
  return {
    ...(messageId ? { message: { id: messageId, channel_id: channelId }, channel: { id: channelId } } : {}),
    id: '1',
    application_id: '1562889315657195530',
    type: 3,
    token: 't',
    version: 1,
    guild_id: who.guildId ?? TEST_GUILD,
    member: member(who),
    data: { custom_id: customId, component_type: 2 },
  } as unknown as APIInteraction;
}

export const str = (name: string, value: string): Opt => ({ name, type: 3, value });
export const bool = (name: string, value: boolean): Opt => ({ name, type: 5, value });
export const user = (name: string, value: string): Opt => ({ name, type: 6, value });
export const channel = (name: string, value: string): Opt => ({ name, type: 7, value });

/** Texto visible de una respuesta (contenido + embeds), para comprobar mensajes. */
export function textOf(res: unknown): string {
  const data = (res as { data?: { content?: string; embeds?: { title?: string; description?: string; fields?: { name: string; value: string }[] }[] } }).data;
  const parts = [data?.content ?? ''];
  for (const e of data?.embeds ?? []) {
    parts.push(e.title ?? '', e.description ?? '');
    for (const f of e.fields ?? []) parts.push(f.name, f.value);
  }
  return parts.join('\n');
}
