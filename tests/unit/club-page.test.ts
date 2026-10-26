import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { commandsByName, componentHandlers } from '../../src/discord/commands/index.js';
import { routeInteraction } from '../../src/discord/router.js';
import { runEaProcessing } from '../../src/jobs/ea-processing.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';
import { MANAGE_GUILD, slash, str, textOf } from '../helpers/interactions.js';

// Datos ficticios, solo para pruebas.
const OWNER = { userId: '800000000000000001', name: 'Dueño', permissions: MANAGE_GUILD };
const DT = { userId: '800000000000000002', name: 'Entrenador' };

async function setup() {
  const env = createMemoryRepos();
  const run = (i: Parameters<typeof routeInteraction>[0]) =>
    routeInteraction(i, { commands: commandsByName, components: componentHandlers, repos: env.repos });
  await run(slash(OWNER, 'club', 'registrar', [str('nombre', 'Club <Prueba>'), str('identificador', 'club-prueba')]));
  const clubId = env.state.clubs[0]!.id;
  env.addMember(clubId, DT.userId, 'dt');
  await env.repos.ea.link(clubId, 'common-gen5', '111', OWNER.userId);
  await env.repos.eaCapture.store([
    {
      platform: 'common-gen5',
      eaClubId: '111',
      matchId: '900001',
      matchType: 'leagueMatch',
      playedAt: '2026-10-25T02:07:40.000Z',
      payload: {
        clubs: {
          '111': { goals: '3' },
          '222': { goals: '1', details: { name: 'Rival Ficticio', customKit: { kitColor1: '14356498', kitColor2: '15921906' } } },
        },
        players: {
          '111': { '1': { playername: 'JugadorFicticio', goals: '2', assists: '1', rating: '8.0' } },
          '222': { '2': { playername: 'GamertagRival', goals: '1', rating: '6.0' } },
        },
      },
    },
  ]);
  await runEaProcessing({ repos: env.repos });
  const app = createApp({ discordPublicKey: '0'.repeat(64), repos: env.repos });
  return { env, run, clubId, app };
}

describe('página web del club', () => {
  it('no existe hasta que un admin la activa', async () => {
    const { app, run } = await setup();
    expect((await app.request('/club/club-prueba')).status).toBe(404);
    expect(textOf(await run(slash(DT, 'club', 'web', [{ name: 'activar', type: 5, value: true }])))).toMatch('Solo un admin');
    const ok = textOf(await run(slash(OWNER, 'club', 'web', [{ name: 'activar', type: 5, value: true }])));
    expect(ok).toMatch('https://pirlo-bot.vercel.app/club/club-prueba');
    expect((await app.request('/club/club-prueba')).status).toBe(200);
    await run(slash(OWNER, 'club', 'web', [{ name: 'activar', type: 5, value: false }]));
    expect((await app.request('/club/club-prueba')).status).toBe(404);
  });

  it('muestra resultados, líderes y plantilla; nunca gamertags rivales; escapa el HTML', async () => {
    const { app, env, clubId } = await setup();
    await env.repos.clubs.setWebPublic(clubId, true, OWNER.userId);
    const res = await app.request('/club/club-prueba');
    const html = await res.text();
    expect(html).toMatch('Club &lt;Prueba&gt;');
    expect(html).not.toMatch('Club <Prueba>');
    expect(html).toMatch('Rival Ficticio');
    expect(html).toMatch('3 – 1');
    expect(html).toMatch('JugadorFicticio');
    expect(html).toMatch('background:#db1012;border-color:#f2f2f2;color:#ffffff');
    expect(html).not.toMatch('GamertagRival');
    expect(html).not.toMatch('<script');
    expect(res.headers.get('content-security-policy')).toMatch("default-src 'none'");
  });

  it('escudo: 404 sin escudo; PNG si el club lo subió', async () => {
    const { app, env, clubId } = await setup();
    await env.repos.clubs.setWebPublic(clubId, true, OWNER.userId);
    expect((await app.request('/club/club-prueba/escudo.png')).status).toBe(404);
    await env.repos.clubs.setCrest(clubId, 'iVBORw0KGgo=', OWNER.userId);
    const res = await app.request('/club/club-prueba/escudo.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await (await app.request('/club/club-prueba')).text()).toMatch('/club/club-prueba/escudo.png');
  });

  it('identificadores raros no llegan a la base de datos', async () => {
    const { app } = await setup();
    for (const slug of ['..%2F..', 'a', '%3Cscript%3E']) {
      expect((await app.request(`/club/${slug}`)).status).toBe(404);
    }
  });
});

describe('directorio de clubes', () => {
  it('lista solo los clubes con la página publicada', async () => {
    const { app, env, clubId } = await setup();
    let html = await (await app.request('/clubes')).text();
    expect(html).toMatch('Todavía ningún club');
    await env.repos.clubs.setWebPublic(clubId, true, OWNER.userId);
    const res = await app.request('/clubes');
    html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toMatch('href="/club/club-prueba"');
    expect(html).toMatch('Club &lt;Prueba&gt;');
    expect(res.headers.get('content-security-policy')).toMatch("default-src 'none'");
  });

  it('la página principal enlaza el directorio', async () => {
    const { readFileSync } = await import('node:fs');
    const landing = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
    expect(landing).toMatch('href="/clubes"');
  });
});
