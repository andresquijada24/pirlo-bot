import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { autoLinkAccounts, gamingAccounts } from '../../src/core/account-link.js';
import { signSession, userSessionKey } from '../../src/web/panel.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';

// Datos ficticios, solo para pruebas.
const SECRET = 'secreto-de-prueba-0123456789';
const ORIGIN = 'https://pirlo-bot.vercel.app';
const NOW = 1_800_000_000_000;
const ME = '800000000000000010';
const RIVAL = '800000000000000011';

const statRow = (clubId: string, name: string) => ({
  clubId,
  seasonId: null,
  playerId: null,
  source: 'maritimo',
  sourcePlayerId: `gt:${name.toLowerCase()}`,
  name,
  sessions: 1,
  matchesPlayed: 3,
  goals: 2,
  assists: 1,
  shots: null,
  dribbles: null,
  passesMade: null,
  passesAttempted: null,
  tacklesMade: null,
  tacklesAttempted: null,
  interceptions: null,
  blocks: null,
  clearances: null,
  saves: null,
  cleanSheets: null,
  ratingPoints: null,
  ratedMatches: null,
});

async function setup(connections: unknown = []) {
  const env = createMemoryRepos();
  const club = async (slug: string, name: string, n: number) =>
    (
      await env.repos.clubs.register({
        guildId: `90000000000000000${n}`,
        guildName: null,
        slug,
        name,
        adminDiscordId: '800000000000000001',
        adminDisplayName: 'Admin',
      })
    ).clubId;
  const a = await club('club-uno', 'Club Uno', 1);
  const b = await club('club-dos', 'Club Dos', 2);
  const c = await club('club-tres', 'Club Tres', 3);
  env.addMember(a, ME, 'jugador');
  env.addMember(b, ME, 'jugador');
  env.state.sessionRows.push(statRow(a, 'AndresMoro'), statRow(c, 'AndresMoro'));
  const calls: string[] = [];
  const fakeFetch = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/oauth2/token'))
      return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    if (u.endsWith('/users/@me')) return new Response(JSON.stringify({ id: ME }), { status: 200 });
    if (u.endsWith('/users/@me/connections'))
      return new Response(JSON.stringify(connections), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const app = createApp({
    discordPublicKey: '0'.repeat(64),
    repos: env.repos,
    panel: {
      ownerIds: new Set(['800000000000000777']),
      clientId: '1562889315657195530',
      clientSecret: SECRET,
      origin: ORIGIN,
      fetch: fakeFetch,
      now: () => NOW,
    },
  });
  return { env, app, calls, clubs: { a, b, c } };
}

const PSN = { type: 'playstation', name: 'andresmoro', verified: true, id: '1', visibility: 1 };

describe('cuentas de juego conectadas en Discord', () => {
  it('solo cuentas de juego verificadas, sin repetidos', () => {
    expect(
      gamingAccounts([
        PSN,
        { type: 'xbox', name: 'NoVerificada', verified: false },
        { type: 'twitch', name: 'streamer', verified: true },
        { type: 'steam', name: 'ANDRESMORO', verified: true },
        { type: 'epicgames', name: 'Revocada', verified: true, revoked: true },
        { type: 'xbox', name: 'Pirlo Xbox', verified: true },
      ]),
    ).toEqual([
      { platform: 'playstation', name: 'andresmoro' },
      { platform: 'xbox', name: 'Pirlo Xbox' },
    ]);
    expect(gamingAccounts({ nope: true })).toEqual([]);
  });
});

describe('vinculación automática del gamertag', () => {
  it('vincula en sus clubes si el club conoce el nombre; no toca otros clubes ni cambia uno ya puesto', async () => {
    const { env, clubs } = await setup();
    const res = await autoLinkAccounts(env.repos, ME, [
      { platform: 'playstation', name: 'andresmoro' },
    ]);
    const by = Object.fromEntries(res.map((r) => [r.membership.clubSlug, r.outcome.status]));
    expect(by).toEqual({ 'club-uno': 'vinculado', 'club-dos': 'sin_coincidencia' });
    const me = env.state.memberships.find((m) => m.clubId === clubs.a && m.discordUserId === ME)!;
    expect(env.state.memberGamertags.get(`${clubs.a}:${me.playerId}`)).toBe('andresmoro');
    // Sus estadísticas pasan a su ficha.
    expect(env.state.sessionRows.find((r) => r.clubId === clubs.a)!.playerId).toBe(me.playerId);
    // Club Tres: no está en la plantilla → nada.
    expect(env.state.sessionRows.find((r) => r.clubId === clubs.c)!.playerId).toBeNull();
    // Segunda vez: ya lo tiene, no se cambia aunque traiga otro nombre.
    const again = await autoLinkAccounts(env.repos, ME, [{ platform: 'xbox', name: 'OtroNombre' }]);
    expect(again.find((r) => r.membership.clubSlug === 'club-uno')!.outcome).toEqual({
      status: 'ya_tenia',
      gamertag: 'andresmoro',
    });
  });

  it('si el gamertag ya es de otro jugador, no se lo quita', async () => {
    const { env, clubs } = await setup();
    const rival = env.addMember(clubs.a, RIVAL, 'jugador');
    env.state.externalPlayers.push({
      clubId: clubs.a,
      gamertag: 'andresmoro',
      playerId: rival.playerId,
    });
    const res = await autoLinkAccounts(env.repos, ME, [
      { platform: 'playstation', name: 'andresmoro' },
    ]);
    expect(res.find((r) => r.membership.clubSlug === 'club-uno')!.outcome).toEqual({
      status: 'ocupado',
      gamertag: 'andresmoro',
    });
  });
});

describe('Mi cuenta', () => {
  it('sin sesión explica cómo y pide entrar con Discord con permiso de conexiones', async () => {
    const { app } = await setup();
    const html = await (await app.request('/mi-cuenta')).text();
    expect(html).toMatch('Ajustes → Conexiones');
    expect(html).toMatch('/entrar?volver=%2Fmi-cuenta');
    const login = await app.request('/entrar?volver=%2Fmi-cuenta');
    const loc = new URL(login.headers.get('location')!);
    expect(loc.searchParams.get('scope')).toBe('identify connections');
    // Subir la foto sigue pidiendo solo «identify».
    const foto = await app.request(
      '/entrar?volver=%2Fclub%2Fclub-uno%2Fjugador%2F00000000-0000-4000-8000-000000000001%2Ffoto',
    );
    expect(new URL(foto.headers.get('location')!).searchParams.get('scope')).toBe('identify');
  });

  it('al entrar vincula solo y muestra el gamertag con el enlace a su ficha', async () => {
    const { app, env, calls } = await setup([PSN]);
    const cb = await app.request('/panel/callback?code=abcdefghij12&state=s1234567890', {
      headers: {
        cookie: `pirlo_oauth_state=s1234567890; pirlo_volver=${encodeURIComponent('/mi-cuenta')}`,
      },
    });
    expect(cb.status).toBe(303);
    expect(cb.headers.get('location')).toBe('/mi-cuenta');
    const setCookie = cb.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/pirlo_sesion=v1\.800000000000000010\.[^;]+; Path=\/;/);
    expect(setCookie).toMatch('pirlo_cuentas=');
    expect(calls).toContain('https://discord.com/api/v10/users/@me/connections');
    const seen = /pirlo_cuentas=([^;]+)/.exec(setCookie)![1];
    const session = signSession(userSessionKey(SECRET), ME, NOW + 3600_000);
    const html = await (
      await app.request('/mi-cuenta', {
        headers: { cookie: `pirlo_sesion=${session}; pirlo_cuentas=${seen}` },
      })
    ).text();
    expect(html).toMatch('PlayStation · andresmoro');
    expect(html).toMatch('Gamertag: <b>andresmoro</b>');
    expect(html).toMatch('Club Dos');
    expect(html).toMatch(/href="\/club\/club-uno\/jugador\/[0-9a-f-]{36}">Ver mi ficha/);
    expect(env.state.memberGamertags.size).toBe(1);
  });

  it('sin cuentas conectadas lo explica', async () => {
    const { app } = await setup([]);
    const session = signSession(userSessionKey(SECRET), ME, NOW + 3600_000);
    const empty = Buffer.from('[]').toString('base64url');
    const html = await (
      await app.request('/mi-cuenta', {
        headers: { cookie: `pirlo_sesion=${session}; pirlo_cuentas=${empty}` },
      })
    ).text();
    expect(html).toMatch('no tiene ninguna cuenta de PlayStation, Xbox, Steam o Epic');
  });
});
