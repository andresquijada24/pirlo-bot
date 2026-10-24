import { handle } from 'hono/vercel';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createServerClient } from '../src/db/client.js';
import { createSupabaseRepositories } from '../src/db/repositories/supabase.js';
import { logger } from '../src/lib/logger.js';

/** Punto de entrada en Vercel. vercel.json reescribe /api/* hacia esta función. */
const env = loadEnv();

const repos =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? createSupabaseRepositories(createServerClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY))
    : null;
if (!repos) logger.warn({}, 'Supabase no configurado: los comandos que usan datos avisarán al usuario');

const app = createApp({ discordPublicKey: env.DISCORD_PUBLIC_KEY, repos, log: logger });

export const GET = handle(app);
export const POST = handle(app);
