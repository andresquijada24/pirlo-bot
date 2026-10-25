import type { Downloader } from './commands/types.js';

/**
 * Descarga adjuntos que un usuario subió a Discord (p. ej. el archivo de partidos de EA que un
 * admin guardó desde su navegador). Solo acepta el CDN de Discord, con límite de tamaño y de
 * tiempo: Discord espera la respuesta a la interacción en menos de 3 segundos.
 */
const ALLOWED_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
export const MAX_ATTACHMENT_BYTES = 2_000_000;

export class DownloadError extends Error {}

export function createDiscordDownloader(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 1_500,
): Downloader {
  return async (url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new DownloadError('Dirección de adjunto no válida.');
    }
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
      throw new DownloadError('Solo se aceptan archivos subidos a Discord.');
    }
    const res = await fetchImpl(parsed, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => {
      throw new DownloadError('No se pudo descargar el archivo. Inténtalo de nuevo.');
    });
    if (!res.ok) throw new DownloadError('No se pudo descargar el archivo. Inténtalo de nuevo.');
    const length = Number(res.headers.get('content-length') ?? '0');
    if (length > MAX_ATTACHMENT_BYTES)
      throw new DownloadError('El archivo es demasiado grande (máx. 2 MB).');
    const text = await res.text();
    if (text.length > MAX_ATTACHMENT_BYTES)
      throw new DownloadError('El archivo es demasiado grande (máx. 2 MB).');
    return text;
  };
}
