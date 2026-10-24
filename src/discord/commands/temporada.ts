import { createSeason, listSeasons, setSeasonDates } from '../../core/seasons/service.js';
import type { Season } from '../../core/types.js';
import { CONTEXT_GUILD, OT } from '../constants.js';
import { optBoolean, optString } from '../interaction.js';
import { embed, escapeMd, ok, reply } from '../responses.js';
import { clubOption, contextFor } from './common.js';
import type { SlashCommand } from './types.js';

/** "AAAA-MM-DD" → "DD/MM/AAAA". */
const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('/');

/** Rango de fechas legible de una temporada. */
export function rangeText(s: Pick<Season, 'startsOn' | 'endsOn'>): string {
  if (!s.startsOn) return 'sin fecha de inicio (cuenta desde su creación)';
  return s.endsOn ? `del ${ddmmyyyy(s.startsOn)} al ${ddmmyyyy(s.endsOn)}` : `desde el ${ddmmyyyy(s.startsOn)}`;
}

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
        name: 'fechas',
        description: 'Pone la fecha de inicio (y de fin) de una temporada y reasigna sus sesiones (solo admin)',
        options: [
          {
            type: OT.String,
            name: 'inicio',
            description: 'Fecha de inicio, DD/MM/AAAA (p. ej. 18/09/2026)',
            required: true,
            max_length: 10,
          },
          {
            type: OT.String,
            name: 'fin',
            description: 'Fecha de fin, DD/MM/AAAA (vacío = sigue abierta)',
            required: false,
            max_length: 10,
          },
          {
            type: OT.String,
            name: 'nombre',
            description: 'Temporada a cambiar (por defecto: la actual)',
            required: false,
            max_length: 60,
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
    if (ctx.command.sub === 'fechas') {
      const { season, moved } = await setSeasonDates(ctx.repos, c, {
        seasonName: optString(ctx.command, 'nombre'),
        startsOn: optString(ctx.command, 'inicio') ?? '',
        endsOn: optString(ctx.command, 'fin'),
      });
      return ok(
        `Temporada **${escapeMd(season.name)}**: ${rangeText(season)}. ` +
          `Sesiones reasignadas: ${moved}.`,
      );
    }
    const seasons = await listSeasons(ctx.repos, c);
    const description = seasons.length
      ? seasons.map((s) => `${s.isCurrent ? '▶️' : '•'} ${escapeMd(s.name)} · ${rangeText(s)}`).join('\n')
      : 'Todavía no hay temporadas. Un admin puede crear una con `/temporada crear`.';
    return reply(null, {
      embeds: [embed({ title: `Temporadas · ${escapeMd(c.club.name)}`, description })],
    });
  },
};
