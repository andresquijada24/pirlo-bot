import type {
  ApplicationCommandOptionType,
  ButtonStyle,
  ChannelType,
  ComponentType,
  InteractionContextType,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
} from 'discord-api-types/v10';

/*
 * Valores numéricos de la API de Discord v10, tipados con los enums de discord-api-types.
 * Solo se importan TIPOS: este módulo no tiene dependencias en tiempo de ejecución, lo que
 * permite probar los comandos sin cargar la librería.
 */

export const IT = {
  Ping: 1 as InteractionType.Ping,
  ApplicationCommand: 2 as InteractionType.ApplicationCommand,
  MessageComponent: 3 as InteractionType.MessageComponent,
} as const;

export const RT = {
  Pong: 1 as InteractionResponseType.Pong,
  Message: 4 as InteractionResponseType.ChannelMessageWithSource,
  UpdateMessage: 7 as InteractionResponseType.UpdateMessage,
} as const;

export const OT = {
  Subcommand: 1 as ApplicationCommandOptionType.Subcommand,
  SubcommandGroup: 2 as ApplicationCommandOptionType.SubcommandGroup,
  String: 3 as ApplicationCommandOptionType.String,
  Integer: 4 as ApplicationCommandOptionType.Integer,
  Boolean: 5 as ApplicationCommandOptionType.Boolean,
  User: 6 as ApplicationCommandOptionType.User,
  Channel: 7 as ApplicationCommandOptionType.Channel,
} as const;

export const CHANNEL_TEXT = 0 as ChannelType.GuildText;
export const CHANNEL_ANNOUNCEMENT = 5 as ChannelType.GuildAnnouncement;
export const CONTEXT_GUILD = 0 as InteractionContextType.Guild;

export const EPHEMERAL = 64 as MessageFlags.Ephemeral;

export const COMPONENT_ACTION_ROW = 1 as ComponentType.ActionRow;
export const COMPONENT_BUTTON = 2 as ComponentType.Button;
export const BUTTON_PRIMARY = 1 as ButtonStyle.Primary;
export const BUTTON_SECONDARY = 2 as ButtonStyle.Secondary;
export const BUTTON_SUCCESS = 3 as ButtonStyle.Success;
export const BUTTON_DANGER = 4 as ButtonStyle.Danger;

/** Permiso "Gestionar servidor" (MANAGE_GUILD = 1 << 5). */
export const PERMISSION_MANAGE_GUILD = 1n << 5n;
/** Permiso "Administrador" (ADMINISTRATOR = 1 << 3). Implica todos los demás. */
export const PERMISSION_ADMINISTRATOR = 1n << 3n;

/** Color de marca (azul PIRLO BOT). */
export const BRAND_COLOR = 0x2f8cff;
export const ERROR_COLOR = 0xe5484d;
