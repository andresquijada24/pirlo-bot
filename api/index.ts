import { handle } from 'hono/vercel';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createServerClient } from '../src/db/client.js';
import { createSupabaseRepositories } from '../src/db/repositories/supabase.js';
import { logger } from '../src/lib/logger.js';
import { MaritimoStatsProvider } from '../src/providers/maritimo/provider.js';
import { runSync } from '../src/sync/engine.js';
import { createDiscordPoster } from '../src/discord/poster.js';
import { createDiscordBinaryDownloader, createDiscordDownloader } from '../src/discord/download.js';
import { runReminders } from '../src/jobs/reminders.js';
import { runEaProcessing } from '../src/jobs/ea-processing.js';
import { runEaRecaps } from '../src/jobs/ea-recaps.js';
import { renderMatchCardSvg, svgToPng } from '../src/render/match-card.js';
import { createGuildApi } from '../src/discord/onboarding.js';
import { ownerIdsFrom } from '../src/core/platform.js';
import { runAutoCrests } from '../src/jobs/auto-crests.js';

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
  download: createDiscordDownloader(),
  downloadBytes: createDiscordBinaryDownloader(),
  eaBridgeToken: env.EA_BRIDGE_TOKEN,
  panel: {
    ownerIds: ownerIdsFrom(env.PIRLO_OWNER_DISCORD_IDS),
    clientId: env.DISCORD_APPLICATION_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    origin: 'https://pirlo-bot.vercel.app',
    api: createGuildApi(env.DISCORD_BOT_TOKEN),
  },
  onboarding: {
    api: createGuildApi(env.DISCORD_BOT_TOKEN),
    blockedGuilds: new Set(env.POSTING_BLOCKED_GUILDS?.split(',') ?? []),
    ownerIds: ownerIdsFrom(env.PIRLO_OWNER_DISCORD_IDS),
  },
  cron: {
    secret: env.CRON_SECRET,
    schedulerKeyHash: repos ? () => repos.sync.schedulerKeyHash() : null,
    sync:
      repos && maritimo
        ? () => runSync({ repo: repos.sync, provider: maritimo.provider, clubId: maritimo.clubId, log: logger })
        : null,
    tick: repos
      ? async () => {
          const blockedGuilds = new Set(env.POSTING_BLOCKED_GUILDS?.split(',') ?? []);
          // Escudos automáticos (ícono del servidor) para clubes sin escudo; nunca bloquea lo demás.
          await runAutoCrests({ repos, api: createGuildApi(env.DISCORD_BOT_TOKEN, fetch, 5_000), log: logger }).catch(
            (err: unknown) => logger.error({ err }, 'Fallo en los escudos automáticos'),
          );
          const reminders = await runReminders({ repos, poster, blockedGuilds, log: logger });
          // Un fallo de EA no debe afectar a los recordatorios ya enviados.
          const ea = await runEaProcessing({ repos, log: logger }).catch((err: unknown) => {
            logger.error({ err }, 'Fallo en el procesamiento de EA');
            return undefined;
          });
          // Resumen en el canal de resultados de cada club (solo partidos recién procesados).
          const eaRecaps = await runEaRecaps({
            repos,
            poster,
            blockedGuilds,
            render: (input) => svgToPng(renderMatchCardSvg(input)),
            log: logger,
          }).catch((err: unknown) => {
            logger.error({ err }, 'Fallo en los resúmenes de EA');
            return undefined;
          });
          return { ...reminders, ...(ea ? { ea } : {}), ...(eaRecaps ? { eaRecaps } : {}) };
        }
      : null,
  },
});

export const GET = handle(app);
export const POST = handle(app);
