import type { APIEmbed } from 'discord-api-types/v10';
import { FORMATION_NAMES } from '../../core/lineups/formations.js';
import {
  assignPlayer,
  buildLineupView,
  createLineup,
  publishLineup,
  removePlayer,
  viewLineup,
  type LineupView,
} from '../../core/lineups/service.js';
import { discordTime } from '../../core/time.js';
import { POSITION_CODES, type Callup, type CallupAnswer, type Membership, type PositionCode } from '../../core/types.js';
import { CONTEXT_GUILD, OT } from '../constants.js';
import { optBoolean, optId, optString } from '../interaction.js';
import { embed, escapeMd, reply } from '../responses.js';
import { clubOption, contextFor } from './common.js';
import type { CommandContext, SlashCommand } from './types.js';

const ANSWER_MARK: Record<CallupAnswer, string> = { voy: '', duda: ' ❓', no_voy: ' ❌' };

function who(member: Membership | null, answer: CallupAnswer | null, marks: boolean): string {
  if (!member) return '—';
  // En el borrador, quien no respondió "Voy" lleva una marca para que el DT lo vea de un vistazo.
  // La alineación publicada no la lleva: es para todo el canal.
  const mark = marks ? (answer ? ANSWER_MARK[answer] : ' ⌛') : '';
  return `${escapeMd(member.displayName)}${mark}`;
}

export function lineupEmbed(view: LineupView, callup: Callup, clubName: string, published: boolean): APIEmbed {
  const marks = !published;
  // Una línea por jugador, agrupadas por líneas del campo: se lee bien también en el móvil.
  const lines = view.lines.map((line) =>
    line.map((p) => `**${p.position ?? '??'}** ${who(p.member, p.answer, marks)}`).join('\n'),
  );
  const subs = view.substitutes.map((s) => who(s.member, s.answer, marks)).join(', ');
  return embed({
    title: `🧩 Alineación · ${escapeMd(callup.title)}`,
    description: [
      `${escapeMd(clubName)} · **${view.formation}**${callup.opponent ? ` · 🆚 ${escapeMd(callup.opponent)}` : ''}`,
      `🕘 ${discordTime(callup.startsAt, 'F')}`,
      '',
      lines.join('\n\n'),
    ].join('\n'),
    fields: [{ name: `Suplentes (${view.substitutes.length})`, value: subs || '—', inline: false }],
    footer: {
      text: published
        ? 'Alineación publicada'
        : `Borrador · ${view.filled}/11 titulares · ❓ duda · ❌ no va · ⌛ no respondió`,
    },
  });
}

async function show(ctx: CommandContext, message: string | null, published: boolean | null = null) {
  const c = await contextFor(ctx);
  const { callup, lineup } = await viewLineup(ctx.repos, c);
  const view = await buildLineupView(ctx.repos, c, callup, lineup);
  const isPublished = published ?? lineup.status === 'publicada';
  const warning =
    !isPublished && view.warnings.length
      ? `\n⚠️ No dijeron "Voy": ${view.warnings.map((m) => escapeMd(m.displayName)).join(', ')}`
      : '';
  return { c, embed: lineupEmbed(view, callup, c.club.name, isPublished), text: message ? message + warning : null };
}

const playerOption = (description: string) => ({ type: OT.User, name: 'jugador', description, required: true });

export const alineacionCommand: SlashCommand = {
  definition: {
    name: 'alineacion',
    description: 'Alineación de la próxima convocatoria (DT o admin)',
    contexts: [CONTEXT_GUILD],
    options: [
      {
        type: OT.Subcommand,
        name: 'crear',
        description: 'Crea la alineación de la próxima convocatoria con una formación',
        options: [
          {
            type: OT.String,
            name: 'formacion',
            description: 'Formación',
            required: true,
            choices: FORMATION_NAMES.map((f) => ({ name: f, value: f })),
          },
          { type: OT.Boolean, name: 'reemplazar', description: 'Empezar de cero si ya había una', required: false },
          clubOption,
        ],
      },
      {
        type: OT.Subcommand,
        name: 'poner',
        description: 'Pone a un jugador de titular en una posición (si ya estaba, lo mueve)',
        options: [
          playerOption('Jugador de la plantilla'),
          {
            type: OT.String,
            name: 'posicion',
            description: 'Posición',
            required: true,
            choices: POSITION_CODES.map((p) => ({ name: p, value: p })),
          },
          clubOption,
        ],
      },
      {
        type: OT.Subcommand,
        name: 'suplente',
        description: 'Pone a un jugador en el banquillo',
        options: [playerOption('Jugador de la plantilla'), clubOption],
      },
      {
        type: OT.Subcommand,
        name: 'quitar',
        description: 'Quita a un jugador de la alineación',
        options: [playerOption('Jugador de la alineación'), clubOption],
      },
      { type: OT.Subcommand, name: 'ver', description: 'Muestra la alineación (el borrador solo lo ve el DT)', options: [clubOption] },
      { type: OT.Subcommand, name: 'publicar', description: 'Publica la alineación en el canal', options: [clubOption] },
    ],
  },

  async execute(ctx) {
    const c = await contextFor(ctx);
    const userId = optId(ctx.command, 'jugador') ?? '';
    switch (ctx.command.sub) {
      case 'crear': {
        const { callup, lineup } = await createLineup(
          ctx.repos,
          c,
          optString(ctx.command, 'formacion') ?? '',
          optBoolean(ctx.command, 'reemplazar') === true,
        );
        const r = await show(ctx, `✅ Alineación **${lineup.formation}** creada para **${escapeMd(callup.title)}**. Ahora usa \`/alineacion poner\`.`);
        return reply(r.text, { embeds: [r.embed] });
      }
      case 'poner': {
        const position = optString(ctx.command, 'posicion') as PositionCode;
        const { member } = await assignPlayer(ctx.repos, c, userId, { position });
        const r = await show(ctx, `✅ ${escapeMd(member.displayName)} de **${position}**.`);
        return reply(r.text, { embeds: [r.embed] });
      }
      case 'suplente': {
        const { member } = await assignPlayer(ctx.repos, c, userId, { substitute: true });
        const r = await show(ctx, `✅ ${escapeMd(member.displayName)} al banquillo.`);
        return reply(r.text, { embeds: [r.embed] });
      }
      case 'quitar': {
        const { member, removed } = await removePlayer(ctx.repos, c, userId);
        const r = await show(
          ctx,
          removed ? `✅ ${escapeMd(member.displayName)} sale de la alineación.` : `${escapeMd(member.displayName)} no estaba en la alineación.`,
        );
        return reply(r.text, { embeds: [r.embed] });
      }
      case 'ver': {
        const r = await show(ctx, null);
        return reply(null, { embeds: [r.embed] });
      }
      case 'publicar': {
        await publishLineup(ctx.repos, c);
        const r = await show(ctx, null, true);
        return reply(null, { ephemeral: false, embeds: [r.embed] });
      }
      default:
        return reply('Subcomando desconocido.');
    }
  },
};
