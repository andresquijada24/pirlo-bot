import type {
  APIApplicationCommandBooleanOption,
  APIApplicationCommandStringOption,
} from 'discord-api-types/v10';
import { DomainError } from '../../core/errors.js';
import {
  MIN_PASSES,
  MIN_RATED_MATCHES,
  MIN_TACKLES,
  playerStats,
  RANKING_METRICS,
  ranking,
  resolveSeason,
  type PlayerTotals,
  type RankingMetricId,
  type SeasonScope,
} from '../../core/stats/service.js';
import type { Season } from '../../core/types.js';
import { CONTEXT_GUILD, OT } from '../constants.js';
import { optBoolean, optId, optString } from '../interaction.js';
import { embed, escapeMd, reply } from '../responses.js';
import { clubOption, contextFor } from './common.js';
import type { SlashCommand } from './types.js';

/** Un dato ausente se muestra como "—", nunca como 0. */
export const show = (n: number | null, format: (n: number) => string = String) =>
  n === null ? '—' : format(n);

const seasonOption: APIApplicationCommandStringOption = {
  type: OT.String,
  name: 'temporada',
  description: 'Temporada actual (por defecto) o todo el historial',
  required: false,
  choices: [
    { name: 'Actual', value: 'actual' },
    { name: 'Todas (historial)', value: 'todas' },
  ],
};

const publishOption: APIApplicationCommandBooleanOption = {
  type: OT.Boolean,
  name: 'publicar',
  description: 'Mostrarlo a todo el canal (por defecto solo lo ves tú)',
  required: false,
};

const scopeOf = (value: string | undefined): SeasonScope => (value === 'todas' ? 'todas' : 'actual');
const seasonLabel = (s: Season | null) => (s ? `Temporada: ${s.name}` : 'Historial completo');
const ratio = (made: number | null, attempted: number | null, pctValue: number | null) =>
  made === null && attempted === null
    ? '—'
    : `${show(made)}/${show(attempted)}${pctValue !== null ? ` (${pctValue.toFixed(1)} %)` : ''}`;

export function statsFields(t: PlayerTotals) {
  const inline = true;
  return [
    { name: 'Partidos', value: show(t.matchesPlayed), inline },
    { name: 'Sesiones', value: String(t.sessions), inline },
    {
      name: 'Calificación',
      value:
        t.avgRating === null
          ? '—'
          : `${t.avgRating.toFixed(2)}${t.ratedMatches !== null ? ` · ${t.ratedMatches} PJ` : ''}`,
      inline,
    },
    { name: 'Goles', value: show(t.goals), inline },
    { name: 'Asistencias', value: show(t.assists), inline },
    { name: 'G + A', value: show(t.goalContributions), inline },
    { name: 'Tiros', value: show(t.shots), inline },
    { name: 'Regates', value: show(t.dribbles), inline },
    { name: 'Pases', value: ratio(t.passesMade, t.passesAttempted, t.passPct), inline },
    { name: 'Entradas', value: ratio(t.tacklesMade, t.tacklesAttempted, t.tacklePct), inline },
    { name: 'Intercepciones', value: show(t.interceptions), inline },
    { name: 'Bloqueos', value: show(t.blocks), inline },
    { name: 'Despejes', value: show(t.clearances), inline },
    { name: 'Paradas', value: show(t.saves), inline },
  ];
}

export const statsCommand: SlashCommand = {
  definition: {
    name: 'stats',
    description: 'Estadísticas de un jugador del club',
    contexts: [CONTEXT_GUILD],
    options: [
      { type: OT.User, name: 'usuario', description: 'Jugador (si no se indica, eres tú)', required: false },
      seasonOption,
      publishOption,
      clubOption,
    ],
  },

  async execute(ctx) {
    const c = await contextFor(ctx);
    const userId = optId(ctx.command, 'usuario');
    const member = userId
      ? await ctx.repos.memberships.findActiveByDiscordUser(c.club.id, userId)
      : c.membership;
    if (!member) {
      throw new DomainError(
        userId ? 'NOT_FOUND' : 'NOT_A_MEMBER',
        userId ? 'Ese usuario no forma parte de la plantilla.' : 'No formas parte de la plantilla. Usa /vincular.',
      );
    }

    const scope = scopeOf(optString(ctx.command, 'temporada'));
    const season = await resolveSeason(ctx.repos, c, scope);
    const totals = await playerStats(ctx.repos, c, member, season);
    const ephemeral = optBoolean(ctx.command, 'publicar') !== true;

    if (!totals) {
      const hint =
        scope === 'actual'
          ? '\nPrueba con `temporada: Todas` para ver el historial.'
          : '\nSi juega con otro gamertag, un DT puede vincularlo con `/plantilla gamertag`.';
      return reply(`Todavía no hay estadísticas de **${escapeMd(member.displayName)}** (${seasonLabel(season)}).${hint}`);
    }

    return reply(null, {
      ephemeral,
      embeds: [
        embed({
          title: `${escapeMd(member.displayName)} · ${escapeMd(c.club.name)}`,
          fields: statsFields(totals),
          footer: { text: `${seasonLabel(season)} · Datos por sesión · "—" = sin dato` },
        }),
      ],
    });
  },
};

const MEDALS = ['🥇', '🥈', '🥉'];

export const rankingCommand: SlashCommand = {
  definition: {
    name: 'ranking',
    description: 'Ranking del club por estadística',
    contexts: [CONTEXT_GUILD],
    options: [
      {
        type: OT.String,
        name: 'estadistica',
        description: 'Qué estadística ordenar',
        required: true,
        choices: (Object.keys(RANKING_METRICS) as RankingMetricId[]).map((id) => ({
          name: RANKING_METRICS[id].label,
          value: id,
        })),
      },
      seasonOption,
      publishOption,
      clubOption,
    ],
  },

  async execute(ctx) {
    const c = await contextFor(ctx);
    const metricId = optString(ctx.command, 'estadistica') as RankingMetricId;
    const metric = RANKING_METRICS[metricId];
    if (!metric) throw new DomainError('VALIDATION', 'Estadística desconocida.');

    const season = await resolveSeason(ctx.repos, c, scopeOf(optString(ctx.command, 'temporada')));
    const entries = await ranking(ctx.repos, c, metricId, season);
    const format = 'format' in metric ? metric.format : String;
    const minimum = 'minimum' in metric ? metric.minimum : undefined;

    const lines = entries.map((e) => {
      const badge = MEDALS[e.position - 1] ?? `\`${String(e.position).padStart(2)}.\``;
      const name = escapeMd(e.totals.name) + (e.totals.linked ? '' : ' ·');
      return `${badge} **${name}** — ${format(e.value)}`;
    });
    const notes = [
      seasonLabel(season),
      minimum ? `mínimo ${minimum.at} ${minimum.label}` : null,
      entries.some((e) => !e.totals.linked) ? '· = sin vincular en Discord' : null,
    ].filter(Boolean);

    return reply(null, {
      ephemeral: optBoolean(ctx.command, 'publicar') !== true,
      embeds: [
        embed({
          title: `${metric.label} · ${escapeMd(c.club.name)}`,
          description: lines.join('\n') || 'Todavía no hay datos suficientes para este ranking.',
          footer: { text: notes.join(' · ') },
        }),
      ],
    });
  },
};

/** Umbrales exportados para la ayuda y las pruebas. */
export const THRESHOLDS = { MIN_PASSES, MIN_TACKLES, MIN_RATED_MATCHES };
