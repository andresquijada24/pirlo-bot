import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createServerClient } from './db/client.js';
import { createSupabaseRepositories } from './db/repositories/supabase.js';
import { logger } from './lib/logger.js';

/** Servidor local para desarrollo. Exponer con un túnel (p. ej. cloudflared) para probar con Discord. */
const env = loadEnv();
const port = Number(process.env.PORT ?? 3000);
const repos =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? createSupabaseRepositories(createServerClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY))
    : null;

serve({
  fetch: createApp({ discordPublicKey: env.DISCORD_PUBLIC_KEY, repos, log: logger }).fetch,
  port,
});
logger.info({ port, database: repos ? 'conectada' : 'sin configurar' }, 'PIRLO BOT escuchando en local');
