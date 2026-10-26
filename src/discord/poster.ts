/**
 * Mensajes por iniciativa del bot (recordatorios y sincronización de tableros). Usa la API REST de
 * Discord con el token del bot. El token nunca aparece en errores ni en logs.
 */
export interface PosterFile {
  name: string;
  data: Uint8Array;
  contentType: string;
}

export interface ChannelPoster {
  /** Publica un mensaje (con archivos adjuntos opcionales, p. ej. imágenes) y devuelve su id. */
  post(
    channelId: string,
    body: Record<string, unknown>,
    files?: PosterFile[],
  ): Promise<{ id: string | null }>;
  /** Edita un mensaje publicado por el bot. */
  edit(channelId: string, messageId: string, body: Record<string, unknown>): Promise<void>;
}

export class DiscordPostError extends Error {
  constructor(
    readonly status: number,
    /** Código y mensaje de error de Discord (p. ej. "50013 Missing Permissions"). */
    readonly detail: string | null = null,
  ) {
    super(`Discord rechazó la publicación (HTTP ${status}${detail ? `: ${detail}` : ''}).`);
    this.name = 'DiscordPostError';
  }
}

const SNOWFLAKE = /^\d{17,20}$/;

export function createDiscordPoster(
  botToken: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 10_000,
): ChannelPoster {
  async function call(
    method: 'POST' | 'PATCH',
    path: string,
    body: Record<string, unknown>,
    files: PosterFile[] = [],
  ) {
    let init: RequestInit;
    if (files.length === 0) {
      init = {
        headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      };
    } else {
      // Adjuntos: multipart con payload_json y files[n] (Discord pone el content-type del límite).
      const form = new FormData();
      form.append(
        'payload_json',
        JSON.stringify({ ...body, attachments: files.map((f, id) => ({ id, filename: f.name })) }),
      );
      files.forEach((f, i) =>
        form.append(`files[${i}]`, new Blob([f.data as Uint8Array<ArrayBuffer>], { type: f.contentType }), f.name),
      );
      init = { headers: { authorization: `Bot ${botToken}` }, body: form };
    }
    const res = await fetchFn(`https://discord.com/api/v10${path}`, {
      method,
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      // Discord responde {code, message}; nunca incluye el token.
      let detail: string | null = null;
      try {
        const err = (await res.json()) as { code?: number; message?: string };
        detail = [err.code, err.message].filter(Boolean).join(' ').slice(0, 200) || null;
      } catch {
        detail = null;
      }
      throw new DiscordPostError(res.status, detail);
    }
    return res;
  }

  return {
    async post(channelId, body, files) {
      if (!SNOWFLAKE.test(channelId)) throw new DiscordPostError(400);
      const res = await call('POST', `/channels/${channelId}/messages`, body, files);
      try {
        const msg = (await res.json()) as { id?: unknown };
        return { id: typeof msg.id === 'string' && SNOWFLAKE.test(msg.id) ? msg.id : null };
      } catch {
        return { id: null };
      }
    },
    async edit(channelId, messageId, body) {
      if (!SNOWFLAKE.test(channelId) || !SNOWFLAKE.test(messageId)) throw new DiscordPostError(400);
      await call('PATCH', `/channels/${channelId}/messages/${messageId}`, body);
    },
  };
}
