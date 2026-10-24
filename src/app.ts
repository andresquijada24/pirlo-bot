import { Hono } from 'hono';
import type { APIInteraction } from 'discord-api-types/v10';
import type { Repositories } from './db/repositories/types.js';
import { commandsByName, componentHandlers } from './discord/commands/index.js';
import type { ComponentHandler, SlashCommand } from './discord/commands/types.js';
import { routeInteraction } from './discord/router.js';
import { verifyDiscordRequest } from './discord/verify.js';

export interface AppDeps {
  discordPublicKey: string;
  /** null si la base de datos no está configurada: los comandos que la necesitan avisan. */
  repos?: Repositories | null;
  commands?: ReadonlyMap<string, SlashCommand>;
  components?: ReadonlyMap<string, ComponentHandler>;
  log?: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
}

/** Crea la app HTTP. Se inyectan dependencias para poder probarla sin red ni secretos reales. */
export function createApp(deps: AppDeps) {
  const routerDeps = {
    commands: deps.commands ?? commandsByName,
    components: deps.components ?? componentHandlers,
    repos: deps.repos ?? null,
    ...(deps.log ? { log: deps.log } : {}),
  };
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

    // routeInteraction nunca lanza: los errores ya vienen convertidos en respuesta.
    return c.json(await routeInteraction(interaction, routerDeps));
  });

  return app;
}
