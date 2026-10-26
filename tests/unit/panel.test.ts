import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { csrfFor, readSession, signSession } from '../../src/web/panel.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';

// Valores de prueba (no son secretos reales).
const SECRET = 'secreto-de-prueba-0123456789';
const OWNER = '800000000000000777';
const OTHER = '800000000000000555';
const ORIGIN = 'https://pirlo-bot.vercel.app';
const NOW = 1_800_000_000_000;

function setup(discordUserId = OWNER) {
  const env = createMemoryRepos();
  const dms: string[] = [];
  const calls: string[] = [];
  const fakeFetch = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/oauth2/token'))
      return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    if (u.endsWith('/users/@me'))
      return new Response(JSON.stringify({ id: discordUserId }), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const app = createApp({
    discordPublicKey: '0'.repeat(64),
    repos: env.repos,
    panel: {
      ownerIds: new Set([OWNER]),
      clientId: '1562889315657195530',
      clientSecret: SECRET,
      origin: ORIGIN,
      api: {
        textChannels: async () => [],
        dm: async (id) => void dms.push(id),
        guildName: async (id) => (id === '900000000000000001' ? 'Servidor Real' : null),
      },
      fetch: fakeFetch,
      now: () => NOW,
    },
  });
  return { env, app, dms, calls };
}

const sessionCookie = (userId = OWNER) =>
  `pirlo_panel=${signSession(SECRET, userId, NOW + 3600_000)}`;

async function addPendingClub(env: ReturnType<typeof createMemoryRepos>) {
  const { clubId } = await env.repos.clubs.register({
    guildId: '900000000000000001',
    guildName: 'Servidor',
    slug: 'club-nuevo',
    name: 'Club <Nuevo>',
    adminDiscordId: '800000000000000009',
    adminDisplayName: 'Admin',
  });
  await env.repos.clubs.setStatus(clubId, 'pendiente', OWNER);
  return clubId;
}

describe('panel interno', () => {
  it('sesión firmada: caduca y no se puede falsificar', () => {
    const t = signSession(SECRET, OWNER, NOW + 1000);
    expect(readSession(SECRET, t, NOW)).toBe(OWNER);
    expect(readSession(SECRET, t, NOW + 2000)).toBeNull();
    expect(readSession('otro-secreto-0123456789', t, NOW)).toBeNull();
    expect(readSession(SECRET, t.replace(OWNER, OTHER), NOW)).toBeNull();
  });

  it('sin sesión muestra el inicio de sesión; nunca expone el secreto', async () => {
    const { app } = setup();
    const res = await app.request('/panel');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toMatch('Iniciar sesión con Discord');
    expect(html).not.toMatch(SECRET);
    expect(html).not.toMatch('<script');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toMatch("frame-ancestors 'none'");
  });

  it('OAuth: state obligatorio, solo el dueño entra', async () => {
    const { app } = setup();
    const login = await app.request('/panel/login');
    expect(login.status).toBe(302);
    const loc = new URL(login.headers.get('location')!);
    expect(loc.origin).toBe('https://discord.com');
    expect(loc.searchParams.get('scope')).toBe('identify');
    expect(loc.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/panel/callback`);
    const state = loc.searchParams.get('state')!;
    // Sin la cookie del state: rechazado.
    const bad = await app.request(`/panel/callback?code=abcdefghij12&state=${state}`);
    expect(bad.headers.get('location')).toBe('/panel?error=sesion');
    const good = await app.request(`/panel/callback?code=abcdefghij12&state=${state}`, {
      headers: { cookie: `pirlo_oauth_state=${state}` },
    });
    expect(good.status).toBe(303);
    expect(good.headers.get('location')).toBe('/panel');
    expect(good.headers.get('set-cookie')).toMatch(/pirlo_panel=v1\.800000000000000777\./);
    expect(good.headers.get('set-cookie')).toMatch('HttpOnly');
  });

  it('otra cuenta de Discord recibe 403', async () => {
    const { app } = setup(OTHER);
    const res = await app.request('/panel/callback?code=abcdefghij12&state=s1234567890', {
      headers: { cookie: 'pirlo_oauth_state=s1234567890' },
    });
    expect(res.status).toBe(403);
    // Y una sesión de otra cuenta no sirve aunque esté bien firmada.
    expect(
      await (await app.request('/panel', { headers: { cookie: sessionCookie(OTHER) } })).text(),
    ).toMatch('Iniciar sesión');
  });

  it('el dueño ve los clubes (HTML escapado) y aprueba con CSRF', async () => {
    const { app, env, dms } = setup();
    const clubId = await addPendingClub(env);
    const html = await (
      await app.request('/panel', { headers: { cookie: sessionCookie() } })
    ).text();
    expect(html).toMatch('Pendientes de aprobación');
    expect(html).toMatch('Club &lt;Nuevo&gt;');
    // El nombre del servidor se pide a Discord y se guarda.
    expect(html).toMatch('Servidor Real');
    expect(env.state.guildNames.get('900000000000000001')).toBe('Servidor Real');
    expect(html).toMatch(`/panel/clubs/${clubId}/estado`);

    const token = signSession(SECRET, OWNER, NOW + 3600_000);
    const post = (body: Record<string, string>, headers: Record<string, string> = {}) =>
      app.request(`/panel/clubs/${clubId}/estado`, {
        method: 'POST',
        body: new URLSearchParams(body),
        headers: {
          cookie: `pirlo_panel=${token}`,
          'content-type': 'application/x-www-form-urlencoded',
          ...headers,
        },
      });
    expect((await post({ estado: 'activo', csrf: 'falso' })).status).toBe(403);
    expect(
      (
        await post(
          { estado: 'activo', csrf: csrfFor(SECRET, token) },
          { origin: 'https://evil.example' },
        )
      ).status,
    ).toBe(403);
    expect(env.state.clubs[0]!.status).toBe('pendiente');
    const ok = await post({ estado: 'activo', csrf: csrfFor(SECRET, token) }, { origin: ORIGIN });
    expect(ok.status).toBe(303);
    expect(env.state.clubs[0]!.status).toBe('activo');
    expect(dms).toEqual(['800000000000000009']);
  });

  it('sin sesión no se puede cambiar nada', async () => {
    const { app, env } = setup();
    const clubId = await addPendingClub(env);
    const res = await app.request(`/panel/clubs/${clubId}/estado`, {
      method: 'POST',
      body: new URLSearchParams({ estado: 'activo', csrf: 'x' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.status).toBe(401);
    expect(env.state.clubs[0]!.status).toBe('pendiente');
  });
});
