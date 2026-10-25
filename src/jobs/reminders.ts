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
/** Discord permite mencionar hasta 100 usuarios por mensaje. */
const MAX_MENTIONS = 100;

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

  for (const due of await repos.reminders.due(MAX_PER_RUN)) {
    if (deps.blockedGuilds.has(due.guildId) || due.guildId === REFERENCE_GUILD_ID) {
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
      const mentioned = pending.slice(0, MAX_MENTIONS);
      const content =
        `⏰ **${escapeMd(board.callup.title)}** empieza ${discordTime(board.callup.startsAt, 'R')}.` +
        (mentioned.length ? `\nFaltan por responder: ${mentioned.map((id) => `<@${id}>`).join(' ')}` : '\nYa respondió todo el mundo. ¡A jugar!');
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
      const reason = err instanceof DiscordPostError ? `HTTP ${err.status}${err.detail ? ` · ${err.detail}` : ''}` : 'error interno';
      (result.errors ??= []).push(`canal ${due.channelId}: ${reason}`);
      deps.log?.error({ err, clubId: due.clubId, callupId: due.callupId }, 'No se pudo publicar el recordatorio');
    }
  }
  return result;
}
