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
  it('se publica por defecto; solo un admin la retira o la vuelve a publicar', async () => {
    const { app, run } = await setup();
    expect((await app.request('/club/club-prueba')).status).toBe(200);
    expect(textOf(await run(slash(DT, 'club', 'web', [{ name: 'activar', type: 5, value: false }])))).toMatch('Solo un admin');
    expect((await app.request('/club/club-prueba')).status).toBe(200);
    await run(slash(OWNER, 'club', 'web', [{ name: 'activar', type: 5, value: false }]));
    expect((await app.request('/club/club-prueba')).status).toBe(404);
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
    expect(html).not.toMatch('<script>'); // solo el aviso de actualización (/update.js)
    expect(res.headers.get('content-security-policy')).toMatch("default-src 'none'");
    // Navegación: volver al directorio y casita al menú principal.
    expect(html).toMatch('href="/clubes"');
    expect(html).toMatch('class="navbtn home" href="/"');
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
    await env.repos.clubs.setWebPublic(clubId, false, OWNER.userId);
    let html = await (await app.request('/clubes')).text();
    expect(html).toMatch('Todavía ningún club');
    await env.repos.clubs.setWebPublic(clubId, true, OWNER.userId);
    const res = await app.request('/clubes');
    html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toMatch('href="/club/club-prueba"');
    expect(html).toMatch('Club &lt;Prueba&gt;');
    expect(res.headers.get('content-security-policy')).toMatch("default-src 'none'");
    expect(html).toMatch('class="navbtn home" href="/"');
    expect(await (await app.request('/club/no-existe')).text()).toMatch('class="navbtn home" href="/"');
  });

  it('goleadores reales para la página principal: solo clubes públicos, sin rivales', async () => {
    const { app, env, clubId } = await setup();
    await env.repos.clubs.setWebPublic(clubId, false, OWNER.userId);
    let res = await app.request('/widget/goleadores');
    expect(await res.text()).toMatch('Todavía no hay goles');
    await env.repos.clubs.setWebPublic(clubId, true, OWNER.userId);
    res = await app.request('/widget/goleadores');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toMatch('JugadorFicticio');
    expect(html).toMatch('href="/club/club-prueba" target="_top"');
    expect(html).toMatch('<span class="g">2</span>');
    expect(html).not.toMatch('GamertagRival');
    expect(html).not.toMatch('<script');
    expect(res.headers.get('content-security-policy')).toMatch("frame-ancestors 'self'");
  });

  it('la página principal enlaza el directorio y muestra el ranking real', async () => {
    const { readFileSync } = await import('node:fs');
    const landing = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
    expect(landing).toMatch('href="/clubes"');
    expect(landing).toMatch('src="/widget/goleadores"');
    expect(landing).not.toMatch('Vista ilustrativa');
  });
});

describe('sitio web del club', () => {
  it('solo un admin lo guarda; solo https; se ve en la página pública', async () => {
    const { app, env, run, clubId } = await setup();
    await env.repos.clubs.setWebPublic(clubId, true, OWNER.userId);
    const dt = textOf(await run(slash(DT, 'club', 'sitio', [str('url', 'https://www.maritimo.app')])));
    expect(dt).toMatch('Solo un admin');
    const bad = textOf(await run(slash(OWNER, 'club', 'sitio', [str('url', 'javascript:alert(1)')])));
    expect(bad).toMatch('https://');
    const okMsg = textOf(await run(slash(OWNER, 'club', 'sitio', [str('url', 'https://www.maritimo.app')])));
    expect(okMsg).toMatch('https://www.maritimo.app');
    const html = await (await app.request('/club/club-prueba')).text();
    expect(html).toMatch('href="https://www.maritimo.app" rel="noopener noreferrer nofollow" target="_blank"');
    expect(html).toMatch('www.maritimo.app<svg');
    await run(slash(OWNER, 'club', 'sitio', [{ name: 'quitar', type: 5, value: true }]));
    expect(await (await app.request('/club/club-prueba')).text()).not.toMatch('maritimo.app');
  });
});

describe('estadísticas detalladas de la plantilla', () => {
  it('efectividad, pases y entradas con aciertos y errados; totales del equipo; sin inventar datos', async () => {
    const { ratio, missed, teamTotals } = await import('../../src/web/club-page.js');
    expect(ratio(3, 12)).toBe(25);
    expect(ratio(3, 0)).toBeNull();
    expect(ratio(null, 10)).toBeNull();
    expect(missed(74, 100)).toBe(26);
    expect(missed(null, 100)).toBeNull();
    const base = {
      key: 'k',
      playerId: null,
      linked: false,
      sessions: 1,
      goalContributions: null,
      dribbles: null,
      passPct: null,
      tacklePct: null,
      interceptions: null,
      blocks: null,
      clearances: null,
      saves: null,
    };
    const t = teamTotals([
      {
        ...base,
        name: 'A',
        matchesPlayed: 5,
        goals: 4,
        assists: 1,
        shots: 10,
        passesMade: 40,
        passesAttempted: 50,
        tacklesMade: 3,
        tacklesAttempted: 6,
        avgRating: 8,
        ratedMatches: 5,
        cleanSheets: null,
      },
      {
        ...base,
        name: 'B',
        matchesPlayed: 3,
        goals: 1,
        assists: null,
        shots: null,
        passesMade: 20,
        passesAttempted: 25,
        tacklesMade: null,
        tacklesAttempted: null,
        avgRating: 6,
        ratedMatches: 3,
        cleanSheets: null,
      },
    ]);
    expect(t).toEqual({
      matchesPlayed: 5,
      goals: 5,
      assists: 1,
      shots: 10,
      passesMade: 60,
      passesAttempted: 75,
      tacklesMade: 3,
      tacklesAttempted: 6,
      interceptions: null,
      blocks: null,
      clearances: null,
      saves: null,
      cleanSheets: null,
      avgRating: 7.25,
    });
  });

  it('la página muestra las columnas nuevas y la fila de totales', async () => {
    const { app } = await setup();
    const html = await (await app.request('/club/club-prueba')).text();
    expect(html).toMatch('title="Goles ÷ tiros">Acierto de tiro</a>');
    expect(html).toMatch('Pases errados</a></th>');
    expect(html).toMatch('<td>Total del equipo</td>');
    expect(html).toMatch('Paradas</a></th>');
    for (const top of ['Top goleador', 'Top asistidor', 'Top defensa', 'Top portero', 'Mejor calificación']) expect(html).toMatch(top);
  });

  it('acciones defensivas: suma solo lo que da la fuente', async () => {
    const { defensiveActions } = await import('../../src/core/stats/service.js');
    const t = { tacklesMade: 5, interceptions: null, blocks: 2, clearances: null } as never;
    expect(defensiveActions(t)).toBe(7);
    expect(defensiveActions({ tacklesMade: null, interceptions: null, blocks: null, clearances: null } as never)).toBeNull();
  });
});

describe('ficha individual del jugador', () => {
  it('el nombre enlaza a su ficha con temporada, carrera y partidos; los rivales no tienen ficha', async () => {
    const { app } = await setup();
    const club = await (await app.request('/club/club-prueba')).text();
    expect(club).toMatch('href="/club/club-prueba/jugador/ea%3A1"');
    const res = await app.request('/club/club-prueba/jugador/ea%3A1');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch('<h1>JugadorFicticio</h1>');
    expect(html).toMatch('Carrera en Club &lt;Prueba&gt;');
    expect(html).toMatch('Rival Ficticio');
    expect(html).toMatch('Volver a Club &lt;Prueba&gt;');
    expect(html).not.toMatch('<script>');
    expect((await app.request('/club/club-prueba/jugador/ea%3A2')).status).toBe(404);
    expect((await app.request('/club/club-prueba/jugador/%3Cscript%3E')).status).toBe(404);
  });
});

describe('foto del jugador (The Grounds)', () => {
  it('sin imagen muestra el instructivo; el jugador sube su foto y aparece en su ficha', async () => {
    const { app, env, run, clubId } = await setup();
    const guide = await run(slash(DT, 'plantilla', 'foto', []));
    expect(JSON.stringify(guide)).toMatch('The Grounds');
    const dt = env.state.memberships.find((m) => m.clubId === clubId && m.discordUserId === DT.userId)!;
    await env.repos.memberships.setPhoto(clubId, dt.id, 'QUJD', DT.userId);
    expect(await env.repos.memberships.photo(clubId, dt.playerId)).toBe('QUJD');
    const img = await app.request(`/club/club-prueba/jugador/${dt.playerId}/foto.jpg`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    // Al cambiar la foto se ve al momento: el navegador revalida (no-cache) con su ETag.
    expect(img.headers.get('cache-control')).toBe('no-cache');
    const etag = img.headers.get('etag')!;
    const url = `/club/club-prueba/jugador/${dt.playerId}/foto.jpg`;
    expect((await app.request(url, { headers: { 'if-none-match': etag } })).status).toBe(304);
    await env.repos.memberships.setPhoto(clubId, dt.id, 'REVG', DT.userId);
    const changed = await app.request(url, { headers: { 'if-none-match': etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
    expect((await app.request('/club/club-prueba/jugador/no-es-uuid/foto.jpg')).status).toBe(404);
    // Otro jugador no puede cambiar la foto ajena.
    await expect(env.repos.memberships.setPhoto(clubId, dt.id, null, '800000000000000999')).rejects.toThrow();
  });

  it('la ficha de un gamertag sin vincular explica cómo vincularse para tener foto', async () => {
    const { app } = await setup();
    const html = await (await app.request('/club/club-prueba/jugador/ea%3A1')).text();
    expect(html).toMatch('¿Eres JugadorFicticio? Pon tu foto de The Grounds');
    expect(html).toMatch('/vincular');
  });
});

describe('pestañas por tipo de partido', () => {
  it('Todos, Liga, Copa y Amistosos filtran partidos y estadísticas; la ficha conserva la pestaña', async () => {
    const { app } = await setup();
    const todos = await (await app.request('/club/club-prueba')).text();
    expect(todos).toMatch('aria-current="page" class="tab on">Todos <small>1</small>');
    expect(todos).toMatch('href="/club/club-prueba?tipo=amistosos" class="tab">Amistosos <small>0</small>');
    const liga = await (await app.request('/club/club-prueba?tipo=liga')).text();
    expect(liga).toMatch('Rival Ficticio');
    expect(liga).toMatch('href="/club/club-prueba/jugador/ea%3A1?tipo=liga"');
    const amistosos = await (await app.request('/club/club-prueba?tipo=amistosos')).text();
    expect(amistosos).toMatch('Todavía no hay partidos.');
    expect(amistosos).not.toMatch('JugadorFicticio');
    const raro = await (await app.request('/club/club-prueba?tipo=%3Cscript%3E')).text();
    expect(raro).toMatch('aria-current="page" class="tab on">Todos');
    const ficha = await app.request('/club/club-prueba/jugador/ea%3A1?tipo=liga');
    expect(ficha.status).toBe(200);
    expect(await ficha.text()).toMatch('aria-current="page" class="tab on">Liga');
  });
});

describe('clubes por sesión (Marítimo): pestañas por su calendario', () => {
  it('los partidos del calendario cuentan por tipo; las sesiones sin tipo solo en Todos', async () => {
    const { app, env, clubId, run } = await setup();
    const row = (sourcePlayerId: string, name: string, goals: number, matchType: string | null) => ({
      clubId, matchType, seasonId: null, playerId: null, source: 'maritimo', sourcePlayerId, name,
      sessions: 1, matchesPlayed: 2, goals, assists: null, shots: null, dribbles: null, passesMade: null,
      passesAttempted: null, tacklesMade: null, tacklesAttempted: null, interceptions: null, blocks: null,
      clearances: null, saves: null, cleanSheets: null, ratingPoints: null, ratedMatches: null,
    });
    env.state.sessionRows.push(row('m1', 'Amistoso Jugador', 4, 'friendlyMatch'), row('m2', 'Mezcla Jugador', 1, null));
    const match = (externalId: string, competition: 'amistoso' | 'torneo', goalsFor: number | null, state = 'finalizado') => ({
      clubId, source: 'maritimo' as const, externalId, competition, name: null, opponent: 'Rival Calendario',
      startsAt: '2026-10-25T23:00:00Z', state, goalsFor, goalsAgainst: goalsFor === null ? null : 1,
      updatedAt: '2026-10-26T00:00:00Z',
    });
    env.state.providerMatches.push(match('p1', 'amistoso', 3), match('p2', 'torneo', 0), match('p3', 'amistoso', null, 'abierto'));

    const todos = await (await app.request('/club/club-prueba')).text();
    // 1 de EA + 2 jugados del calendario (el que no tiene marcador no cuenta).
    expect(todos).toMatch('aria-current="page" class="tab on">Todos <small>3</small>');
    expect(todos).toMatch('Mezcla Jugador');
    const amistosos = await (await app.request('/club/club-prueba?tipo=amistosos')).text();
    expect(amistosos).toMatch('Rival Calendario');
    expect(amistosos).toMatch('Amistoso Jugador');
    expect(amistosos).not.toMatch('Mezcla Jugador');
    const copa = await (await app.request('/club/club-prueba?tipo=copa')).text();
    expect(copa).toMatch('class="tab on">Copa <small>1</small>');

    // Y en Discord: /ranking y /stats con tipo.
    const rk = await run(slash(OWNER, 'ranking', null, [str('estadistica', 'goles'), str('tipo', 'amistosos'), str('temporada', 'todas')]));
    const desc = JSON.stringify(rk);
    expect(desc).toMatch('Amistoso Jugador');
    expect(desc).not.toMatch('Mezcla Jugador');
    expect(desc).toMatch('Amistosos');
  });
});

describe('tabla de la plantilla ordenable y con búsqueda', () => {
  it('ordenar por columna con un clic, invertir, buscar por nombre; sin abreviaturas', async () => {
    const { applyView, parseView } = await import('../../src/web/club-page.js');
    const mk = (name: string, goals: number | null, rating: number | null) =>
      ({ name, goals, avgRating: rating, assists: null }) as never;
    const list = [mk('Beto', 3, 7.1), mk('Ana', 5, null), mk('Ñandú', null, 8)];
    expect(applyView(list, parseView({ orden: 'goles' })).map((p: { name: string }) => p.name)).toEqual(['Ana', 'Beto', 'Ñandú']);
    expect(applyView(list, parseView({ orden: 'goles', dir: 'asc' })).map((p: { name: string }) => p.name)).toEqual(['Beto', 'Ana', 'Ñandú']);
    expect(applyView(list, parseView({ orden: 'calificacion' })).map((p: { name: string }) => p.name)).toEqual(['Ñandú', 'Beto', 'Ana']);
    expect(applyView(list, parseView({ buscar: 'nandu' })).map((p: { name: string }) => p.name)).toEqual(['Ñandú']);
    expect(parseView({ orden: '<script>', dir: 'x' })).toEqual({ sort: 'goles', dir: 'desc', search: '' });

    const { app } = await setup();
    const html = await (await app.request('/club/club-prueba?orden=asistencias&dir=desc&tipo=liga')).text();
    expect(html).toMatch('class="on" aria-sort="descending"><a href="/club/club-prueba?tipo=liga&amp;orden=asistencias&amp;dir=asc#plantilla"'.replace(/&amp;/g, '&'));
    for (const t of ['Partidos jugados', 'Acierto de pase', 'Acciones defensivas', 'Porterías a cero', 'Calificación']) {
      expect(html).toMatch(`>${t}`);
    }
    expect(html).not.toMatch('>PJ<');
    expect(html).toMatch('name="buscar"');
    const none = await (await app.request('/club/club-prueba?buscar=zzz')).text();
    expect(none).toMatch('Ningún jugador coincide');
  });
});
