import type { Repositories, SessionRecap } from '../db/repositories/types.js';
import { DiscordPostError, type ChannelPoster } from '../discord/poster.js';
import { PUBLIC_BASE_URL } from '../core/clubs/service.js';
import { formatDay, type SessionCardInput } from '../render/session-card.js';
import { REFERENCE_GUILD_ID } from './reminders.js';

/**
 * Publica el resumen de cada SESIÓN nueva (proveedores por sesión, como Marítimo) en el canal de
 * **resultados** del club, con su tarjeta. Sin ese canal no se publica nada. Nunca publica en el
 * servidor de referencia ni en los bloqueados, y cada sesión se anuncia una sola vez.
 */

export interface SessionRecapResult {
  posted: number;
  failed: number;
  errors?: string[];
}

const PER_RUN = 3;
/** Tiempo máximo que se espera a los jugadores de una sesión antes de publicarla sin ellos. */
export const WAIT_PLAYERS_MS = 30 * 60_000;

/** Nombre legible del origen de los datos para el pie de la tarjeta. */
const SOURCE: Record<string, string> = { maritimo: 'maritimo.app', ourproclub: 'Our Pro Club' };

export function sessionMessage(
  recap: SessionRecap,
  club: { name: string; slug: string },
  webPublic: boolean,
): string {
  const record =
    recap.wins !== null && recap.draws !== null && recap.losses !== null
      ? ` · ${recap.wins}V ${recap.draws}E ${recap.losses}D`
      : '';
  const link = webPublic ? `\nEstadísticas completas: ${PUBLIC_BASE_URL}/club/${club.slug}` : '';
  return `**Resumen de sesión · ${club.name}** · ${formatDay(recap.playedOn).toLowerCase()}${record}${link}`;
}

export async function runSessionRecaps(deps: {
  repos: Pick<Repositories, 'stats' | 'channels' | 'clubs'>;
  poster: ChannelPoster;
  blockedGuilds: ReadonlySet<string>;
  render: (input: SessionCardInput) => Promise<Uint8Array>;
  log?: { error: (obj: object, msg: string) => void };
  now?: () => number;
}): Promise<SessionRecapResult> {
  const { repos, poster } = deps;
  const result: SessionRecapResult = { posted: 0, failed: 0 };
  const blocked = new Set([...deps.blockedGuilds, REFERENCE_GUILD_ID]);

  for (const clubId of await repos.stats.clubsWithPendingRecaps()) {
    const target = (await repos.channels.list(clubId)).find((c) => c.purpose === 'resultados');
    // Sin canal de resultados (o bloqueado) no se reserva nada: se publicará cuando lo configuren.
    if (!target || blocked.has(target.guildId)) continue;
    const club = await repos.clubs.findById(clubId);
    if (!club) continue;
    const ids = await repos.stats.claimSessionRecaps(clubId, PER_RUN);
    if (ids.length === 0) continue;
    const [crest, webPublic] = await Promise.all([
      repos.clubs.crest(clubId).catch(() => null),
      repos.clubs.webPublic(clubId).catch(() => false),
    ]);
    const recaps = await repos.stats.sessionRecaps(clubId, ids);
    const now = (deps.now ?? Date.now)();
    for (const recap of recaps.sort((a, b) =>
      (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''),
    )) {
      // La fuente a veces anuncia la sesión antes de enviar los números de los jugadores: se espera
      // (hasta WAIT_PLAYERS_MS) en lugar de publicar una tarjeta vacía.
      const age = recap.publishedAt ? now - Date.parse(recap.publishedAt) : Infinity;
      if (recap.players.length === 0 && age < WAIT_PLAYERS_MS) {
        await repos.stats.releaseSessionRecaps(clubId, [recap.sessionId]);
        continue;
      }
      try {
        const png = await deps.render({
          recap,
          clubName: club.name,
          clubCrestPng: crest,
          ...(SOURCE[club.statsProvider] ? { source: SOURCE[club.statsProvider]! } : {}),
        });
        await poster.post(
          target.channelId,
          { content: sessionMessage(recap, club, webPublic), allowed_mentions: { parse: [] } },
          [{ name: `sesion-${recap.playedOn}.png`, data: png, contentType: 'image/png' }],
        );
        result.posted++;
      } catch (err) {
        result.failed++;
        const transient =
          !(err instanceof DiscordPostError) || err.status === 429 || err.status >= 500;
        if (transient) {
          await repos.stats.releaseSessionRecaps(clubId, [recap.sessionId]).catch(() => undefined);
        }
        const reason =
          err instanceof DiscordPostError
            ? `HTTP ${err.status}${err.detail ? ` · ${err.detail}` : ''}`
            : 'error interno';
        (result.errors ??= []).push(`canal ${target.channelId}: ${reason}`);
        deps.log?.error({ err, clubId }, 'No se pudo publicar el resumen de la sesión');
      }
    }
  }
  return result;
}
