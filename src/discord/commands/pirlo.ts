import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  MessageFlags,
} from 'discord-api-types/v10';
import type { SlashCommand } from './types.js';

/**
 * /pirlo ayuda — único comando de la Fase 1.
 * Sirve para comprobar de extremo a extremo que el endpoint responde.
 */
export const pirloCommand: SlashCommand = {
  definition: {
    name: 'pirlo',
    description: 'Información general de PIRLO BOT',
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'ayuda',
        description: 'Muestra qué puede hacer PIRLO BOT',
      },
    ],
  },
  async execute() {
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        flags: MessageFlags.Ephemeral,
        embeds: [
          {
            title: 'PIRLO BOT',
            description:
              'Estadísticas y gestión de clubes de EA SPORTS FC 27.\n\n' +
              'Próximamente: plantillas, convocatorias, alineaciones, rankings y récords.',
            color: 0x1e90ff,
          },
        ],
      },
    };
  },
};
