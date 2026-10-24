import { createSeason, listSeasons } from '../../core/seasons/service.js';
import { CONTEXT_GUILD, OT } from '../constants.js';
import { optBoolean, optString } from '../interaction.js';
import { embed, escapeMd, ok, reply } from '../responses.js';
import { clubOption, contextFor } from './common.js';
import type { SlashCommand } from './types.js';

export const temporadaCommand: SlashCommand = {
  definition: {
    name: 'temporada',
    description: 'Temporadas del club',
    contexts: [CONTEXT_GUILD],
    options: [
      {
        type: OT.Subcommand,
        name: 'crear',
        description: 'Crea una temporada (solo admin)',
        options: [
          {
            type: OT.String,
            name: 'nombre',
            description: 'Nombre, p. ej. Temporada 1 · FC 27',
            required: true,
            max_length: 60,
          },
          {
            type: OT.Boolean,
            name: 'actual',
            description: 'Marcarla como temporada actual (por defecto: sí)',
            required: false,
          },
          clubOption,
        ],
      },
      {
        type: OT.Subcommand,
        name: 'ver',
        description: 'Lista las temporadas del club',
        options: [clubOption],
      },
    ],
  },

  async execute(ctx) {
    const c = await contextFor(ctx);
    if (ctx.command.sub === 'crear') {
      const makeCurrent = optBoolean(ctx.command, 'actual') ?? true;
      const s = await createSeason(ctx.repos, c, {
        name: optString(ctx.command, 'nombre') ?? '',
        makeCurrent,
      });
      return ok(`Temporada **${escapeMd(s.name)}** creada${makeCurrent ? ' y marcada como actual' : ''}.`);
    }
    const seasons = await listSeasons(ctx.repos, c);
    const description = seasons.length
      ? seasons.map((s) => `${s.isCurrent ? '▶️' : '•'} ${escapeMd(s.name)}`).join('\n')
      : 'Todavía no hay temporadas. Un admin puede crear una con `/temporada crear`.';
    return reply(null, {
      embeds: [embed({ title: `Temporadas · ${escapeMd(c.club.name)}`, description })],
    });
  },
};
