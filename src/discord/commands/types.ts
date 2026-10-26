import type {
  APIChatInputApplicationCommandInteraction,
  APIInteractionResponse,
  APIMessageComponentInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord-api-types/v10';
import type { Actor } from '../../core/types.js';
import type { Repositories } from '../../db/repositories/types.js';
import type { ParsedCommand } from '../interaction.js';
import type { ChannelPoster } from '../poster.js';
import type { Platform } from '../../core/platform.js';

export interface CommandContext {
  interaction: APIChatInputApplicationCommandInteraction;
  command: ParsedCommand;
  actor: Actor;
  repos: Repositories;
  /** Para editar o publicar mensajes con el token del bot; puede faltar (pruebas, sin token). */
  discord?: ChannelPoster;
  /** Descarga un adjunto de Discord como texto (solo CDN de Discord); puede faltar. */
  download?: Downloader;
  /** Operación interna de PIRLO BOT (aprobación de clubes nuevos); puede faltar en pruebas. */
  platform?: Platform;
  /** Igual, en bytes (imágenes, p. ej. el escudo del club). */
  downloadBytes?: BinaryDownloader;
}

export type Downloader = (url: string) => Promise<string>;
export type BinaryDownloader = (url: string) => Promise<Uint8Array>;

export interface SlashCommand {
  /** Definición que se registra en Discord. */
  definition: RESTPostAPIChatInputApplicationCommandsJSONBody;
  /** false = no necesita base de datos (p. ej. /pirlo ayuda). Por defecto true. */
  needsDatabase?: boolean;
  execute(ctx: CommandContext): Promise<APIInteractionResponse>;
}

export interface ComponentContext {
  interaction: APIMessageComponentInteraction;
  /** custom_id dividido por ":" sin el prefijo. */
  args: string[];
  actor: Actor;
  repos: Repositories;
  discord?: ChannelPoster;
}

/** Manejador de botones. Se elige por el prefijo del custom_id ("prefijo:arg1:arg2"). */
export interface ComponentHandler {
  prefix: string;
  handle(ctx: ComponentContext): Promise<APIInteractionResponse>;
}
