import { callupBoard } from '../core/callups/service.js';
import type { ClubContext } from '../core/types.js';
import type { Repositories } from '../db/repositories/types.js';
import { boardButtons, boardEmbed } from '../discord/commands/convocatoria.js';
import { DiscordPostError, type ChannelPoster } from '../discord/poster.js';
import { discordTime } from '../core/time.js';
import { escapeMd } from '../discord/responses.js';

/** Servidor de referencia: el bot nunca publica en él por su cuenta (regla 9 de CLAUDE.md). */
export const REFERENCE_GUILD_ID = '853894813169614848';
const MAX_PER_RUN = 20;
/** Discord admite 100 menciones y 2000 caracteres por mensaje: se deja margen para el resto. */
const MAX_MENTIONS = 100;
const MAX_MENTION_CHARS = 1700;

export interface ReminderResult {
  sent: number;
  skipped: number;
  failed: number;
  /** Motivo de cada fallo (sin datos sensibles), para diagnosticar desde el workflow. */
  errors?: string[];
}

/**
 * Publica el recordatorio de las convocatorias que lo necesitan: menciona solo a quien no
 * respondió y adjunta el tablero con los botones para responder ahí mismo.
 * Cada convocatoria se reclama antes de publicar, así que nunca se recuerda dos veces.
 */
export async function runReminders(deps: {
  repos: Pick<Repositories, 'reminders' | 'clubs' | 'callups' | 'memberships'>;
  poster: ChannelPoster;
  blockedGuilds: ReadonlySet<string>;
  log?: { error: (obj: object, msg: string) => void };
}): Promise<ReminderResult> {
  const { repos, poster } = deps;
  const result: ReminderResult = { sent: 0, skipped: 0, failed: 0 };

  const blocked = [...new Set([...deps.blockedGuilds, REFERENCE_GUILD_ID])];
  for (const due of await repos.reminders.due(MAX_PER_RUN, blocked)) {
    // Doble seguro: la consulta ya excluye estos servidores.
    if (blocked.includes(due.guildId)) {
      result.skipped++;
      continue;
    }
    const club = await repos.clubs.findById(due.clubId);
    if (!club || !(await repos.reminders.claim(due.clubId, due.callupId))) {
      result.skipped++;
      continue;
    }
    // Contexto del sistema: solo se usa para leer datos de este club, no para permisos.
    const ctx = {
      club,
      membership: null,
      actor: { discordUserId: 'sistema', displayName: 'PIRLO BOT', guildId: due.guildId, isGuildManager: false },
    } satisfies ClubContext;
    try {
      const board = await callupBoard(repos, ctx, due.callupId);
      const pending = board.pending.map((m) => m.discordUserId).filter((id): id is string => Boolean(id));
      const mentioned: string[] = [];
      let chars = 0;
      for (const id of pending.slice(0, MAX_MENTIONS)) {
        if (chars + id.length + 4 > MAX_MENTION_CHARS) break;
        mentioned.push(id);
        chars += id.length + 4;
      }
      const others = pending.length - mentioned.length;
      const content =
        `⏰ **${escapeMd(board.callup.title)}** empieza ${discordTime(board.callup.startsAt, 'R')}.` +
        (mentioned.length
          ? `\nFaltan por responder: ${mentioned.map((id) => `<@${id}>`).join(' ')}${others > 0 ? ` y ${others} más` : ''}`
          : '\nYa respondió todo el mundo. ¡A jugar!');
      const posted = await poster.post(due.channelId, {
        content,
        embeds: [boardEmbed(board, club.name)],
        components: boardButtons(board, club.slug),
        // Solo se notifica a quien falta por responder.
        allowed_mentions: { parse: [], users: mentioned },
      });
      if (posted.id) await repos.callups.recordMessage(due.clubId, due.callupId, due.channelId, posted.id);
      result.sent++;
    } catch (err) {
      result.failed++;
      // Error temporal (Discord caído, límite de peticiones, red): se devuelve a la cola para la
      // siguiente pasada. Un rechazo definitivo (permisos, canal borrado) no se reintenta.
      const transient = !(err instanceof DiscordPostError) || err.status === 429 || err.status >= 500;
      if (transient) await repos.reminders.release(due.clubId, due.callupId).catch(() => undefined);
      const reason = err instanceof DiscordPostError ? `HTTP ${err.status}${err.detail ? ` · ${err.detail}` : ''}` : 'error interno';
      (result.errors ??= []).push(`canal ${due.channelId}: ${reason}`);
      deps.log?.error({ err, clubId: due.clubId, callupId: due.callupId }, 'No se pudo publicar el recordatorio');
    }
  }
  return result;
}
