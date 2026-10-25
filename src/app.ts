import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { isDomainError } from './core/errors.js';
import { parseIngest } from './providers/ea/ingest.js';
import type { APIInteraction } from 'discord-api-types/v10';
import type { Repositories } from './db/repositories/types.js';
import { commandsByName, componentHandlers } from './discord/commands/index.js';
import type { ComponentHandler, SlashCommand } from './discord/commands/types.js';
import { routeInteraction } from './discord/router.js';
import { verifyDiscordRequest } from './discord/verify.js';
import type { SyncResult } from './sync/engine.js';
import type { ReminderResult } from './jobs/reminders.js';
import type { ChannelPoster } from './discord/poster.js';

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
  cron?: {
    secret: string | undefined;
    sync: (() => Promise<SyncResult>) | null;
    /** Recordatorios; null si no hay base de datos. */
    tick?: (() => Promise<ReminderResult>) | null;
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

  /*
   * Sincronización programada (la invoca el workflow "Sincronizar Marítimo").
   * Protegida con `Authorization: Bearer <CRON_SECRET>`. Nunca devuelve secretos ni datos de
   * jugadores: solo conteos y el estado.
   */
  /** null si la petición está autorizada; si no, la respuesta de error. */
  const cronAuth = (header: string | undefined) => {
    const secret = deps.cron?.secret;
    if (!secret) return { body: { error: 'CRON_SECRET no configurado' }, status: 503 as const };
    const auth = header ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || !sameSecret(token, secret)) return { body: { error: 'No autorizado' }, status: 401 as const };
    return null;
  };

  // Recordatorios de convocatorias (lo llama el mismo workflow programado).
  app.post('/api/cron/tick', async (c) => {
    const denied = cronAuth(c.req.header('authorization'));
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
      const stored = await deps.repos.eaCapture.store(parsed.matches);
      return c.json({ received: parsed.matches.length, stored, rejected: parsed.rejected });
    } catch (err) {
      deps.log?.error({ err }, 'No se pudo guardar la captura de EA');
      return c.json({ error: 'Error interno' }, 500);
    }
  });

  app.post('/api/cron/sync', async (c) => {
    const denied = cronAuth(c.req.header('authorization'));
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
