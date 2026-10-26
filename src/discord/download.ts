import type { BinaryDownloader, Downloader } from './commands/types.js';

/**
 * Descarga adjuntos que un usuario subió a Discord (p. ej. el archivo de partidos de EA que un
 * admin guardó desde su navegador). Solo acepta el CDN de Discord, con límite de tamaño y de
 * tiempo: Discord espera la respuesta a la interacción en menos de 3 segundos.
 */
const ALLOWED_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
export const MAX_ATTACHMENT_BYTES = 2_000_000;

export class DownloadError extends Error {}

/** Descarga comprobada (solo CDN de Discord, https, tamaño y tiempo limitados). */
async function fetchAttachment(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<Response> {
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
  if (length > MAX_ATTACHMENT_BYTES) throw new DownloadError('El archivo es demasiado grande (máx. 2 MB).');
  return res;
}

export function createDiscordDownloader(fetchImpl: typeof fetch = fetch, timeoutMs = 1_500): Downloader {
  return async (url) => {
    const text = await (await fetchAttachment(fetchImpl, url, timeoutMs)).text();
    if (text.length > MAX_ATTACHMENT_BYTES) throw new DownloadError('El archivo es demasiado grande (máx. 2 MB).');
    return text;
  };
}

/** Igual que createDiscordDownloader, pero devuelve los bytes (imágenes). */
export function createDiscordBinaryDownloader(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 1_500,
): BinaryDownloader {
  return async (url) => {
    const bytes = new Uint8Array(await (await fetchAttachment(fetchImpl, url, timeoutMs)).arrayBuffer());
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new DownloadError('El archivo es demasiado grande (máx. 2 MB).');
    return bytes;
  };
}
