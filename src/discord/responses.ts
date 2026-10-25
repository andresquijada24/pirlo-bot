import type {
  APIActionRowComponent,
  APIComponentInMessageActionRow,
  APIEmbed,
  APIInteractionResponse,
} from 'discord-api-types/v10';
import { BRAND_COLOR, EPHEMERAL, ERROR_COLOR, RT } from './constants.js';

interface ReplyOptions {
  /** Por defecto las respuestas son efímeras (solo las ve quien ejecuta el comando). */
  ephemeral?: boolean;
  embeds?: APIEmbed[];
  components?: APIActionRowComponent<APIComponentInMessageActionRow>[];
}

/** Las menciones nunca notifican: el bot no debe hacer ping a nadie por accidente. */
const NO_PINGS = { parse: [] as never[] };

export function reply(content: string | null, opts: ReplyOptions = {}): APIInteractionResponse {
  return {
    type: RT.Message,
    data: {
      ...(content !== null ? { content } : {}),
      ...(opts.embeds ? { embeds: opts.embeds } : {}),
      ...(opts.components ? { components: opts.components } : {}),
      allowed_mentions: NO_PINGS,
      ...(opts.ephemeral === false ? {} : { flags: EPHEMERAL }),
    },
  };
}

export function ok(message: string): APIInteractionResponse {
  return reply(`✅ ${message}`);
}

export function fail(message: string): APIInteractionResponse {
  return reply(null, { embeds: [{ description: `❌ ${message}`, color: ERROR_COLOR }] });
}

/** Actualiza el mensaje que contenía el botón pulsado (sin crear uno nuevo). */
export function updateMessage(content: string): APIInteractionResponse {
  return {
    type: RT.UpdateMessage,
    data: { content, embeds: [], components: [], allowed_mentions: NO_PINGS },
  };
}

/** Reemplaza el mensaje del botón pulsado por uno nuevo con embeds y componentes. */
export function updateWith(opts: Omit<ReplyOptions, 'ephemeral'>): APIInteractionResponse {
  return {
    type: RT.UpdateMessage,
    data: {
      embeds: opts.embeds ?? [],
      components: opts.components ?? [],
      allowed_mentions: NO_PINGS,
    },
  };
}

export function embed(e: Omit<APIEmbed, 'color'>): APIEmbed {
  return { color: BRAND_COLOR, ...e };
}

/** Escapa caracteres de formato de Discord en texto escrito por usuarios. */
export function escapeMd(text: string): string {
  return text.replace(/([\\*_`~|>#[\]()-])/g, '\\$1');
}
