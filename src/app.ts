import { Hono } from 'hono';
import type { APIInteraction } from 'discord-api-types/v10';
import { commandsByName } from './discord/commands/index.js';
import type { SlashCommand } from './discord/commands/types.js';
import { routeInteraction } from './discord/router.js';
import { verifyDiscordRequest } from './discord/verify.js';

export interface AppDeps {
  discordPublicKey: string;
  commands?: ReadonlyMap<string, SlashCommand>;
  log?: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
}

/** Crea la app HTTP. Se inyectan dependencias para poder probarla sin red ni secretos reales. */
export function createApp(deps: AppDeps) {
  const registry = deps.commands ?? commandsByName;
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true, service: 'pirlo-bot' }));

  app.post('/api/interactions', async (c) => {
    const body = await c.req.text();
    const valid = await verifyDiscordRequest({
      body,
      signature: c.req.header('x-signature-ed25519'),
      timestamp: c.req.header('x-signature-timestamp'),
      publicKey: deps.discordPublicKey,
    });
    if (!valid) {
      deps.log?.warn({}, 'Firma de interacción inválida');
      return c.text('Firma inválida', 401);
    }

    let interaction: APIInteraction;
    try {
      interaction = JSON.parse(body) as APIInteraction;
    } catch {
      return c.text('JSON inválido', 400);
    }

    try {
      return c.json(await routeInteraction(interaction, registry));
    } catch (err) {
      deps.log?.error({ err }, 'Error al procesar interacción');
      return c.json({
        type: 4,
        data: { content: 'Ocurrió un error inesperado. Inténtalo de nuevo.', flags: 64 },
      });
    }
  });

  return app;
}
