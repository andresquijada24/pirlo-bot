import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';
import { slash, textOf } from '../helpers/interactions.js';
import { createTestSigner } from '../helpers/keys.js';

async function setup() {
  const signer = await createTestSigner();
  const app = createApp({ discordPublicKey: signer.publicKey, repos: createMemoryRepos().repos });
  async function post(payload: unknown, opts: { tamper?: boolean; noSignature?: boolean } = {}) {
    const body = JSON.stringify(payload);
    const { signature, timestamp } = await signer.sign(body);
    return app.request('/api/interactions', {
      method: 'POST',
      body: opts.tamper ? body + ' ' : body,
      headers: {
        'content-type': 'application/json',
        ...(opts.noSignature ? {} : { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp }),
      },
    });
  }
  return { app, post };
}

const someone = { userId: '800000000000000001' };

describe('POST /api/interactions', () => {
  it('responde PONG a un PING firmado', async () => {
    const { post } = await setup();
    const res = await post({ type: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it('devuelve 401 si la firma no coincide', async () => {
    const { post } = await setup();
    expect((await post({ type: 1 }, { tamper: true })).status).toBe(401);
  });

  it('devuelve 401 si falta la firma', async () => {
    const { post } = await setup();
    expect((await post({ type: 1 }, { noSignature: true })).status).toBe(401);
  });

  it('ejecuta /pirlo ayuda con respuesta efímera', async () => {
    const { post } = await setup();
    const json = (await (await post(slash(someone, 'pirlo', 'ayuda'))).json()) as {
      type: number;
      data: { flags: number };
    };
    expect(json.type).toBe(4);
    expect(json.data.flags).toBe(64);
    expect(textOf(json)).toMatch('PIRLO BOT');
  });

  it('responde de forma controlada a un comando desconocido', async () => {
    const { post } = await setup();
    const json = await (await post(slash(someone, 'no-existe', null))).json();
    expect(textOf(json)).toMatch('Comando desconocido.');
  });

  it('ejecuta un comando con base de datos de punta a punta', async () => {
    const { post } = await setup();
    const json = await (await post(slash(someone, 'club', 'info'))).json();
    expect(textOf(json)).toMatch('no tiene ningún club');
  });
});

describe('GET /api/health', () => {
  it('responde ok', async () => {
    const { app } = await setup();
    const res = await app.request('/api/health');
    expect(await res.json()).toEqual({ ok: true, service: 'pirlo-bot' });
  });
});

describe('POST /api/cron/sync', () => {
  const SECRET = 'secreto-de-prueba-largo';
  const make = (cron: Parameters<typeof createApp>[0]['cron']) =>
    createApp({ discordPublicKey: '0'.repeat(64), repos: null, ...(cron ? { cron } : {}) });
  const call = (app: ReturnType<typeof make>, token?: string) =>
    app.request('/api/cron/sync', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('sin CRON_SECRET configurado responde 503', async () => {
    expect((await call(make(undefined), SECRET)).status).toBe(503);
  });

  it('sin token o con token incorrecto responde 401 y no sincroniza', async () => {
    let calls = 0;
    const app = make({ secret: SECRET, sync: async () => (calls++, { status: 'ok' }) });
    expect((await call(app)).status).toBe(401);
    expect((await call(app, 'otro')).status).toBe(401);
    expect(calls).toBe(0);
  });

  it('con el token correcto ejecuta la sincronización', async () => {
    const app = make({ secret: SECRET, sync: async () => ({ status: 'ok', inserted: 2 }) });
    const res = await call(app, SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', inserted: 2 });
  });

  it('sin proveedor configurado responde que se omite', async () => {
    const res = await call(make({ secret: SECRET, sync: null }), SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'omitida' });
  });

  it('si la sincronización falla responde 502 con el mensaje seguro', async () => {
    const app = make({ secret: SECRET, sync: async () => ({ status: 'error', message: 'Clave rechazada' }) });
    expect((await call(app, SECRET)).status).toBe(502);
  });
});

describe('programador de Supabase', () => {
  it('acepta su clave (comparada por la huella guardada) en sync y tick; rechaza otras', async () => {
    const { createHash } = await import('node:crypto');
    const KEY = 'clave-del-programador-de-prueba-0123456789';
    const hash = createHash('sha256').update(KEY).digest('hex');
    let syncs = 0;
    const app = createApp({
      discordPublicKey: '0'.repeat(64),
      repos: null,
      cron: {
        secret: undefined,
        schedulerKeyHash: async () => hash,
        sync: async () => (syncs++, { status: 'ok' }),
        tick: async () => ({ sent: 0, skipped: 0, failed: 0 }),
      },
    });
    const call = (path: string, token?: string) =>
      app.request(path, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });
    expect((await call('/api/cron/sync', KEY)).status).toBe(200);
    expect((await call('/api/cron/tick', KEY)).status).toBe(200);
    expect((await call('/api/cron/sync', 'otra-clave')).status).toBe(401);
    // La huella en sí no sirve como clave.
    expect((await call('/api/cron/sync', hash)).status).toBe(401);
    expect((await call('/api/cron/sync')).status).toBe(401);
    expect(syncs).toBe(1);
  });
});

describe('POST /api/cron/tick', () => {
  const SECRET = 'secreto-de-prueba-largo';
  const make = (tick: (() => Promise<{ sent: number; skipped: number; failed: number }>) | null) =>
    createApp({ discordPublicKey: '0'.repeat(64), repos: null, cron: { secret: SECRET, sync: null, tick } });
  const call = (app: ReturnType<typeof make>, token?: string) =>
    app.request('/api/cron/tick', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('exige el CRON_SECRET', async () => {
    let calls = 0;
    const app = make(async () => (calls++, { sent: 0, skipped: 0, failed: 0 }));
    expect((await call(app)).status).toBe(401);
    expect((await call(app, 'otro')).status).toBe(401);
    expect(calls).toBe(0);
  });

  it('devuelve los conteos de recordatorios', async () => {
    const res = await call(make(async () => ({ sent: 2, skipped: 1, failed: 0 })), SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', sent: 2, skipped: 1, failed: 0 });
  });
});

describe('POST /api/ingest/ea', () => {
  const TOKEN = 'clave-del-puente-ficticia-de-32-caracteres';
  const body = JSON.stringify({
    platform: 'common-gen5',
    eaClubId: '111',
    matchType: 'leagueMatch',
    matches: [{ matchId: '900001', timestamp: 1792894060, clubs: { '111': {}, '222': {} } }],
  });
  const call = (app: ReturnType<typeof createApp>, token?: string, payload = body) =>
    app.request('/api/ingest/ea', {
      method: 'POST',
      body: payload,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('sin clave configurada responde 503; con clave incorrecta, 401', async () => {
    const repos = createMemoryRepos().repos;
    expect((await call(createApp({ discordPublicKey: '0'.repeat(64), repos }), TOKEN)).status).toBe(503);
    const app = createApp({ discordPublicKey: '0'.repeat(64), repos, eaBridgeToken: TOKEN });
    expect((await call(app)).status).toBe(401);
    expect((await call(app, 'otra')).status).toBe(401);
  });

  it('sin el consentimiento de un club de PIRLO no guarda nada', async () => {
    const env = createMemoryRepos();
    const app = createApp({ discordPublicKey: '0'.repeat(64), repos: env.repos, eaBridgeToken: TOKEN });
    expect((await call(app, TOKEN)).status).toBe(403);
    expect(env.state.eaCache.size).toBe(0);
  });

  it('guarda una vez y no duplica', async () => {
    const env = createMemoryRepos();
    const club = await env.repos.clubs.register({
      guildId: '900000000000000001',
      guildName: null,
      slug: 'club-ea',
      name: 'Club EA',
      adminDiscordId: '800000000000000001',
      adminDisplayName: 'Admin',
    });
    await env.repos.ea.link(club.clubId, 'common-gen5', '111', '800000000000000001');
    const app = createApp({ discordPublicKey: '0'.repeat(64), repos: env.repos, eaBridgeToken: TOKEN });
    expect(await (await call(app, TOKEN)).json()).toEqual({ received: 1, stored: 1, rejected: 0 });
    expect(await (await call(app, TOKEN)).json()).toEqual({ received: 1, stored: 0, rejected: 0 });
    expect((await call(app, TOKEN, '{"no":"vale"}')).status).toBe(400);
  });
});
