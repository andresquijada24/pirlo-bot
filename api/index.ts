import { handle } from 'hono/vercel';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createServerClient } from '../src/db/client.js';
import { createSupabaseRepositories } from '../src/db/repositories/supabase.js';
import { logger } from '../src/lib/logger.js';
import { MaritimoStatsProvider } from '../src/providers/maritimo/provider.js';
import { runSync } from '../src/sync/engine.js';
import { createDiscordPoster } from '../src/discord/poster.js';
import { runReminders } from '../src/jobs/reminders.js';
import { runEaProcessing } from '../src/jobs/ea-processing.js';

/** Punto de entrada en Vercel. vercel.json reescribe /api/* hacia esta función. */
const env = loadEnv();

const repos =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? createSupabaseRepositories(createServerClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY))
    : null;
if (!repos) logger.warn({}, 'Supabase no configurado: los comandos que usan datos avisarán al usuario');

// Marítimo solo se sincroniza si están su URL, su clave y el club de destino.
const maritimo =
  repos && env.MARITIMO_API_BASE_URL && env.MARITIMO_API_KEY && env.MARITIMO_CLUB_ID
    ? {
        clubId: env.MARITIMO_CLUB_ID,
        provider: new MaritimoStatsProvider({ baseUrl: env.MARITIMO_API_BASE_URL, apiKey: env.MARITIMO_API_KEY }),
      }
    : null;

// Un único cliente REST del bot. En las interacciones se usa con plazo corto: Discord espera
// la respuesta en menos de 3 segundos.
const poster = createDiscordPoster(env.DISCORD_BOT_TOKEN);
const quickPoster = createDiscordPoster(env.DISCORD_BOT_TOKEN, fetch, 1_500);

const app = createApp({
  discordPublicKey: env.DISCORD_PUBLIC_KEY,
  repos,
  log: logger,
  discord: quickPoster,
  eaBridgeToken: env.EA_BRIDGE_TOKEN,
  cron: {
    secret: env.CRON_SECRET,
    sync:
      repos && maritimo
        ? () => runSync({ repo: repos.sync, provider: maritimo.provider, clubId: maritimo.clubId, log: logger })
        : null,
    tick: repos
      ? async () => {
          const reminders = await runReminders({
            repos,
            poster,
            blockedGuilds: new Set(env.POSTING_BLOCKED_GUILDS?.split(',') ?? []),
            log: logger,
          });
          // Un fallo de EA no debe afectar a los recordatorios ya enviados.
          const ea = await runEaProcessing({ repos, log: logger }).catch((err: unknown) => {
            logger.error({ err }, 'Fallo en el procesamiento de EA');
            return undefined;
          });
          return ea ? { ...reminders, ea } : reminders;
        }
      : null,
  },
});

export const GET = handle(app);
export const POST = handle(app);
