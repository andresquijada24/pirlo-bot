import { localDay } from '../core/stats/ea-session.js';
import type { Repositories } from '../db/repositories/types.js';
import { compareIds, type ChannelReader, type DiscordMessage } from '../discord/channel-reader.js';
import { DiscordPostError, type ChannelPoster } from '../discord/poster.js';
import { readSessionRecap } from '../providers/ourproclub/recap.js';
import type { ExternalSession } from '../providers/types.js';
import { REFERENCE_GUILD_ID } from './reminders.js';

/**
 * Espejo de Our Pro Club desde el Discord de cada club (sin Gateway: lectura REST cada minuto).
 *
 * Solo en los clubes que eligieron su canal con `/club canal` (uso «Our Pro Club»): ese es su
 * consentimiento. Solo se leen mensajes del bot de Our Pro Club.
 * - Partido terminado (Our Pro Club publica una imagen): aviso al momento en el canal de resultados,
 *   con esa imagen. Los números de cada partido solo existen dentro de la imagen: no se inventan.
 * - «Session Recap» (texto con los números de cada jugador): se guarda como sesión del club; la
 *   tarea de resúmenes publica la tarjeta de PIRLO. En clubes que ya reciben sus sesiones de otra
 *   fuente (Marítimo por su API, o EA) no se guarda, para no contar dos veces los mismos partidos.
 * Cada mensaje se procesa una sola vez. Nunca publica en el servidor de referencia ni en los bloqueados.
 */

export interface OurProClubResult {
  clubs: number;
  matches: number;
  sessions: number;
  errors?: string[];
}

/** Solo se avisan partidos recientes (un canal recién configurado no repite el historial). */
const FRESH_MS = 40 * 60_000;
/** Primera lectura de un canal: últimos mensajes, para tomar el punto de partida. */
const FIRST_READ = 50;

export const isOurProClub = (m: DiscordMessage) =>
  m.author.bot && /our\s*pro\s*club/i.test(m.author.username);

const matchImage = (m: DiscordMessage) =>
  m.attachments.find(
    (a) => /^image\//.test(a.contentType ?? '') || /\.(png|jpe?g|webp)$/i.test(a.filename),
  );

export function matchMessage(clubName: string): string {
  return `**Partido terminado · ${clubName}** · estadísticas del partido de Our Pro Club. El resumen completo de PIRLO llega al cerrar la sesión.`;
}

export async function runOurProClub(deps: {
  repos: Pick<Repositories, 'ourproclub' | 'channels' | 'clubs' | 'sync' | 'ea'>;
  reader: ChannelReader;
  poster: ChannelPoster;
  blockedGuilds: ReadonlySet<string>;
  now?: () => number;
  log?: { error: (obj: object, msg: string) => void };
}): Promise<OurProClubResult> {
  const { repos, reader, poster } = deps;
  const now = deps.now ?? Date.now;
  const blocked = new Set([...deps.blockedGuilds, REFERENCE_GUILD_ID]);
  const result: OurProClubResult = { clubs: 0, matches: 0, sessions: 0 };

  for (const source of await repos.ourproclub.channels()) {
    if (blocked.has(source.guildId)) continue;
    const club = await repos.clubs.findById(source.clubId);
    if (!club || club.status !== 'activo') continue;
    result.clubs++;
    try {
      const after = await repos.ourproclub.latest(club.id);
      const messages = (
        await reader.messages(
          source.channelId,
          after ? { after, limit: 100 } : { limit: FIRST_READ },
        )
      )
        .filter(isOurProClub)
        .sort((a, b) => compareIds(a.id, b.id));
      if (messages.length === 0) continue;
      const results = (await repos.channels.list(club.id)).find((c) => c.purpose === 'resultados');
      const canPost = results && !blocked.has(results.guildId);
      // Sesiones solo si el club no las recibe ya de otra fuente.
      const ownsSessions = club.statsProvider !== 'maritimo' && !(await repos.ea.getLink(club.id));

      for (const m of messages) {
        const age = now() - Date.parse(m.timestamp);
        const fresh = age <= FRESH_MS;
        const recap = readSessionRecap(m.embeds);
        if (recap) {
          // En la primera lectura no se importa el historial: solo resúmenes de las últimas 6 horas.
          if (ownsSessions && recap.players.length > 0 && (after !== null || age <= 6 * 3600_000)) {
            const session: ExternalSession = {
              externalId: m.id,
              publishedAt: m.timestamp,
              playedOn: localDay(m.timestamp, club.timezone),
              matchesPlayed: recap.matchesPlayed || null,
              wins: recap.wins,
              draws: recap.draws,
              losses: recap.losses,
              duplicateOf: null,
              updatedAt: m.timestamp,
              players: recap.players,
            };
            await repos.sync.applySession(club.id, 'ourproclub', session);
            result.sessions++;
          }
          await repos.ourproclub.record(club.id, [
            { messageId: m.id, kind: 'resumen', postedAt: m.timestamp },
          ]);
          continue;
        }
        const image = matchImage(m);
        if (image && fresh && canPost) {
          try {
            const data = await reader.image(image.url);
            await poster.post(
              results.channelId,
              { content: matchMessage(club.name), allowed_mentions: { parse: [] } },
              [
                {
                  name: `partido-${m.id}.png`,
                  data,
                  contentType: image.contentType ?? 'image/png',
                },
              ],
            );
            result.matches++;
          } catch (err) {
            // Error definitivo de Discord (p. ej. sin permiso en el canal): no se reintenta cada minuto.
            const permanent =
              err instanceof DiscordPostError && err.status < 500 && err.status !== 429;
            if (!permanent) throw err;
            (result.errors ??= []).push(`${club.slug}: HTTP ${err.status}`);
          }
        }
        await repos.ourproclub.record(club.id, [
          { messageId: m.id, kind: image ? 'partido' : 'otro', postedAt: m.timestamp },
        ]);
      }
    } catch (err) {
      // Lo no registrado se reintenta en la próxima pasada (un minuto después).
      const reason =
        err instanceof DiscordPostError
          ? `HTTP ${err.status}`
          : err instanceof Error
            ? err.message
            : 'error interno';
      (result.errors ??= []).push(`${club.slug}: ${reason}`);
      deps.log?.error({ err, clubId: club.id }, 'Fallo en el espejo de Our Pro Club');
    }
  }
  return result;
}
