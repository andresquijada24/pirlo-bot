import type { DiscordEmbed } from '../providers/ourproclub/recap.js';

/**
 * Lectura de mensajes de un canal por la API REST de Discord (sin Gateway), con el token del bot.
 * La usa el espejo de Our Pro Club. Para ver el contenido de mensajes de otros bots, la aplicación
 * necesita «Message Content Intent» activado en el portal de desarrolladores de Discord.
 * El token nunca aparece en errores ni en logs.
 */

export interface DiscordMessage {
  id: string;
  timestamp: string;
  author: { id: string; username: string; bot: boolean };
  embeds: DiscordEmbed[];
  attachments: { url: string; filename: string; contentType: string | null; size: number }[];
}

export interface ChannelReader {
  /** Mensajes del canal, del más antiguo al más reciente. `after`: solo los posteriores a ese id. */
  messages(channelId: string, opts: { after?: string; limit: number }): Promise<DiscordMessage[]>;
  /** Imagen adjunta (solo CDN de Discord, hasta 8 MB). */
  image(url: string): Promise<Uint8Array>;
}

const SNOWFLAKE = /^\d{17,20}$/;
const CDN = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
export const MAX_IMAGE_BYTES = 8_000_000;

export class ChannelReadError extends Error {
  constructor(readonly status: number) {
    super(`Discord respondió HTTP ${status} al leer el canal.`);
    this.name = 'ChannelReadError';
  }
}

export function createChannelReader(
  botToken: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 5_000,
): ChannelReader {
  return {
    async messages(channelId, { after, limit }) {
      if (!SNOWFLAKE.test(channelId)) return [];
      const q = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 100)) });
      if (after && SNOWFLAKE.test(after)) q.set('after', after);
      const res = await fetchFn(`https://discord.com/api/v10/channels/${channelId}/messages?${q}`, {
        headers: { authorization: `Bot ${botToken}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new ChannelReadError(res.status);
      const list = (await res.json()) as unknown;
      if (!Array.isArray(list)) return [];
      return list
        .map((m) => toMessage(m))
        .filter((m): m is DiscordMessage => m !== null)
        .sort((a, b) => compareIds(a.id, b.id));
    },
    async image(url) {
      const u = new URL(url);
      if (u.protocol !== 'https:' || !CDN.has(u.hostname))
        throw new Error('Solo imágenes del CDN de Discord.');
      const res = await fetchFn(u, { signal: AbortSignal.timeout(timeoutMs * 2) });
      if (!res.ok) throw new Error(`No se pudo descargar la imagen (HTTP ${res.status}).`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES)
        throw new Error('Imagen vacía o demasiado grande.');
      return bytes;
    },
  };
}

/** Compara ids de Discord (números grandes en texto). */
export function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function toMessage(raw: unknown): DiscordMessage | null {
  const m = raw as {
    id?: unknown;
    timestamp?: unknown;
    author?: { id?: unknown; username?: unknown; bot?: unknown };
    embeds?: unknown;
    attachments?: unknown;
  };
  if (typeof m.id !== 'string' || !SNOWFLAKE.test(m.id) || typeof m.timestamp !== 'string')
    return null;
  const embeds = Array.isArray(m.embeds)
    ? (m.embeds as Record<string, unknown>[]).map((e) => ({
        ...(typeof e.title === 'string' ? { title: e.title } : {}),
        ...(typeof e.description === 'string' ? { description: e.description } : {}),
        fields: Array.isArray(e.fields)
          ? (e.fields as Record<string, unknown>[])
              .filter((f) => typeof f.name === 'string' && typeof f.value === 'string')
              .map((f) => ({ name: f.name as string, value: f.value as string }))
          : [],
      }))
    : [];
  const attachments = Array.isArray(m.attachments)
    ? (m.attachments as Record<string, unknown>[])
        .filter((a) => typeof a.url === 'string')
        .map((a) => ({
          url: a.url as string,
          filename: typeof a.filename === 'string' ? a.filename : '',
          contentType: typeof a.content_type === 'string' ? a.content_type : null,
          size: typeof a.size === 'number' ? a.size : 0,
        }))
    : [];
  return {
    id: m.id,
    timestamp: m.timestamp,
    author: {
      id: typeof m.author?.id === 'string' ? m.author.id : '',
      username: typeof m.author?.username === 'string' ? m.author.username : '',
      bot: m.author?.bot === true,
    },
    embeds,
    attachments,
  };
}
