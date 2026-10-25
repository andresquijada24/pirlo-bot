/**
 * Publicación de mensajes por iniciativa del bot (recordatorios). Usa la API REST de Discord con
 * el token del bot. El token nunca aparece en errores ni en logs.
 */
export interface ChannelPoster {
  post(channelId: string, body: Record<string, unknown>): Promise<void>;
}

export class DiscordPostError extends Error {
  constructor(readonly status: number) {
    super(`Discord rechazó la publicación (HTTP ${status}).`);
    this.name = 'DiscordPostError';
  }
}

export function createDiscordPoster(botToken: string, fetchFn: typeof fetch = fetch): ChannelPoster {
  return {
    async post(channelId, body) {
      if (!/^\d{17,20}$/.test(channelId)) throw new DiscordPostError(400);
      const res = await fetchFn(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new DiscordPostError(res.status);
    },
  };
}
