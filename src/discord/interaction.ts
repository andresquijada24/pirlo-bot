import type {
  APIApplicationCommandInteractionDataBasicOption,
  APIApplicationCommandInteractionDataOption,
  APIChatInputApplicationCommandInteraction,
  APIMessageComponentInteraction,
} from 'discord-api-types/v10';
import type { Actor } from '../core/types.js';
import { OT, PERMISSION_ADMINISTRATOR, PERMISSION_MANAGE_GUILD } from './constants.js';

type GuildInteraction = APIChatInputApplicationCommandInteraction | APIMessageComponentInteraction;

/**
 * Construye el Actor a partir de la interacción. Devuelve null fuera de un servidor
 * (mensajes directos): PIRLO BOT solo funciona dentro de servidores.
 *
 * Los datos vienen de Discord y la firma ya fue verificada, así que son fiables.
 */
export function actorFrom(interaction: GuildInteraction): Actor | null {
  const member = interaction.member;
  if (!interaction.guild_id || !member) return null;
  const perms = BigInt(member.permissions ?? '0');
  const user = member.user;
  return {
    discordUserId: user.id,
    displayName: (member.nick ?? user.global_name ?? user.username).slice(0, 60),
    guildId: interaction.guild_id,
    isGuildManager:
      (perms & PERMISSION_ADMINISTRATOR) !== 0n || (perms & PERMISSION_MANAGE_GUILD) !== 0n,
  };
}

/** Comando invocado: subcomando (y grupo, si lo hay) con sus opciones aplanadas. */
export interface ParsedCommand {
  name: string;
  group: string | null;
  sub: string | null;
  options: Map<string, APIApplicationCommandInteractionDataBasicOption>;
}

export function parseCommand(interaction: APIChatInputApplicationCommandInteraction): ParsedCommand {
  let group: string | null = null;
  let sub: string | null = null;
  let opts: APIApplicationCommandInteractionDataOption[] = interaction.data.options ?? [];

  const first = opts[0];
  if (first?.type === OT.SubcommandGroup) {
    group = first.name;
    const inner = first.options[0];
    sub = inner?.name ?? null;
    opts = inner?.options ?? [];
  } else if (first?.type === OT.Subcommand) {
    sub = first.name;
    opts = first.options ?? [];
  }

  const options = new Map<string, APIApplicationCommandInteractionDataBasicOption>();
  for (const o of opts) {
    if (o.type !== OT.Subcommand && o.type !== OT.SubcommandGroup) options.set(o.name, o);
  }
  return { name: interaction.data.name, group, sub, options };
}

export function optString(cmd: ParsedCommand, name: string): string | undefined {
  const o = cmd.options.get(name);
  return o && typeof o.value === 'string' ? o.value : undefined;
}

export function optBoolean(cmd: ParsedCommand, name: string): boolean | undefined {
  const o = cmd.options.get(name);
  return o && typeof o.value === 'boolean' ? o.value : undefined;
}

/** Opciones de tipo usuario o canal: Discord envía el ID como `value`. */
export function optId(cmd: ParsedCommand, name: string): string | undefined {
  const o = cmd.options.get(name);
  return o && (o.type === OT.User || o.type === OT.Channel) ? String(o.value) : undefined;
}
