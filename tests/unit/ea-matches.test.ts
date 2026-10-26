import { beforeEach, describe, expect, it } from 'vitest';
import { commandsByName, componentHandlers } from '../../src/discord/commands/index.js';
import { routeInteraction, type RouterDeps } from '../../src/discord/router.js';
import { createDiscordDownloader } from '../../src/discord/download.js';
import { runEaProcessing } from '../../src/jobs/ea-processing.js';
import { eaColor, eaInt, eaRating, processEaMatch } from '../../src/providers/ea/matches.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';
import { MANAGE_GUILD, slash, str, textOf } from '../helpers/interactions.js';

// Partido con la forma de la API de EA (números como texto). Ids, nombres y gamertags ficticios.
const OURS = '111';
const RIVAL = '222';
const payload = (over: Record<string, unknown> = {}) => ({
  matchId: '900001',
  timestamp: 1792894060,
  clubs: {
    [OURS]: { goals: '3', goalsAgainst: '1', details: { name: 'Club Ficticio' } },
    [RIVAL]: { goals: '1', goalsAgainst: '3', details: { name: 'Rival Ficticio' } },
  },
  players: {
    [OURS]: {
      '1001': {
        playername: 'JugadorFicticio',
        pos: 'forward',
        goals: '2',
        assists: '1',
        shots: '5',
        passesmade: '20',
        passattempts: '25',
        tacklesmade: '1',
        tackleattempts: '3',
        rating: '8.40',
        mom: '1',
        redcards: '0',
        secondsPlayed: '5400',
      },
      '1002': { playername: 'SinDatos' },
    },
    [RIVAL]: { '2001': { playername: 'RivalFicticio', goals: '1', rating: '6.10', mom: '0' } },
  },
  ...over,
});
const cached = (over: Record<string, unknown> = {}, matchId = '900001') => ({
  platform: 'common-gen5' as const,
  eaClubId: OURS,
  matchId,
  matchType: 'leagueMatch' as const,
  playedAt: '2026-10-25T02:07:40.000Z',
  payload: payload(over),
});

describe('números de EA', () => {
  it('solo acepta enteros no negativos; lo demás es sin dato', () => {
    expect(eaInt('3')).toBe(3);
    expect(eaInt(0)).toBe(0);
    expect(eaInt('')).toBeNull();
    expect(eaInt('-1')).toBeNull();
    expect(eaInt('2.5')).toBeNull();
    expect(eaInt(undefined)).toBeNull();
    expect(eaRating('7.70')).toBe(7.7);
    expect(eaRating('11')).toBeNull();
    expect(eaRating('abc')).toBeNull();
  });
});

describe('processEaMatch', () => {
  it('saca marcador, rival y jugadores de ambos lados', () => {
    const m = processEaMatch(cached())!;
    expect(m).toMatchObject({
      goalsFor: 3,
      goalsAgainst: 1,
      result: 'victoria',
      opponentEaClubId: RIVAL,
      opponentName: 'Rival Ficticio',
    });
    const mine = m.players.find((p) => p.gamertag === 'JugadorFicticio')!;
    expect(mine).toMatchObject({
      side: 'propio',
      eaPlayerId: '1001',
      goals: 2,
      assists: 1,
      passesMade: 20,
      passesAttempted: 25,
      rating: 8.4,
      manOfTheMatch: true,
      redCards: 0,
      secondsPlayed: 5400,
    });
    expect(m.players.find((p) => p.gamertag === 'RivalFicticio')).toMatchObject({
      side: 'rival',
      goals: 1,
      manOfTheMatch: false,
    });
  });

  it('lo que EA no envía queda como sin dato (null), nunca 0', () => {
    const empty = processEaMatch(cached())!.players.find((p) => p.gamertag === 'SinDatos')!;
    expect(empty.goals).toBeNull();
    expect(empty.rating).toBeNull();
    expect(empty.manOfTheMatch).toBeNull();
    expect(empty.secondsPlayed).toBeNull();
  });

  it('empate, derrota y marcador desconocido', () => {
    const score = (a: string, b: string | undefined) =>
      processEaMatch(
        cached({ clubs: { [OURS]: { goals: a }, [RIVAL]: b === undefined ? {} : { goals: b } } }),
      )!.result;
    expect(score('1', '1')).toBe('empate');
    expect(score('0', '2')).toBe('derrota');
    expect(score('1', undefined)).toBeNull();
  });

  it('colores de la equipación local del rival', () => {
    expect(eaColor('15921906')).toBe('#f2f2f2');
    expect(eaColor('99999999')).toBeNull();
    expect(processEaMatch(cached())!.opponentColors).toBeNull();
    const withKit = processEaMatch(
      cached({
        clubs: {
          [OURS]: { goals: '1' },
          [RIVAL]: { goals: '0', details: { name: 'Rival', customKit: { kitColor1: '14356498', kitColor2: '15921906' } } },
        },
      }),
    )!;
    expect(withKit.opponentColors).toEqual({ primary: '#db1012', secondary: '#f2f2f2' });
  });

  it('descarta partidos sin exactamente un rival', () => {
    expect(processEaMatch(cached({ clubs: { [OURS]: {} } }))).toBeNull();
    expect(processEaMatch(cached({ clubs: { [OURS]: {}, '3': {}, '4': {} } }))).toBeNull();
    expect(processEaMatch({ ...cached(), payload: 'x' })).toBeNull();
  });
});

describe('procesamiento programado', () => {
  it('sin consentimiento no procesa nada; con consentimiento, cada partido una vez', async () => {
    const env = createMemoryRepos();
    const club = await env.repos.clubs.register({
      guildId: '900000000000000001',
      guildName: null,
      slug: 'club-ea',
      name: 'Club EA',
      adminDiscordId: '800000000000000001',
      adminDisplayName: 'Admin',
    });
    await env.repos.eaCapture.store([cached(), cached({}, '900002')]);
    expect(await runEaProcessing({ repos: env.repos })).toEqual({
      clubs: 0,
      processed: 0,
      skipped: 0,
      errors: [],
    });

    await env.repos.ea.link(club.clubId, 'common-gen5', OURS, '800000000000000001');
    expect((await runEaProcessing({ repos: env.repos })).processed).toBe(2);
    expect((await runEaProcessing({ repos: env.repos })).processed).toBe(0);
    expect(env.state.eaMatches.every((m) => m.clubId === club.clubId)).toBe(true);
  });
});

describe('/club ea', () => {
  const OWNER = { userId: '800000000000000001', name: 'Dueño', permissions: MANAGE_GUILD };
  const DT = { userId: '800000000000000002', name: 'Entrenador' };
  let env: ReturnType<typeof createMemoryRepos>;
  let deps: RouterDeps;
  const run = (i: Parameters<typeof routeInteraction>[0]) => routeInteraction(i, deps);
  const ea = (who: typeof OWNER | typeof DT, sub: string, options: ReturnType<typeof str>[] = []) =>
    run(
      slash(who, 'club', null, [
        { name: 'ea', type: 2, options: [{ name: sub, type: 1, options }] },
      ]),
    );

  beforeEach(async () => {
    env = createMemoryRepos();
    deps = { commands: commandsByName, components: componentHandlers, repos: env.repos };
    await run(
      slash(OWNER, 'club', 'registrar', [
        str('nombre', 'Club Prueba'),
        str('identificador', 'club-prueba'),
      ]),
    );
    env.addMember(env.state.clubs[0]!.id, DT.userId, 'dt');
  });

  it('solo un admin vincula; queda el consentimiento y se ve en estado', async () => {
    const opts = [str('id', '55341'), str('plataforma', 'common-gen5')];
    expect(textOf(await ea(DT, 'vincular', opts))).toMatch('Solo un admin');
    expect(
      textOf(await ea(OWNER, 'vincular', [str('id', 'abc'), str('plataforma', 'common-gen5')])),
    ).toMatch('solo números');
    const res = textOf(await ea(OWNER, 'vincular', opts));
    expect(res).toMatch('vinculado');
    expect(res).toMatch('autorizas a PIRLO');
    const estado = textOf(await ea(DT, 'estado'));
    expect(estado).toMatch('55341');
    expect(estado).toMatch(`<@${OWNER.userId}>`);
    expect(estado).toMatch('Todavía no hay partidos procesados');
  });

  it('un club de EA no puede estar en dos clubes de PIRLO', async () => {
    await ea(OWNER, 'vincular', [str('id', '55341'), str('plataforma', 'common-gen5')]);
    const other = {
      userId: '800000000000000009',
      name: 'Otro',
      permissions: MANAGE_GUILD,
      guildId: '900000000000000002',
    };
    await run(
      slash(other, 'club', 'registrar', [
        str('nombre', 'Otro Club'),
        str('identificador', 'otro-club'),
      ]),
    );
    expect(
      textOf(await ea(other, 'vincular', [str('id', '55341'), str('plataforma', 'common-gen5')])),
    ).toMatch('ya está vinculado a otro club');
  });

  it('retirar el consentimiento: solo admin y conserva lo procesado', async () => {
    await ea(OWNER, 'vincular', [str('id', OURS), str('plataforma', 'common-gen5')]);
    await env.repos.eaCapture.store([cached()]);
    await runEaProcessing({ repos: env.repos });
    expect(textOf(await ea(DT, 'retirar'))).toMatch('Solo un admin');
    expect(textOf(await ea(OWNER, 'retirar'))).toMatch('Consentimiento retirado');
    expect(textOf(await ea(OWNER, 'retirar'))).toMatch('no tenía');
    const estado = textOf(await ea(DT, 'estado'));
    expect(estado).toMatch('Sin vincular');
    expect(estado).toMatch('3-1 vs Rival Ficticio');
  });
});

describe('descarga de adjuntos', () => {
  const okFetch = (body: string) =>
    (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

  it('solo acepta el CDN de Discord por https', async () => {
    const download = createDiscordDownloader(okFetch('[]'));
    expect(await download('https://cdn.discordapp.com/attachments/1/2/liga.json')).toBe('[]');
    for (const url of ['https://evil.example/x.json', 'http://cdn.discordapp.com/x', 'no-es-url']) {
      let failed = false;
      await download(url).catch(() => (failed = true));
      expect(failed).toBe(true);
    }
  });

  it('rechaza archivos de más de 2 MB', async () => {
    const download = createDiscordDownloader(okFetch('x'.repeat(2_000_001)));
    let msg = '';
    await download('https://cdn.discordapp.com/a/b/c.json').catch((e: Error) => (msg = e.message));
    expect(msg).toMatch('demasiado grande');
  });
});

describe('/club ea importar', () => {
  const OWNER = { userId: '800000000000000001', name: 'Dueño', permissions: MANAGE_GUILD };
  const DT = { userId: '800000000000000002', name: 'Entrenador' };
  const PLAYER = { userId: '800000000000000003', name: 'Jugador' };
  const FILE_URL = 'https://cdn.discordapp.com/attachments/1/2/liga.json';
  let env: ReturnType<typeof createMemoryRepos>;
  let deps: RouterDeps;
  let file = '';
  const run = (i: Parameters<typeof routeInteraction>[0]) => routeInteraction(i, deps);

  // Interacción con un adjunto: Discord envía el id en la opción y los datos en data.resolved.
  const importar = (
    who: { userId: string; name: string; permissions?: string },
    extra: ReturnType<typeof str>[] = [],
  ) => {
    const i = slash(who, 'club', null, [
      {
        name: 'ea',
        type: 2,
        options: [
          {
            name: 'importar',
            type: 1,
            options: [{ name: 'archivo', type: 11, value: '42' }, ...extra],
          },
        ],
      },
    ]) as unknown as { data: Record<string, unknown> };
    i.data.resolved = {
      attachments: { '42': { id: '42', url: FILE_URL, filename: 'liga.json', size: file.length } },
    };
    return run(i as never);
  };

  beforeEach(async () => {
    env = createMemoryRepos();
    deps = {
      commands: commandsByName,
      components: componentHandlers,
      repos: env.repos,
      download: async (url) => {
        expect(url).toBe(FILE_URL);
        return file;
      },
    };
    await run(
      slash(OWNER, 'club', 'registrar', [
        str('nombre', 'Club Prueba'),
        str('identificador', 'club-prueba'),
      ]),
    );
    env.addMember(env.state.clubs[0]!.id, DT.userId, 'dt');
    env.addMember(env.state.clubs[0]!.id, PLAYER.userId, 'jugador');
    file = JSON.stringify([payload(), { ...payload(), matchId: '900002', timestamp: 1792894999 }]);
  });

  it('sin club de EA vinculado no importa nada', async () => {
    expect(textOf(await importar(OWNER))).toMatch('Primero un admin');
    expect(env.state.eaCache.size).toBe(0);
  });

  it('un DT importa y procesa al momento; repetir no duplica', async () => {
    await env.repos.ea.link(env.state.clubs[0]!.id, 'common-gen5', OURS, OWNER.userId);
    const first = textOf(await importar(DT));
    expect(first).toMatch('**2** partidos en el archivo · **2** nuevos · **2** procesados');
    expect(env.state.eaMatches.length).toBe(2);
    // Sin canal de resultados, sugiere configurarlo; con él, avisa dónde saldrá el resumen.
    expect(first).toMatch('uso: Resultados');
    env.state.channels.push({
      clubId: env.state.clubs[0]!.id,
      guildId: '900000000000000001',
      purpose: 'resultados',
      channelId: '930000000000000007',
    });
    expect(textOf(await importar(DT))).toMatch('2 ya estaban importados');
    expect(textOf(await importar(DT))).toMatch('<#930000000000000007>');
    expect(env.state.eaMatches.length).toBe(2);
  });

  it('un jugador no puede importar', async () => {
    await env.repos.ea.link(env.state.clubs[0]!.id, 'common-gen5', OURS, OWNER.userId);
    expect(textOf(await importar(PLAYER))).not.toMatch('procesados');
    expect(env.state.eaCache.size).toBe(0);
  });

  it('descarta partidos de otro club de EA y archivos que no son de EA', async () => {
    await env.repos.ea.link(env.state.clubs[0]!.id, 'common-gen5', '999', OWNER.userId);
    expect(textOf(await importar(OWNER))).toMatch('2 no eran del club de EA vinculado');
    expect(env.state.eaCache.size).toBe(0);
    file = '<html>no es EA</html>';
    expect(textOf(await importar(OWNER))).toMatch('El archivo no es el de EA');
  });
});

describe('estadísticas de EA en /ranking y /stats', () => {
  const OWNER = { userId: '800000000000000001', name: 'Dueño', permissions: MANAGE_GUILD };
  const PLAYER = { userId: '800000000000000003', name: 'Jugador' };

  it('cuentan los propios vinculados por gamertag; nunca los rivales', async () => {
    const env = createMemoryRepos();
    const deps: RouterDeps = { commands: commandsByName, components: componentHandlers, repos: env.repos };
    const run = (i: Parameters<typeof routeInteraction>[0]) => routeInteraction(i, deps);
    await run(slash(OWNER, 'club', 'registrar', [str('nombre', 'Club Prueba'), str('identificador', 'club-prueba')]));
    const clubId = env.state.clubs[0]!.id;
    const member = env.addMember(clubId, PLAYER.userId, 'jugador');
    await env.repos.ea.link(clubId, 'common-gen5', OURS, OWNER.userId);
    await env.repos.eaCapture.store([cached()]);
    await runEaProcessing({ repos: env.repos });

    const ranking = () => run(slash(PLAYER, 'ranking', null, [str('estadistica', 'goles'), str('temporada', 'todas')]));
    // Sin vincular: aparece con su gamertag de EA.
    expect(textOf(await ranking())).toMatch('JugadorFicticio');
    expect(textOf(await ranking())).not.toMatch('RivalFicticio');

    await env.repos.externalPlayers.linkGamertag(clubId, member.playerId, 'JugadorFicticio', OWNER.userId);
    const linked = textOf(await ranking());
    expect(linked).toMatch(member.displayName);
    expect(linked).not.toMatch('RivalFicticio');
    const stats = textOf(await run(slash(PLAYER, 'stats', null, [str('temporada', 'todas')])));
    expect(stats).toMatch('Goles');
    expect(stats).toMatch('2');
  });
});
