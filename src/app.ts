import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { isDomainError } from './core/errors.js';
import { parseIngest } from './providers/ea/ingest.js';
import {
  loadClubPage,
  loadTopScorers,
  notFoundPage,
  renderClubPage,
  loadPlayerPage,
  parseMatchFilter,
  parseView,
  renderPlayerPage,
  renderClubsDirectory,
  renderScorersWidget,
} from './web/club-page.js';
import type { APIInteraction } from 'discord-api-types/v10';
import type { Repositories } from './db/repositories/types.js';
import { commandsByName, componentHandlers } from './discord/commands/index.js';
import type { ComponentHandler, SlashCommand } from './discord/commands/types.js';
import { routeInteraction } from './discord/router.js';
import { verifyDiscordRequest } from './discord/verify.js';
import { onboardGuild, type GuildApi } from './discord/onboarding.js';
import { registerPanelRoutes, type PanelDeps } from './web/panel.js';
import { registerPhotoUploadRoutes } from './web/photo-upload.js';
import { registerAccountRoutes } from './web/account.js';
import { currentVersion } from './web/version.js';
import type { SyncResult } from './sync/engine.js';
import type { ReminderResult } from './jobs/reminders.js';
import type { EaProcessingResult } from './jobs/ea-processing.js';
import type { EaRecapResult } from './jobs/ea-recaps.js';
import type { SessionRecapResult } from './jobs/session-recaps.js';
import type { ChannelPoster } from './discord/poster.js';
import type { BinaryDownloader, Downloader } from './discord/commands/types.js';

export interface AppDeps {
  discordPublicKey: string;
  /** null si la base de datos no está configurada: los comandos que la necesitan avisan. */
  repos?: Repositories | null;
  commands?: ReadonlyMap<string, SlashCommand>;
  components?: ReadonlyMap<string, ComponentHandler>;
  log?: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
  /** Tarea programada de sincronización. `sync` es null si el proveedor no está configurado. */
  /** Clave del puente de EA; sin ella, la captura está desactivada. */
  eaBridgeToken?: string | undefined;
  /** Cliente REST del bot para editar tableros de convocatoria. */
  discord?: ChannelPoster;
  /** Descarga de adjuntos de Discord (importación de partidos). */
  download?: Downloader;
  downloadBytes?: BinaryDownloader;
  /** Alta automática al instalar el bot (eventos webhook de Discord). */
  /** Panel interno (/panel). Sin él, la ruta no existe. */
  panel?: Omit<PanelDeps, 'repos' | 'log'>;
  onboarding?: { api: GuildApi; blockedGuilds: ReadonlySet<string>; ownerIds: ReadonlySet<string>; deadlineMs?: number };
  cron?: {
    secret: string | undefined;
    /**
     * Huella SHA-256 (hex) de la clave del programador de Supabase, guardada en la base de datos.
     * La clave en sí solo existe cifrada en Supabase Vault.
     */
    schedulerKeyHash?: (() => Promise<string | null>) | null;
    sync: (() => Promise<SyncResult>) | null;
    /** Recordatorios y procesamiento de partidos de EA; null si no hay base de datos. */
    tick?:
      | (() => Promise<
          ReminderResult & { ea?: EaProcessingResult; eaRecaps?: EaRecapResult; sessionRecaps?: SessionRecapResult }
        >)
      | null;
  };
}

/** Compara el token sin filtrar información por el tiempo de respuesta. */
function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Crea la app HTTP. Se inyectan dependencias para poder probarla sin red ni secretos reales. */
export function createApp(deps: AppDeps) {
  const routerDeps = {
    commands: deps.commands ?? commandsByName,
    components: deps.components ?? componentHandlers,
    repos: deps.repos ?? null,
    ...(deps.log ? { log: deps.log } : {}),
    ...(deps.discord ? { discord: deps.discord } : {}),
    ...(deps.download ? { download: deps.download } : {}),
    ...(deps.downloadBytes ? { downloadBytes: deps.downloadBytes } : {}),
    ...(deps.onboarding ? { platform: { ownerIds: deps.onboarding.ownerIds, api: deps.onboarding.api } } : {}),
  };
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true, service: 'pirlo-bot' }));

  // Versión publicada: la consulta el aviso «Hay una actualización» de las páginas.
  app.get('/api/version', (c) =>
    c.json({ version: currentVersion() }, 200, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }),
  );

  /*
   * Página pública de un club (solo si un admin la activó con /club web). HTML sin JavaScript
   * propio salvo /update.js (aviso de actualización, mismo origen); estilos en línea e imágenes propias.
   */
  /**
   * Páginas públicas: el navegador siempre comprueba si hay versión nueva (max-age=0) y la red de
   * Vercel guarda la página 5 minutos (s-maxage); cada despliegue la renueva al instante.
   */
  const PAGE_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=60';
  const PAGE_HEADERS = {
    'content-security-policy':
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  };
  app.get('/clubes', async (c) => {
    if (!deps.repos) return c.html(notFoundPage(), 503, PAGE_HEADERS);
    try {
      const clubs = await deps.repos.clubs.listPublic();
      return c.html(renderClubsDirectory(clubs), 200, { ...PAGE_HEADERS, 'cache-control': PAGE_CACHE });
    } catch (err) {
      deps.log?.error({ err }, 'No se pudo generar el directorio de clubes');
      return c.html(notFoundPage(), 500, PAGE_HEADERS);
    }
  });
  // Goleadores reales para la página principal, que lo incrusta en un iframe del mismo origen.
  const WIDGET_HEADERS = {
    ...PAGE_HEADERS,
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  };
  app.get('/widget/goleadores', async (c) => {
    if (!deps.repos) return c.html(renderScorersWidget([]), 200, WIDGET_HEADERS);
    try {
      const scorers = await loadTopScorers(deps.repos, 5);
      return c.html(renderScorersWidget(scorers), 200, { ...WIDGET_HEADERS, 'cache-control': PAGE_CACHE });
    } catch (err) {
      deps.log?.error({ err }, 'No se pudo generar el ranking de goleadores');
      return c.html(renderScorersWidget([]), 500, WIDGET_HEADERS);
    }
  });
  app.get('/club/:slug', async (c) => {
    const notFound = () => c.html(notFoundPage(), 404, PAGE_HEADERS);
    if (!deps.repos) return notFound();
    try {
      const data = await loadClubPage(
        deps.repos,
        c.req.param('slug').toLowerCase(),
        parseMatchFilter(c.req.query('tipo')),
        parseView({ orden: c.req.query('orden'), dir: c.req.query('dir'), buscar: c.req.query('buscar') }),
      );
      if (!data) return notFound();
      return c.html(renderClubPage(data), 200, { ...PAGE_HEADERS, 'cache-control': PAGE_CACHE });
    } catch (err) {
      deps.log?.error({ err }, 'No se pudo generar la página del club');
      return c.html(notFoundPage(), 500, PAGE_HEADERS);
    }
  });
  app.get('/club/:slug/jugador/:key', async (c) => {
    const notFound = () => c.html(notFoundPage(), 404, PAGE_HEADERS);
    if (!deps.repos) return notFound();
    try {
      const data = await loadPlayerPage(
        deps.repos,
        c.req.param('slug').toLowerCase(),
        c.req.param('key'),
        parseMatchFilter(c.req.query('tipo')),
      );
      if (!data) return notFound();
      return c.html(renderPlayerPage(data), 200, { ...PAGE_HEADERS, 'cache-control': PAGE_CACHE });
    } catch (err) {
      deps.log?.error({ err }, 'No se pudo generar la ficha del jugador');
      return c.html(notFoundPage(), 500, PAGE_HEADERS);
    }
  });
  app.get('/club/:slug/jugador/:id/foto.jpg', async (c) => {
    const id = c.req.param('id');
    if (!deps.repos || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return c.body(null, 404);
    const club = await deps.repos.clubs.findPublic(c.req.param('slug').toLowerCase()).catch(() => null);
    const photo = club ? await deps.repos.memberships.photo(club.id, id).catch(() => null) : null;
    if (!photo) return c.body(null, 404);
    // Misma dirección aunque cambie la foto: el navegador vuelve a preguntar siempre (no-cache) y,
    // si la foto no cambió, recibe un 304 sin descargarla de nuevo.
    const etag = `"${createHash('sha256').update(photo).digest('base64url').slice(0, 22)}"`;
    const headers = { etag, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' };
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers);
    return c.body(Buffer.from(photo, 'base64'), 200, { 'content-type': 'image/jpeg', ...headers });
  });
  app.get('/club/:slug/escudo.png', async (c) => {
    if (!deps.repos) return c.body(null, 404);
    const club = await deps.repos.clubs.findPublic(c.req.param('slug').toLowerCase()).catch(() => null);
    const crest = club ? await deps.repos.clubs.crest(club.id).catch(() => null) : null;
    if (!crest) return c.body(null, 404);
    return c.body(Buffer.from(crest, 'base64'), 200, {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
  });

  if (deps.panel) {
    registerPanelRoutes(app, { ...deps.panel, repos: deps.repos ?? null, ...(deps.log ? { log: deps.log } : {}) });
    registerPhotoUploadRoutes(app, {
      repos: deps.repos ?? null,
      clientId: deps.panel.clientId,
      clientSecret: deps.panel.clientSecret,
      origin: deps.panel.origin,
      ...(deps.panel.now ? { now: deps.panel.now } : {}),
      ...(deps.log ? { log: deps.log } : {}),
    });
    registerAccountRoutes(app, {
      repos: deps.repos ?? null,
      clientSecret: deps.panel.clientSecret,
      ...(deps.panel.now ? { now: deps.panel.now } : {}),
      ...(deps.log ? { log: deps.log } : {}),
    });
  }

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

  /*
   * Eventos webhook de Discord (Developer Portal → Webhooks). Solo APPLICATION_AUTHORIZED en un
   * servidor: crea el club automáticamente. Discord exige 204 en menos de 3 s; si el alta tarda,
   * se responde igual y el reintento de Discord es idempotente.
   */
  app.post('/api/discord/events', async (c) => {
    const body = await c.req.text();
    const valid = await verifyDiscordRequest({
      body,
      signature: c.req.header('x-signature-ed25519'),
      timestamp: c.req.header('x-signature-timestamp'),
      publicKey: deps.discordPublicKey,
    });
    if (!valid) return c.text('Firma inválida', 401);
    let payload: {
      type?: unknown;
      event?: { type?: unknown; data?: { integration_type?: unknown; guild?: unknown; user?: unknown } };
    };
    try {
      payload = JSON.parse(body) as typeof payload;
    } catch {
      return c.text('JSON inválido', 400);
    }
    const data = payload.event?.data;
    const guild = data?.guild as { id?: unknown; name?: unknown } | undefined;
    const user = data?.user as { id?: unknown; username?: unknown; global_name?: unknown } | undefined;
    if (
      payload.type === 1 &&
      payload.event?.type === 'APPLICATION_AUTHORIZED' &&
      data?.integration_type === 0 &&
      typeof guild?.id === 'string' &&
      typeof user?.id === 'string' &&
      deps.repos &&
      deps.onboarding
    ) {
      const userName =
        typeof user.global_name === 'string' ? user.global_name : typeof user.username === 'string' ? user.username : '';
      const work = onboardGuild(
        {
          repos: deps.repos,
          api: deps.onboarding.api,
          blockedGuilds: deps.onboarding.blockedGuilds,
          ownerIds: deps.onboarding.ownerIds,
          ...(deps.log ? { log: deps.log } : {}),
        },
        { guildId: guild.id, guildName: typeof guild.name === 'string' ? guild.name : '', userId: user.id, userName },
      ).catch((err: unknown) => {
        deps.log?.error({ err }, 'Fallo en el alta automática del club');
      });
      await Promise.race([work, new Promise((r) => setTimeout(r, deps.onboarding?.deadlineMs ?? 2_500))]);
    }
    return c.body(null, 204);
  });

  /*
   * Sincronización programada (la invoca el workflow "Sincronizar Marítimo").
   * Protegida con `Authorization: Bearer <CRON_SECRET>`. Nunca devuelve secretos ni datos de
   * jugadores: solo conteos y el estado.
   */
  /**
   * null si la petición está autorizada; si no, la respuesta de error. Vale CRON_SECRET (workflow
   * de GitHub) o la clave del programador de Supabase, comparada por su huella guardada.
   */
  let keyCache: { hash: string | null; until: number } | null = null;
  const cronAuth = async (header: string | undefined) => {
    const secret = deps.cron?.secret;
    const auth = header ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token && secret && sameSecret(token, secret)) return null;
    if (token && deps.cron?.schedulerKeyHash) {
      if (!keyCache || keyCache.until < Date.now()) {
        const hash = await deps.cron.schedulerKeyHash().catch(() => null);
        keyCache = { hash, until: Date.now() + 5 * 60_000 };
      }
      const given = createHash('sha256').update(token).digest('hex');
      if (keyCache.hash && /^[0-9a-f]{64}$/.test(keyCache.hash) && sameSecret(given, keyCache.hash)) return null;
    }
    if (!secret && !deps.cron?.schedulerKeyHash) {
      return { body: { error: 'CRON_SECRET no configurado' }, status: 503 as const };
    }
    return { body: { error: 'No autorizado' }, status: 401 as const };
  };

  // Recordatorios de convocatorias (lo llama el mismo workflow programado).
  app.post('/api/cron/tick', async (c) => {
    const denied = await cronAuth(c.req.header('authorization'));
    if (denied) return c.json(denied.body, denied.status);
    const tick = deps.cron?.tick;
    if (!tick) return c.json({ status: 'omitida', message: 'Base de datos no configurada' });
    try {
      return c.json({ status: 'ok', ...(await tick()) });
    } catch (err) {
      deps.log?.error({ err }, 'Fallo en los recordatorios');
      return c.json({ status: 'error', message: 'Error interno' }, 500);
    }
  });

  /*
   * Captura de partidos de EA enviada por el puente. Protegida con su propia clave
   * (Authorization: Bearer <EA_BRIDGE_TOKEN>). Solo guarda; nunca devuelve datos.
   */
  app.post('/api/ingest/ea', async (c) => {
    const expected = deps.eaBridgeToken;
    if (!expected) return c.json({ error: 'Captura de EA no configurada' }, 503);
    const auth = c.req.header('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || !sameSecret(token, expected)) return c.json({ error: 'No autorizado' }, 401);
    if (!deps.repos) return c.json({ error: 'Base de datos no configurada' }, 503);
    const text = await c.req.text();
    if (text.length > 2_000_000) return c.json({ error: 'Demasiado grande' }, 413);
    let parsed;
    try {
      parsed = parseIngest(JSON.parse(text));
    } catch {
      return c.json({ error: 'Formato no válido' }, 400);
    }
    try {
      // Solo se guardan partidos de clubes de EA cuyo club de PIRLO dio su consentimiento.
      const first = parsed.matches[0];
      if (first && !(await deps.repos.ea.consented(first.platform, first.eaClubId))) {
        return c.json({ error: 'Club de EA sin consentimiento en PIRLO' }, 403);
      }
      const stored = await deps.repos.eaCapture.store(parsed.matches);
      return c.json({ received: parsed.matches.length, stored, rejected: parsed.rejected });
    } catch (err) {
      deps.log?.error({ err }, 'No se pudo guardar la captura de EA');
      return c.json({ error: 'Error interno' }, 500);
    }
  });

  app.post('/api/cron/sync', async (c) => {
    const denied = await cronAuth(c.req.header('authorization'));
    if (denied) return c.json(denied.body, denied.status);

    const sync = deps.cron?.sync;
    if (!sync) return c.json({ status: 'omitida', message: 'Proveedor no configurado' });
    try {
      const result = await sync();
      return c.json(result, result.status === 'error' ? 502 : 200);
    } catch (err) {
      // p. ej. otra sincronización en curso (CONFLICT) o base de datos no disponible.
      deps.log?.error({ err }, 'No se pudo iniciar la sincronización');
      if (isDomainError(err) && err.code === 'CONFLICT') {
        return c.json({ status: 'error', message: err.message }, 409);
      }
      return c.json({ status: 'error', message: 'Error interno' }, 500);
    }
  });

  return app;
}
