import { localDay } from '../core/stats/ea-session.js';
import type { Repositories } from '../db/repositories/types.js';
import { compareIds, type ChannelReader, type DiscordMessage } from '../discord/channel-reader.js';
import { DiscordPostError, type ChannelPoster } from '../discord/poster.js';
import { toClubMatch, type MatchImageRead } from '../providers/ourproclub/match-image.js';
import { readSessionRecap } from '../providers/ourproclub/recap.js';
import type { ExternalSession } from '../providers/types.js';
import { svgToPng } from '../render/match-card.js';
import {
  renderResultCardSvg,
  resultOf,
  type MatchResult,
  type ResultCardInput,
} from '../render/result-card.js';
import { REFERENCE_GUILD_ID } from './reminders.js';

/**
 * Espejo de Our Pro Club desde el Discord de cada club (sin Gateway: lectura REST cada minuto).
 *
 * Solo en los clubes que eligieron su canal con `/club canal` (uso «Our Pro Club»): ese es su
 * consentimiento. Solo se leen mensajes del bot de Our Pro Club.
 * - Partido terminado (Our Pro Club publica una imagen): se lee la imagen (lector de texto gratuito)
 *   y se publica al momento la tarjeta de partido propia de PIRLO en el canal de resultados. Si la
 *   lectura no es segura, solo un aviso de texto: nunca números dudosos ni la imagen de otro bot.
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

export function matchMessage(clubName: string, match: MatchResult | null): string {
  if (!match)
    return `**Partido terminado · ${clubName}** · las estadísticas de este partido llegan con el resumen de la sesión.`;
  const res = resultOf(match).label.toLowerCase();
  return `**${clubName} ${match.goalsFor}–${match.goalsAgainst} ${match.opponentName}** · ${res}${match.competition ? ` · ${match.competition.toLowerCase()}` : ''}`;
}

export async function runOurProClub(deps: {
  repos: Pick<
    Repositories,
    'ourproclub' | 'channels' | 'clubs' | 'sync' | 'ea' | 'externalPlayers'
  >;
  reader: ChannelReader;
  poster: ChannelPoster;
  /** Lector de la imagen de partido (OCR). Sin él solo se publica el aviso de texto. */
  readImage?: (
    png: Uint8Array,
    knownPlayers: string[],
    reject: (reason: string) => void,
  ) => Promise<MatchImageRead | null>;
  render?: (input: ResultCardInput) => Promise<Uint8Array>;
  blockedGuilds: ReadonlySet<string>;
  now?: () => number;
  log?: {
    error: (obj: object, msg: string) => void;
    warn?: (obj: object, msg: string) => void;
  };
}): Promise<OurProClubResult> {
  const { repos, reader, poster } = deps;
  const now = deps.now ?? Date.now;
  const render = deps.render ?? ((input: ResultCardInput) => svgToPng(renderResultCardSvg(input)));
  const blocked = new Set([...deps.blockedGuilds, REFERENCE_GUILD_ID]);
  const result: OurProClubResult = { clubs: 0, matches: 0, sessions: 0 };

  /** Lee la imagen; cualquier fallo del lector = sin datos (se publica solo el aviso). */
  async function readClubMatch(
    m: DiscordMessage,
    url: string,
    club: { id: string; name: string; timezone: string },
  ): Promise<MatchResult | null> {
    if (!deps.readImage) return null;
    try {
      const png = await reader.image(url);
      const known = await repos.externalPlayers.gamertags(club.id);
      // Motivo del descarte en los registros, para poder corregir el lector.
      const reject = (reason: string) =>
        (deps.log?.warn ?? deps.log?.error)?.(
          { clubId: club.id, messageId: m.id, reason },
          'Lectura de imagen de partido descartada',
        );
      const read = await deps.readImage(png, known, reject);
      return read
        ? toClubMatch(read, [club.name], localDay(m.timestamp, club.timezone), reject)
        : null;
    } catch (err) {
      deps.log?.error({ err, clubId: club.id }, 'No se pudo leer la imagen de partido');
      return null;
    }
  }

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
            const match = await readClubMatch(m, image.url, club);
            const content = matchMessage(club.name, match);
            const body = { content, allowed_mentions: { parse: [] } };
            if (match) {
              const crest = await repos.clubs.crest(club.id).catch(() => null);
              const png = await render({
                match,
                clubName: club.name,
                clubCrestPng: crest,
                source: 'Our Pro Club',
              });
              await poster.post(results.channelId, body, [
                { name: `partido-${m.id}.png`, data: png, contentType: 'image/png' },
              ]);
            } else {
              await poster.post(results.channelId, body);
            }
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
