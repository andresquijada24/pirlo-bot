import type { Repositories } from '../db/repositories/types.js';
import { recapEmbed, recapHeader } from '../discord/ea-recap.js';
import { DiscordPostError, type ChannelPoster } from '../discord/poster.js';
import { aggregate } from '../core/stats/service.js';
import { eaSessions, type EaSession } from '../core/stats/ea-session.js';
import { PUBLIC_BASE_URL } from '../core/clubs/service.js';
import { formatDay, type SessionCardInput } from '../render/session-card.js';
import { REFERENCE_GUILD_ID } from './reminders.js';

/**
 * Publica el resumen de los partidos de EA recién procesados en el canal de **resultados** de cada
 * club. Sin ese canal configurado no se publica nada (es la forma de activarlo). Nunca publica en
 * el servidor de referencia ni en los bloqueados, y cada partido se anuncia una sola vez.
 *
 * Con imagen: los partidos se agrupan por día en una SESIÓN y se publica la misma tarjeta de
 * resumen que en los clubes por sesión (con porterías a cero, que EA sí permite calcular), y en
 * el mensaje la lista de partidos con su marcador. Sin imagen: tarjetas de texto por partido.
 */

export interface EaRecapResult {
  posted: number;
  failed: number;
  errors?: string[];
}

/** Discord admite hasta 10 embeds por mensaje. */
const PER_MESSAGE = 10;

export async function runEaRecaps(deps: {
  repos: Pick<Repositories, 'ea' | 'channels' | 'clubs'> &
    Partial<Pick<Repositories, 'stats' | 'seasons' | 'memberships'>>;
  poster: ChannelPoster;
  blockedGuilds: ReadonlySet<string>;
  /** Genera la imagen PNG de una sesión. Si falta o falla, se publican tarjetas de texto. */
  render?: (input: SessionCardInput) => Promise<Uint8Array>;
  log?: { error: (obj: object, msg: string) => void };
}): Promise<EaRecapResult> {
  const { repos, poster } = deps;
  const result: EaRecapResult = { posted: 0, failed: 0 };
  const blocked = new Set([...deps.blockedGuilds, REFERENCE_GUILD_ID]);

  for (const link of await repos.ea.listLinks()) {
    const target = (await repos.channels.list(link.clubId)).find((c) => c.purpose === 'resultados');
    if (!target || blocked.has(target.guildId)) continue;
    const club = await repos.clubs.findById(link.clubId);
    if (!club) continue;
    const ids = await repos.ea.claimRecaps(link.clubId, PER_MESSAGE);
    if (ids.length === 0) continue;
    try {
      const recaps = await repos.ea.recaps(link.clubId, ids);
      if (recaps.length === 0) continue;
      const posted = deps.render
        ? await postSessions(deps, target.channelId, link.clubId, club, recaps)
        : false;
      if (!posted) {
        await poster.post(target.channelId, {
          content: recapHeader(recaps, club.name),
          embeds: recaps.map((r) => recapEmbed(r, club.name)),
          allowed_mentions: { parse: [] },
        });
      }
      result.posted += recaps.length;
    } catch (err) {
      result.failed += ids.length;
      // Error temporal (Discord caído, límite, red): se reintenta en la próxima pasada.
      const transient =
        !(err instanceof DiscordPostError) || err.status === 429 || err.status >= 500;
      if (transient) await repos.ea.releaseRecaps(link.clubId, ids).catch(() => undefined);
      const reason =
        err instanceof DiscordPostError
          ? `HTTP ${err.status}${err.detail ? ` · ${err.detail}` : ''}`
          : 'error interno';
      (result.errors ??= []).push(`canal ${target.channelId}: ${reason}`);
      deps.log?.error({ err, clubId: link.clubId }, 'No se pudo publicar el resumen de EA');
    }
  }
  return result;
}

const TYPE = { leagueMatch: 'Liga', playoffMatch: 'Copa', friendlyMatch: 'Amistoso' } as const;

/** Texto del mensaje: título, balance y cada partido con su marcador; enlace a la web si es pública. */
export function eaSessionMessage(
  session: EaSession,
  club: { name: string; slug: string },
  webPublic: boolean,
): string {
  const lines = session.matches.map((m) => {
    const score =
      m.goalsFor !== null && m.goalsAgainst !== null
        ? `${m.goalsFor}–${m.goalsAgainst}`
        : 'sin marcador';
    return `• ${TYPE[m.matchType]} · ${score} vs ${m.opponentName ?? 'Rival'}`;
  });
  return [
    `**Resumen de sesión · ${club.name}** · ${formatDay(session.playedOn).toLowerCase()} · ${session.wins}V ${session.draws}E ${session.losses}D`,
    ...lines,
    ...(webPublic ? [`Estadísticas completas: ${PUBLIC_BASE_URL}/club/${club.slug}`] : []),
  ].join('\n');
}

/** Media de calificación de la temporada actual por nombre (para «vs media»). */
async function seasonRatings(
  repos: Parameters<typeof runEaRecaps>[0]['repos'],
  clubId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!repos.stats || !repos.seasons || !repos.memberships) return out;
  const season = (await repos.seasons.list(clubId)).find((s) => s.isCurrent) ?? null;
  const roster = await repos.memberships.listActive(clubId);
  const rows = await repos.stats.sessionRows(clubId, season?.id ?? null);
  for (const t of aggregate(rows, new Map(roster.map((m) => [m.playerId, m.displayName])))) {
    if (t.avgRating !== null) out.set(t.name.toLowerCase(), t.avgRating);
  }
  return out;
}

/** Una tarjeta por día. false si la imagen falla (se publica en texto). */
async function postSessions(
  deps: Parameters<typeof runEaRecaps>[0],
  channelId: string,
  clubId: string,
  club: { name: string; slug: string; timezone: string },
  recaps: Awaited<ReturnType<Repositories['ea']['recaps']>>,
): Promise<boolean> {
  let files: { session: EaSession; png: Uint8Array }[];
  const [crest, webPublic, ratings] = await Promise.all([
    deps.repos.clubs.crest(clubId).catch(() => null),
    deps.repos.clubs.webPublic(clubId).catch(() => false),
    seasonRatings(deps.repos, clubId).catch(() => new Map<string, number>()),
  ]);
  try {
    files = [];
    for (const session of eaSessions(recaps, club.timezone, ratings)) {
      const png = await deps.render!({
        recap: session,
        clubName: club.name,
        clubCrestPng: crest,
        source: 'EA SPORTS FC',
      });
      files.push({ session, png });
    }
  } catch (err) {
    deps.log?.error({ err }, 'No se pudo generar la imagen de la sesión; se publica en texto');
    return false;
  }
  for (const { session, png } of files) {
    await deps.poster.post(
      channelId,
      { content: eaSessionMessage(session, club, webPublic), allowed_mentions: { parse: [] } },
      [{ name: `sesion-${session.playedOn}.png`, data: png, contentType: 'image/png' }],
    );
  }
  return true;
}
