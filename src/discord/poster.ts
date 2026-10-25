/**
 * Mensajes por iniciativa del bot (recordatorios y sincronización de tableros). Usa la API REST de
 * Discord con el token del bot. El token nunca aparece en errores ni en logs.
 */
export interface ChannelPoster {
  /** Publica un mensaje y devuelve su id. */
  post(channelId: string, body: Record<string, unknown>): Promise<{ id: string | null }>;
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
  async function call(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>) {
    const res = await fetchFn(`https://discord.com/api/v10${path}`, {
      method,
      headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
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
    async post(channelId, body) {
      if (!SNOWFLAKE.test(channelId)) throw new DiscordPostError(400);
      const res = await call('POST', `/channels/${channelId}/messages`, body);
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
