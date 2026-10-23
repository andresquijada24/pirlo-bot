import { handle } from 'hono/vercel';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { logger } from '../src/lib/logger.js';

/** Punto de entrada en Vercel. vercel.json reescribe /api/* hacia esta función. */
const env = loadEnv();
const app = createApp({ discordPublicKey: env.DISCORD_PUBLIC_KEY, log: logger });

export const GET = handle(app);
export const POST = handle(app);
