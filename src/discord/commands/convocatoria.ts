import type {
  APIActionRowComponent,
  APIComponentInMessageActionRow,
  APIEmbed,
} from 'discord-api-types/v10';
import {
  callupBoard,
  cancelNextCallup,
  closeCallup,
  createCallup,
  MAX_CLOSE_BEFORE_MINUTES,
  respondCallup,
  upcomingCallups,
  type CallupBoard,
} from '../../core/callups/service.js';
import { resolveContext } from '../../core/context.js';
import { notFound } from '../../core/errors.js';
import { discordTime } from '../../core/time.js';
import type { CallupAnswer, ClubContext, Membership } from '../../core/types.js';
import type { Repositories } from '../../db/repositories/types.js';
import type { ChannelPoster } from '../poster.js';
import {
  BUTTON_DANGER,
  BUTTON_SECONDARY,
  BUTTON_SUCCESS,
  COMPONENT_ACTION_ROW,
  COMPONENT_BUTTON,
  CONTEXT_GUILD,
  OT,
} from '../constants.js';
import { optInteger, optString } from '../interaction.js';
import { embed, escapeMd, ok, reply, updateWith } from '../responses.js';
import { clubOption, contextFor, mention } from './common.js';
import type { ComponentHandler, SlashCommand } from './types.js';

const UUID = /^[0-9a-f-]{36}$/i;
/** Límite de Discord para el valor de un campo de embed. */
const FIELD_MAX = 1024;

/** Lista de miembros para un campo del tablero, recortada si no cabe. */
function names(list: Membership[]): string {
  if (list.length === 0) return '—';
  const items = list.map((m) => (m.discordUserId ? mention(m.discordUserId) : escapeMd(m.displayName)));
  let out = '';
  for (const [i, item] of items.entries()) {
    const sep = out ? ', ' : '';
    const rest = `… y ${items.length - i} más`;
    if ((out + sep + item).length > FIELD_MAX - rest.length - 2) return `${out}${sep}${rest}`;
    out += sep + item;
  }
  return out;
}

export function boardEmbed(b: CallupBoard, clubName: string): APIEmbed {
  const c = b.callup;
  const lines = [
    c.opponent ? `🆚 **${escapeMd(c.opponent)}**` : null,
    `🕘 ${discordTime(c.startsAt, 'F')} (${discordTime(c.startsAt, 'R')})`,
    b.open && c.closesAt ? `⏳ Respuestas hasta ${discordTime(c.closesAt, 'R')}` : null,
    c.status === 'cancelada' ? '🚫 **Convocatoria cancelada**' : b.open ? null : '🔒 **Convocatoria cerrada**',
  ].filter(Boolean);
  return embed({
    title: `📋 ${escapeMd(c.title)} · ${escapeMd(clubName)}`,
    description: lines.join('\n'),
    fields: [
      { name: `✅ Voy (${b.voy.length})`, value: names(b.voy), inline: false },
      { name: `❓ Duda (${b.duda.length})`, value: names(b.duda), inline: false },
      { name: `❌ No voy (${b.no_voy.length})`, value: names(b.no_voy), inline: false },
      { name: `⌛ Sin responder (${b.pending.length})`, value: names(b.pending), inline: false },
    ],
    footer: { text: b.open ? 'Responde con los botones · puedes cambiar tu respuesta' : 'Ya no se aceptan respuestas' },
  });
}

/** Cuerpo de un mensaje de tablero (para editar los ya publicados). */
export function boardMessage(b: CallupBoard, club: { name: string; slug: string }) {
  return { embeds: [boardEmbed(b, club.name)], components: boardButtons(b, club.slug) };
}

/**
 * Edita todos los mensajes que muestran el tablero de una convocatoria, salvo `except` (el que
 * Discord ya actualiza con la respuesta a la interacción). Los fallos se ignoran: un mensaje
 * borrado o un plazo agotado no debe impedir que el usuario reciba su respuesta.
 */
export async function syncBoards(
  repos: Pick<Repositories, 'callups'>,
  discord: ChannelPoster | undefined,
  ctx: ClubContext,
  board: CallupBoard,
  except: string | null = null,
): Promise<number> {
  if (!discord) return 0;
  const targets = (await repos.callups.messages(ctx.club.id, board.callup.id)).filter((m) => m.messageId !== except);
  const body = boardMessage(board, ctx.club);
  const results = await Promise.allSettled(targets.map((m) => discord.edit(m.channelId, m.messageId, body)));
  return results.filter((r) => r.status === 'fulfilled').length;
}

export function boardButtons(
  b: CallupBoard,
  clubSlug: string,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  const id = (action: string) => `callup:${action}:${clubSlug}:${b.callup.id}`;
  const disabled = !b.open;
  return [
    {
      type: COMPONENT_ACTION_ROW,
      components: [
        { type: COMPONENT_BUTTON, style: BUTTON_SUCCESS, label: 'Voy', emoji: { name: '✅' }, custom_id: id('voy'), disabled },
        { type: COMPONENT_BUTTON, style: BUTTON_SECONDARY, label: 'Duda', emoji: { name: '❓' }, custom_id: id('duda'), disabled },
        { type: COMPONENT_BUTTON, style: BUTTON_DANGER, label: 'No voy', emoji: { name: '❌' }, custom_id: id('no_voy'), disabled },
        { type: COMPONENT_BUTTON, style: BUTTON_SECONDARY, label: 'Cerrar', emoji: { name: '🔒' }, custom_id: id('cerrar'), disabled },
      ],
    },
  ];
}

export const convocatoriaCommand: SlashCommand = {
  definition: {
    name: 'convocatoria',
    description: 'Convocatorias del club: quién va, quién no y quién duda',
    contexts: [CONTEXT_GUILD],
    options: [
      {
        type: OT.Subcommand,
        name: 'crear',
        description: 'Crea una convocatoria con botones Voy / Duda / No voy (capitán o superior)',
        options: [
          { type: OT.String, name: 'titulo', description: 'p. ej. Liga · Jornada 3', required: true, max_length: 100 },
          { type: OT.String, name: 'fecha', description: '25/10, 2026-10-25, hoy o mañana', required: true, max_length: 20 },
          { type: OT.String, name: 'hora', description: 'Hora del club, p. ej. 21:30 o 9:30pm', required: true, max_length: 10 },
          { type: OT.String, name: 'rival', description: 'Rival (opcional)', required: false, max_length: 60 },
          {
            type: OT.Integer,
            name: 'cierre',
            description: 'Cerrar respuestas X minutos antes del inicio (opcional)',
            required: false,
            min_value: 0,
            max_value: MAX_CLOSE_BEFORE_MINUTES,
          },
          clubOption,
        ],
      },
      {
        type: OT.Subcommand,
        name: 'ver',
        description: 'Vuelve a mostrar en el canal la próxima convocatoria abierta',
        options: [clubOption],
      },
      {
        type: OT.Subcommand,
        name: 'cancelar',
        description: 'Cancela la próxima convocatoria (capitán o superior)',
        options: [clubOption],
      },
      {
        type: OT.Subcommand,
        name: 'lista',
        description: 'Próximas convocatorias abiertas',
        options: [clubOption],
      },
    ],
  },

  async execute(ctx) {
    const c = await contextFor(ctx);
    switch (ctx.command.sub) {
      case 'crear': {
        const callup = await createCallup(ctx.repos, c, {
          title: optString(ctx.command, 'titulo') ?? '',
          opponent: optString(ctx.command, 'rival') ?? null,
          day: optString(ctx.command, 'fecha') ?? '',
          time: optString(ctx.command, 'hora') ?? '',
          closeBeforeMinutes: optInteger(ctx.command, 'cierre') ?? null,
        });
        const board = await callupBoard(ctx.repos, c, callup.id);
        return reply(null, {
          ephemeral: false,
          embeds: [boardEmbed(board, c.club.name)],
          components: boardButtons(board, c.club.slug),
        });
      }

      case 'ver': {
        const [next] = await upcomingCallups(ctx.repos, c, 1);
        if (!next) return ok('No hay convocatorias abiertas. Crea una con `/convocatoria crear`.');
        const board = await callupBoard(ctx.repos, c, next.id);
        return reply(null, {
          ephemeral: false,
          embeds: [boardEmbed(board, c.club.name)],
          components: boardButtons(board, c.club.slug),
        });
      }

      case 'cancelar': {
        const cancelled = await cancelNextCallup(ctx.repos, c);
        const board = await callupBoard(ctx.repos, c, cancelled.id);
        const updated = await syncBoards(ctx.repos, ctx.discord, c, board);
        return ok(
          `Convocatoria **${escapeMd(cancelled.title)}** (${discordTime(cancelled.startsAt, 'f')}) cancelada.` +
            (updated ? ` Actualicé ${updated} tablero(s) en el canal.` : ''),
        );
      }

      case 'lista': {
        const list = await upcomingCallups(ctx.repos, c, 10);
        if (list.length === 0) return ok('No hay convocatorias abiertas.');
        const lines = await Promise.all(
          list.map(async (cu) => {
            const b = await callupBoard(ctx.repos, c, cu.id);
            const rival = cu.opponent ? ` vs ${escapeMd(cu.opponent)}` : '';
            return `**${escapeMd(cu.title)}**${rival} · ${discordTime(cu.startsAt, 'f')} · ✅ ${b.voy.length} · ❓ ${b.duda.length} · ❌ ${b.no_voy.length} · ⌛ ${b.pending.length}`;
          }),
        );
        return reply(null, {
          embeds: [embed({ title: `Convocatorias · ${escapeMd(c.club.name)}`, description: lines.join('\n') })],
        });
      }

      default:
        return reply('Subcomando desconocido.');
    }
  },
};

const ANSWERS: Record<string, CallupAnswer> = { voy: 'voy', duda: 'duda', no_voy: 'no_voy' };

/**
 * Botones del tablero. custom_id = "callup:<voy|duda|no_voy|cerrar>:<slug>:<callupId>".
 * No se confía en el custom_id: el club se resuelve entre los del servidor actual y los permisos
 * se comprueban de nuevo en cada pulsación.
 */
export const callupButtons: ComponentHandler = {
  prefix: 'callup',
  async handle(ctx) {
    const [action, slug, callupId] = ctx.args;
    if (!action || !slug || !callupId || !UUID.test(callupId)) throw notFound('Convocatoria');
    const c = await resolveContext(ctx.repos, ctx.actor, slug);

    if (action === 'cerrar') {
      await closeCallup(ctx.repos, c, callupId);
    } else {
      const answer = ANSWERS[action];
      if (!answer) throw notFound('Convocatoria');
      await respondCallup(ctx.repos, c, callupId, answer);
    }

    const board = await callupBoard(ctx.repos, c, callupId);
    // Se recuerda este mensaje (el original o un recordatorio) y se igualan los demás tableros.
    const message = ctx.interaction.message;
    const channelId = ctx.interaction.channel?.id ?? message?.channel_id;
    if (message?.id && channelId) {
      await ctx.repos.callups.recordMessage(c.club.id, callupId, channelId, message.id).catch(() => undefined);
    }
    await syncBoards(ctx.repos, ctx.discord, c, board, message?.id ?? null).catch(() => 0);
    return updateWith(boardMessage(board, c.club));
  },
};
