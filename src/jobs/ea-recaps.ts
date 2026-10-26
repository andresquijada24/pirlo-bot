import type { Repositories } from '../db/repositories/types.js';
import { recapEmbed, recapHeader } from '../discord/ea-recap.js';
import { DiscordPostError, type ChannelPoster, type PosterFile } from '../discord/poster.js';
import type { MatchCardInput } from '../render/match-card.js';
import { REFERENCE_GUILD_ID } from './reminders.js';

/**
 * Publica el resumen de los partidos de EA recién procesados en el canal de **resultados** de cada
 * club. Sin ese canal configurado no se publica nada (es la forma de activarlo). Nunca publica en
 * el servidor de referencia ni en los bloqueados, y cada partido se anuncia una sola vez.
 */

export interface EaRecapResult {
  posted: number;
  failed: number;
  errors?: string[];
}

/** Discord admite hasta 10 embeds por mensaje. */
const PER_MESSAGE = 10;

export async function runEaRecaps(deps: {
  repos: Pick<Repositories, 'ea' | 'channels' | 'clubs'>;
  poster: ChannelPoster;
  blockedGuilds: ReadonlySet<string>;
  /** Genera la imagen PNG de un partido. Si falta o falla, se publican tarjetas de texto. */
  render?: (input: MatchCardInput) => Promise<Uint8Array>;
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
      const content = recapHeader(recaps, club.name);
      const images = await renderAll(deps, recaps, club.name, club.timezone);
      if (images) {
        await poster.post(target.channelId, { content, allowed_mentions: { parse: [] } }, images);
      } else {
        await poster.post(target.channelId, {
          content,
          embeds: recaps.map((r) => recapEmbed(r, club.name)),
          allowed_mentions: { parse: [] },
        });
      }
      result.posted += recaps.length;
    } catch (err) {
      result.failed += ids.length;
      // Error temporal (Discord caído, límite, red): se reintenta en la próxima pasada.
      const transient = !(err instanceof DiscordPostError) || err.status === 429 || err.status >= 500;
      if (transient) await repos.ea.releaseRecaps(link.clubId, ids).catch(() => undefined);
      const reason =
        err instanceof DiscordPostError ? `HTTP ${err.status}${err.detail ? ` · ${err.detail}` : ''}` : 'error interno';
      (result.errors ??= []).push(`canal ${target.channelId}: ${reason}`);
      deps.log?.error({ err, clubId: link.clubId }, 'No se pudo publicar el resumen de EA');
    }
  }
  return result;
}

/** Una imagen por partido; null si no hay renderizador o alguna falla (se usa el texto). */
async function renderAll(
  deps: Parameters<typeof runEaRecaps>[0],
  recaps: Awaited<ReturnType<Repositories['ea']['recaps']>>,
  clubName: string,
  timeZone: string,
): Promise<PosterFile[] | null> {
  if (!deps.render) return null;
  try {
    const files: PosterFile[] = [];
    for (const [i, recap] of recaps.entries()) {
      const data = await deps.render({ recap, clubName, timeZone });
      files.push({ name: `partido-${i + 1}.png`, data, contentType: 'image/png' });
    }
    return files;
  } catch (err) {
    deps.log?.error({ err }, 'No se pudo generar la imagen del partido; se publica en texto');
    return null;
  }
}
