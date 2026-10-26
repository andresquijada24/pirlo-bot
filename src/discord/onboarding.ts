import { isDomainError } from '../core/errors.js';
import { CHANNEL_PURPOSES, type ChannelPurpose } from '../core/types.js';
import type { Repositories } from '../db/repositories/types.js';
import { REFERENCE_GUILD_ID } from '../jobs/reminders.js';
import { requestApproval } from '../core/platform.js';
import { normalizeCrest } from '../render/crest.js';

/**
 * Alta automática de un club cuando alguien añade PIRLO BOT a su servidor desde la web.
 *
 * Discord avisa con el evento APPLICATION_AUTHORIZED (webhook HTTP, sin Gateway). Para añadir un
 * bot a un servidor Discord exige el permiso "Gestionar servidor", así que quien lo instala queda
 * como admin del club, igual que con /club registrar.
 *
 * - Nunca actúa en el servidor de referencia ni en los bloqueados.
 * - Si el servidor ya tiene un club, no hace nada (Discord reintenta eventos: debe ser idempotente).
 * - Asigna los canales cuyo nombre coincide con un propósito (#resultados, #convocatorias…).
 * - El club queda PENDIENTE hasta que el dueño de PIRLO BOT lo aprueba (DM con botones).
 * - Envía un mensaje privado de bienvenida a quien lo instaló (no publica en el servidor).
 */

export interface GuildApi {
  /** Canales de texto del servidor (id y nombre). */
  textChannels(guildId: string): Promise<{ id: string; name: string }[]>;
  /** Ícono del servidor (bytes PNG, hasta 256 px) o null si no tiene. */
  guildIcon?(guildId: string): Promise<Uint8Array | null>;
  /** Nombre de un servidor donde está el bot (null si no se puede leer). */
  guildName?(guildId: string): Promise<string | null>;
  /** Mensaje privado a un usuario. */
  dm(userId: string, body: Record<string, unknown>): Promise<void>;
}

export interface OnboardingInput {
  guildId: string;
  guildName: string;
  userId: string;
  userName: string;
}

export type OnboardingResult =
  | { status: 'creado'; slug: string; channels: ChannelPurpose[] }
  | { status: 'existente' | 'bloqueado' | 'invalido' };

const SNOWFLAKE = /^\d{17,20}$/;

/** "Lacritas FC ⚽" → "lacritas-fc". Vacío si no queda nada utilizable. */
export function slugFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 34)
    .replace(/-+$/g, '');
}

/** Propósito de un canal según su nombre ("📢-anuncios", "resultados-ea"…). */
export function purposeForChannel(name: string): ChannelPurpose | null {
  const n = slugFromName(name);
  return CHANNEL_PURPOSES.find((p) => n.split('-').includes(p)) ?? null;
}

export async function onboardGuild(
  deps: {
    repos: Pick<Repositories, 'clubs' | 'channels' | 'audit'>;
    api: GuildApi;
    blockedGuilds: ReadonlySet<string>;
    /** Dueños de PIRLO BOT: reciben la solicitud de aprobación. */
    ownerIds: ReadonlySet<string>;
    log?: { error: (obj: object, msg: string) => void };
  },
  input: OnboardingInput,
): Promise<OnboardingResult> {
  const { repos, api } = deps;
  if (!SNOWFLAKE.test(input.guildId) || !SNOWFLAKE.test(input.userId))
    return { status: 'invalido' };
  if (input.guildId === REFERENCE_GUILD_ID || deps.blockedGuilds.has(input.guildId)) {
    return { status: 'bloqueado' };
  }
  if ((await repos.clubs.listByGuild(input.guildId)).length > 0) return { status: 'existente' };

  const name = input.guildName.trim().slice(0, 80) || 'Mi club';
  const base = slugFromName(name) || 'club';
  let slug = '';
  let clubId = '';
  for (let i = 0; i < 6 && !clubId; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    try {
      const res = await repos.clubs.register({
        guildId: input.guildId,
        guildName: name,
        slug: candidate,
        name,
        adminDiscordId: input.userId,
        adminDisplayName: input.userName.slice(0, 80) || 'Admin',
      });
      slug = candidate;
      clubId = res.clubId;
    } catch (err) {
      // Identificador ocupado: se prueba el siguiente. Cualquier otro error se propaga.
      if (!(isDomainError(err) && err.code === 'CONFLICT')) throw err;
      if ((await repos.clubs.listByGuild(input.guildId)).length > 0) return { status: 'existente' };
    }
  }
  if (!clubId) return { status: 'invalido' };

  // Aprobación final del dueño: el club no funciona hasta que la aprueba.
  await requestApproval(
    { repos, platform: { ownerIds: deps.ownerIds, api }, ...(deps.log ? { log: deps.log } : {}) },
    { id: clubId, slug, name },
    { userId: input.userId, userName: input.userName, guildName: name },
  );

  // Canales por nombre. Un fallo aquí no deshace el alta: se configuran luego con /club canal.
  const channels: ChannelPurpose[] = [];
  try {
    for (const ch of await api.textChannels(input.guildId)) {
      const purpose = purposeForChannel(ch.name);
      if (!purpose || channels.includes(purpose) || !SNOWFLAKE.test(ch.id)) continue;
      await repos.channels.set(clubId, input.guildId, purpose, ch.id);
      channels.push(purpose);
    }
  } catch (err) {
    deps.log?.error({ err, guildId: input.guildId }, 'No se pudieron detectar los canales');
  }

  await repos.audit
    .log({
      clubId,
      actorDiscordId: input.userId,
      action: 'club.onboarded',
      entity: 'club',
      entityId: clubId,
      details: { slug, channels },
    })
    .catch(() => undefined);

  await api
    .dm(input.userId, {
      content: welcomeMessage(name, slug, channels),
      allowed_mentions: { parse: [] },
    })
    .catch((err: unknown) =>
      deps.log?.error({ err }, 'No se pudo enviar la bienvenida por privado'),
    );
  // Escudo automático: el ícono del servidor (el club puede cambiarlo con /club escudo).
  if (api.guildIcon) {
    try {
      const icon = await api.guildIcon(input.guildId);
      if (icon) await repos.clubs.setAutoCrest(clubId, await normalizeCrest(icon));
    } catch (err) {
      deps.log?.error({ err, guildId: input.guildId }, 'No se pudo poner el escudo automático');
    }
  }
  return { status: 'creado', slug, channels };
}

export function welcomeMessage(name: string, slug: string, channels: ChannelPurpose[]): string {
  const missing = CHANNEL_PURPOSES.filter((p) => !channels.includes(p));
  return [
    `**¡PIRLO BOT ya está en ${name}!** El club quedó creado y eres su admin.`,
    '⏳ Falta la aprobación final de PIRLO BOT: te avisaremos por aquí en cuanto esté activo.',
    channels.length
      ? `Canales detectados: ${channels.map((p) => `**${p}**`).join(', ')}.`
      : 'No encontré canales con nombres como #resultados o #convocatorias.',
    missing.length ? `Puedes asignar los demás con \`/club canal\` (${missing.join(', ')}).` : '',
    '',
    '**Cuando esté aprobado (opcional):**',
    '• `/club ea vincular` para conectar tu club de EA SPORTS FC.',
    '• `/club escudo` para subir el escudo y `/club sitio` para enlazar vuestra web. La página del club en PIRLO se publica sola (`/club web activar:No` la retira).',
    '• Los jugadores se unen con `/vincular`; tú apruebas con `/solicitudes`.',
    '',
    `Identificador del club: \`${slug}\`.`,
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
}

/** Cliente REST mínimo para el alta (token del bot; nunca aparece en errores). */
export function createGuildApi(
  botToken: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 1_500,
): GuildApi {
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const res = await fetchFn(`https://discord.com/api/v10${path}`, {
      method,
      headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Discord respondió HTTP ${res.status}`);
    return (await res.json()) as unknown;
  };
  return {
    async guildIcon(guildId) {
      if (!SNOWFLAKE.test(guildId)) return null;
      const g = (await call('GET', `/guilds/${guildId}`)) as { icon?: unknown };
      if (typeof g.icon !== 'string' || !/^(a_)?[0-9a-f]{32}$/.test(g.icon)) return null;
      // Solo el CDN de Discord, en PNG (también para íconos animados) y con tamaño acotado.
      const res = await fetchFn(`https://cdn.discordapp.com/icons/${guildId}/${g.icon}.png?size=256`, {
        signal: AbortSignal.timeout(timeoutMs * 2),
      });
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      return buf.byteLength > 0 && buf.byteLength <= 2_000_000 ? buf : null;
    },
    async guildName(guildId) {
      if (!SNOWFLAKE.test(guildId)) return null;
      const g = (await call('GET', `/guilds/${guildId}`)) as { name?: unknown };
      return typeof g.name === 'string' && g.name.trim() ? g.name.trim().slice(0, 100) : null;
    },
    async textChannels(guildId) {
      if (!SNOWFLAKE.test(guildId)) return [];
      const list = await call('GET', `/guilds/${guildId}/channels`);
      if (!Array.isArray(list)) return [];
      return list
        .filter((c): c is { id: string; name: string; type: number } => {
          const o = c as { id?: unknown; name?: unknown; type?: unknown };
          return (
            typeof o.id === 'string' && typeof o.name === 'string' && (o.type === 0 || o.type === 5)
          );
        })
        .map((c) => ({ id: c.id, name: c.name }));
    },
    async dm(userId, body) {
      if (!SNOWFLAKE.test(userId)) return;
      const ch = (await call('POST', '/users/@me/channels', { recipient_id: userId })) as {
        id?: unknown;
      };
      if (typeof ch.id !== 'string' || !SNOWFLAKE.test(ch.id)) return;
      await call('POST', `/channels/${ch.id}/messages`, body);
    },
  };
}
