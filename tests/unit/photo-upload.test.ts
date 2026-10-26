import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { csrfFor, signSession, userSessionKey } from '../../src/web/panel.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';

const SECRET = 'secreto-de-prueba-0123456789';
const ORIGIN = 'https://pirlo-bot.vercel.app';
const NOW = 1_800_000_000_000;
const ADMIN = '800000000000000001';
const PLAYER = '800000000000000002';
const OTHER = '800000000000000003';

async function setup() {
  const env = createMemoryRepos();
  const { clubId } = await env.repos.clubs.register({
    guildId: '900000000000000001', guildName: null, slug: 'club-foto', name: 'Club Foto',
    adminDiscordId: ADMIN, adminDisplayName: 'Admin',
  });
  env.addMember(clubId, PLAYER, 'jugador');
  env.addMember(clubId, OTHER, 'jugador');
  const player = env.state.memberships.find((m) => m.clubId === clubId && m.discordUserId === PLAYER)!;
  const app = createApp({
    discordPublicKey: '0'.repeat(64),
    repos: env.repos,
    panel: { ownerIds: new Set(['800000000000000777']), clientId: '1562889315657195530', clientSecret: SECRET, origin: ORIGIN, now: () => NOW },
  });
  const sessionFor = (userId: string) => signSession(userSessionKey(SECRET), userId, NOW + 3600_000);
  return { env, app, player, clubId, sessionFor };
}

describe('subir la foto desde la web', () => {
  it('sin sesión pide iniciar sesión con Discord (vuelve a la misma página)', async () => {
    const { app, player } = await setup();
    const res = await app.request(`/club/club-foto/jugador/${player.playerId}/foto`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(html).toMatch(`/entrar?volver=${encodeURIComponent(`/club/club-foto/jugador/${player.playerId}/foto`)}`);
    const login = await app.request(`/entrar?volver=${encodeURIComponent(`/club/club-foto/jugador/${player.playerId}/foto`)}`);
    expect(login.status).toBe(302);
    expect(login.headers.get('location')).toMatch('https://discord.com/oauth2/authorize');
    // Un "volver" que no sea una ficha no se acepta (sin redirecciones abiertas).
    expect((await app.request('/entrar?volver=https%3A%2F%2Fevil.example')).headers.get('location')).toBe('/');
  });

  it('el propio jugador ve el formulario; otro jugador no; una sesión de usuario no abre el panel', async () => {
    const { app, player, sessionFor } = await setup();
    const own = await app.request(`/club/club-foto/jugador/${player.playerId}/foto`, {
      headers: { cookie: `pirlo_sesion=${sessionFor(PLAYER)}` },
    });
    const ownHtml = await own.text();
    expect(ownHtml).toMatch('enctype="multipart/form-data"');
    // Marco para encuadrar la tarjeta: script propio (mismo origen) y vista previa local (blob:).
    expect(ownHtml).toMatch('<script src="/foto.js" defer></script>');
    expect(ownHtml).toMatch('name="recorte_w"');
    expect(own.headers.get('content-security-policy')).toMatch("script-src 'self'");
    expect(own.headers.get('content-security-policy')).toMatch('blob:');
    const other = await app.request(`/club/club-foto/jugador/${player.playerId}/foto`, {
      headers: { cookie: `pirlo_sesion=${sessionFor(OTHER)}` },
    });
    expect(other.status).toBe(403);
    const panel = await app.request('/panel', { headers: { cookie: `pirlo_panel=${sessionFor('800000000000000777')}` } });
    expect(await panel.text()).toMatch('Iniciar sesión con Discord');
  });

  it('POST: exige sesión y CSRF; un admin del club también puede', async () => {
    const { app, player, sessionFor } = await setup();
    const url = `/club/club-foto/jugador/${player.playerId}/foto`;
    const form = (csrf: string) => {
      const f = new FormData();
      f.append('csrf', csrf);
      f.append('imagen', new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }));
      return f;
    };
    expect((await app.request(url, { method: 'POST', body: form('x') })).status).toBe(401);
    const token = sessionFor(ADMIN);
    const bad = await app.request(url, { method: 'POST', body: form('falso'), headers: { cookie: `pirlo_sesion=${token}` } });
    expect(bad.status).toBe(403);
    // Imagen inválida: vuelve al formulario con el error (la sesión y el CSRF sí eran válidos).
    const res = await app.request(url, {
      method: 'POST',
      body: form(csrfFor(userSessionKey(SECRET), token)),
      headers: { cookie: `pirlo_sesion=${token}`, origin: ORIGIN },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${url}?error=imagen`);
  });
});

describe('origen del formulario', () => {
  it('acepta el Origin «null» que envían los navegadores con no-referrer (lo protege el CSRF), rechaza otros orígenes', async () => {
    const { app, player, sessionFor } = await setup();
    const url = `/club/club-foto/jugador/${player.playerId}/foto`;
    const token = sessionFor(PLAYER);
    const body = () => {
      const f = new FormData();
      f.append('csrf', csrfFor(userSessionKey(SECRET), token));
      f.append('imagen', new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }));
      return f;
    };
    const ok = await app.request(url, { method: 'POST', body: body(), headers: { cookie: `pirlo_sesion=${token}`, origin: 'null' } });
    expect(ok.status).toBe(303);
    const evil = await app.request(url, { method: 'POST', body: body(), headers: { cookie: `pirlo_sesion=${token}`, origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
    const page = await app.request(url, { headers: { cookie: `pirlo_sesion=${token}` } });
    expect(page.headers.get('referrer-policy')).toBe('same-origin');
  });
});
