import {
  ApplicationCommandType,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  type APIInteraction,
  type APIInteractionResponse,
} from 'discord-api-types/v10';
import type { SlashCommand } from './commands/types.js';

function ephemeral(content: string): APIInteractionResponse {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content, flags: MessageFlags.Ephemeral },
  };
}

/**
 * Despacha una interacción ya verificada al manejador correspondiente.
 * Es una función pura respecto a la red: recibe el registro de comandos como dependencia.
 */
export async function routeInteraction(
  interaction: APIInteraction,
  registry: ReadonlyMap<string, SlashCommand>,
): Promise<APIInteractionResponse> {
  switch (interaction.type) {
    case InteractionType.Ping:
      return { type: InteractionResponseType.Pong };

    case InteractionType.ApplicationCommand: {
      if (interaction.data.type !== ApplicationCommandType.ChatInput) {
        return ephemeral('Este tipo de comando todavía no está disponible.');
      }
      const command = registry.get(interaction.data.name);
      if (!command) {
        return ephemeral('Comando desconocido.');
      }
      return command.execute({
        interaction: interaction as Parameters<SlashCommand['execute']>[0]['interaction'],
      });
    }

    default:
      return ephemeral('Esta interacción todavía no está disponible.');
  }
}
