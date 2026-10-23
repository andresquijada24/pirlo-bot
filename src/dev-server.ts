import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { logger } from './lib/logger.js';

/** Servidor local para desarrollo. Exponer con un túnel (p. ej. cloudflared) para probar con Discord. */
const env = loadEnv();
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: createApp({ discordPublicKey: env.DISCORD_PUBLIC_KEY, log: logger }).fetch, port });
logger.info({ port }, 'PIRLO BOT escuchando en local');
