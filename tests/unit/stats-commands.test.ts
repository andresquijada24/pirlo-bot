import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionStatRow } from '../../src/core/stats/service.js';
import { commandsByName, componentHandlers } from '../../src/discord/commands/index.js';
import { routeInteraction, type RouterDeps } from '../../src/discord/router.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';
import { bool, MANAGE_GUILD, slash, str, textOf, user } from '../helpers/interactions.js';

// Usuarios y datos ficticios, solo para pruebas.
const OWNER = { userId: '800000000000000001', name: 'Dueño', permissions: MANAGE_GUILD };
const DT = { userId: '800000000000000002', name: 'Entrenador' };
const PLAYER = { userId: '800000000000000003', name: 'Jugador' };
const STRANGER = { userId: '800000000000000004', name: 'Visitante' };

let env: ReturnType<typeof createMemoryRepos>;
let deps: RouterDeps;
let clubId: string;
const run = (i: Parameters<typeof routeInteraction>[0]) => routeInteraction(i, deps);
const flags = (r: unknown) => (r as { data?: { flags?: number } }).data?.flags;
const footer = (r: unknown) =>
  (r as { data: { embeds: { footer?: { text: string } }[] } }).data.embeds[0]?.footer?.text ?? '';

const statRow = (over: Partial<SessionStatRow>): SessionStatRow & { clubId: string } => ({
  clubId,
  seasonId: null,
  playerId: null,
  source: 'maritimo',
  sourcePlayerId: 'x',
  name: 'X',
  sessions: 1,
  matchesPlayed: 4,
  goals: null,
  assists: null,
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
  ratingPoints: null,
  ratedMatches: null,
  ...over,
});

beforeEach(async () => {
  env = createMemoryRepos();
  deps = { commands: commandsByName, components: componentHandlers, repos: env.repos };
  await run(slash(OWNER, 'club', 'registrar', [str('nombre', 'Club Prueba'), str('identificador', 'club-prueba')]));
  clubId = env.state.clubs[0]!.id;
  env.addMember(clubId, DT.userId, 'dt');
  env.addMember(clubId, PLAYER.userId, 'jugador');
});

const playerId = (discordUserId: string) =>
  env.state.memberships.find((m) => m.clubId === clubId && m.discordUserId === discordUserId)!.playerId;

describe('/stats', () => {
  it('muestra las estadísticas propias y "—" para lo que no hay', async () => {
    env.state.sessionRows.push(statRow({ playerId: playerId(PLAYER.userId), goals: 3, assists: 1 }));
    const res = await run(slash(PLAYER, 'stats', null, [str('temporada', 'todas')]));
    const text = textOf(res);
    expect(text).toMatch('Goles\n3');
    expect(text).toMatch('G + A\n4');
    expect(text).toMatch('Paradas\n—');
    expect(text).not.toMatch('Paradas\n0');
    expect(flags(res)).toBe(64);
  });

  it('se puede publicar para todo el canal', async () => {
    env.state.sessionRows.push(statRow({ playerId: playerId(PLAYER.userId), goals: 3 }));
    const res = await run(slash(PLAYER, 'stats', null, [str('temporada', 'todas'), bool('publicar', true)]));
    expect(flags(res)).toBeUndefined();
  });

  it('por defecto usa la temporada actual', async () => {
    await run(slash(OWNER, 'temporada', 'crear', [str('nombre', 'T1')]));
    const season = env.state.seasons[0]!;
    env.state.sessionRows.push(
      statRow({ playerId: playerId(PLAYER.userId), seasonId: null, goals: 10 }),
      statRow({ playerId: playerId(PLAYER.userId), seasonId: season.id, sourcePlayerId: 'y', goals: 2 }),
    );
    expect(textOf(await run(slash(PLAYER, 'stats', null)))).toMatch('Goles\n2');
    expect(textOf(await run(slash(PLAYER, 'stats', null, [str('temporada', 'todas')])))).toMatch('Goles\n12');
  });

  it('las de otro jugador del club', async () => {
    env.state.sessionRows.push(statRow({ playerId: playerId(DT.userId), goals: 7 }));
    const text = textOf(await run(slash(STRANGER, 'stats', null, [user('usuario', DT.userId), str('temporada', 'todas')])));
    expect(text).toMatch('Goles\n7');
  });

  it('avisa si no hay datos o si la persona no es del club', async () => {
    expect(textOf(await run(slash(PLAYER, 'stats', null)))).toMatch('Todavía no hay estadísticas');
    expect(textOf(await run(slash(STRANGER, 'stats', null)))).toMatch('/vincular');
  });

  it('nunca muestra datos de otro club', async () => {
    env.state.sessionRows.push({ ...statRow({ playerId: playerId(PLAYER.userId), goals: 99 }), clubId: 'otro-club' });
    expect(textOf(await run(slash(PLAYER, 'stats', null, [str('temporada', 'todas')])))).toMatch('Todavía no hay');
  });
});

describe('/ranking', () => {
  it('lista por estadística con medallas y marca a quien no está vinculado', async () => {
    env.state.sessionRows.push(
      statRow({ playerId: playerId(PLAYER.userId), goals: 5 }),
      statRow({ sourcePlayerId: 'gt:invitado', name: 'Invitado', goals: 2 }),
    );
    const res = await run(slash(STRANGER, 'ranking', null, [str('estadistica', 'goles'), str('temporada', 'todas')]));
    expect(textOf(res)).toMatch('🥇 **Usuario 003** — 5');
    expect(textOf(res)).toMatch('🥈 **Invitado ·** — 2');
    expect(footer(res)).toMatch('sin vincular');
  });

  it('indica el mínimo de muestra cuando aplica', async () => {
    const res = await run(slash(STRANGER, 'ranking', null, [str('estadistica', 'pases'), str('temporada', 'todas')]));
    expect(footer(res)).toMatch('mínimo 50 pases intentados');
    expect(textOf(res)).toMatch('Todavía no hay datos suficientes');
  });
});

describe('/plantilla gamertag', () => {
  it('un DT vincula el gamertag y las estadísticas pasan al jugador', async () => {
    env.state.externalPlayers.push({ clubId, gamertag: 'Pirlo21', playerId: null });
    env.state.sessionRows.push(statRow({ sourcePlayerId: 'ext-1', name: 'pirlo21', goals: 4 }));
    const res = await run(slash(DT, 'plantilla', 'gamertag', [user('usuario', PLAYER.userId), str('gamertag', ' Pirlo21 ')]));
    expect(textOf(res)).toMatch('quedó vinculado a **Pirlo21**');
    expect(textOf(await run(slash(PLAYER, 'stats', null, [str('temporada', 'todas')])))).toMatch('Goles\n4');
  });

  it('si el proveedor aún no lo informó, lo deja pendiente', async () => {
    const res = await run(slash(DT, 'plantilla', 'gamertag', [user('usuario', PLAYER.userId), str('gamertag', 'Nuevo')]));
    expect(textOf(res)).toMatch('se asignarán solas');
  });

  it('un jugador no puede vincular gamertags', async () => {
    const res = await run(slash(PLAYER, 'plantilla', 'gamertag', [user('usuario', PLAYER.userId), str('gamertag', 'X')]));
    expect(textOf(res)).toMatch('permiso');
  });

  it('no se puede quitar un gamertag ya vinculado a otro', async () => {
    env.state.externalPlayers.push({ clubId, gamertag: 'Pirlo21', playerId: playerId(DT.userId) });
    const res = await run(slash(OWNER, 'plantilla', 'gamertag', [user('usuario', PLAYER.userId), str('gamertag', 'pirlo21')]));
    expect(textOf(res)).toMatch('ya está vinculado a otro jugador');
  });
});

describe('/club sincronizacion', () => {
  it('club manual: explica que no hay sincronización', async () => {
    expect(textOf(await run(slash(DT, 'club', 'sincronizacion')))).toMatch('a mano');
  });

  it('muestra la última ejecución y el id del club', async () => {
    env.state.clubs[0]!.statsProvider = 'maritimo';
    const runId = await env.repos.sync.startRun(clubId, 'maritimo', null);
    await env.repos.sync.finishRun(clubId, runId, {
      status: 'error',
      cursorAfter: null,
      rowsInserted: 0,
      rowsUpdated: 0,
      errorMessage: 'La API de Marítimo rechazó la clave',
    });
    const text = textOf(await run(slash(OWNER, 'club', 'sincronizacion')));
    expect(text).toMatch('Con error');
    expect(text).toMatch('rechazó la clave');
    expect(text).toMatch(clubId);
  });

  it('un jugador no puede verla', async () => {
    expect(textOf(await run(slash(PLAYER, 'club', 'sincronizacion')))).toMatch('permiso');
  });
});
