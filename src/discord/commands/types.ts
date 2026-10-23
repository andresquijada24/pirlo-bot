import type {
  APIChatInputApplicationCommandInteraction,
  APIInteractionResponse,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord-api-types/v10';

/** Contexto que recibe cada comando. Crecerá en la Fase 3 (club resuelto, actor, permisos). */
export interface CommandContext {
  interaction: APIChatInputApplicationCommandInteraction;
}

export interface SlashCommand {
  /** Definición que se registra en Discord. */
  definition: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(ctx: CommandContext): Promise<APIInteractionResponse>;
}
