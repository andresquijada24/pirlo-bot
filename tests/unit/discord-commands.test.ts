import { beforeEach, describe, expect, it } from 'vitest';
import { commandsByName, componentHandlers } from '../../src/discord/commands/index.js';
import { parsePositions } from '../../src/discord/commands/plantilla.js';
import { routeInteraction, type RouterDeps } from '../../src/discord/router.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';
import {
  bool,
  button,
  channel,
  MANAGE_GUILD,
  OTHER_GUILD,
  slash,
  str,
  textOf,
  user,
} from '../helpers/interactions.js';

// Usuarios de prueba (IDs ficticios).
const OWNER = { userId: '800000000000000001', name: 'Dueño', permissions: MANAGE_GUILD };
const DT = { userId: '800000000000000002', name: 'Entrenador' };
const PLAYER = { userId: '800000000000000003', name: 'Jugador' };
const STRANGER = { userId: '800000000000000004', name: 'Visitante' };

let env: ReturnType<typeof createMemoryRepos>;
let deps: RouterDeps;
beforeEach(() => {
  env = createMemoryRepos();
  deps = { commands: commandsByName, components: componentHandlers, repos: env.repos };
});

const run = (i: Parameters<typeof routeInteraction>[0]) => routeInteraction(i, deps);
const isEphemeral = (r: unknown) => (r as { data?: { flags?: number } }).data?.flags === 64;

async function registerClub() {
  await run(slash(OWNER, 'club', 'registrar', [str('nombre', 'Club Prueba'), str('identificador', 'club-prueba')]));
  return env.state.clubs[0]!.id;
}

describe('router', () => {
  it('responde PONG al PING de Discord', async () => {
    expect(await run({ type: 1 } as never)).toEqual({ type: 1 });
  });

  it('las respuestas nunca hacen ping a nadie', async () => {
    const res = await run(slash(STRANGER, 'pirlo', 'ayuda'));
    expect((res as { data: { allowed_mentions: unknown } }).data.allowed_mentions).toEqual({ parse: [] });
  });

  it('fuera de un servidor responde con un aviso', async () => {
    const i = slash(STRANGER, 'club', 'info') as unknown as Record<string, unknown>;
    delete i.guild_id;
    delete i.member;
    expect(textOf(await run(i as never))).toMatch('solo funciona dentro de un servidor');
  });

  it('sin base de datos, /pirlo ayuda funciona y el resto avisa', async () => {
    deps = { ...deps, repos: null };
    expect(textOf(await run(slash(STRANGER, 'pirlo', 'ayuda')))).toMatch('Primeros pasos');
    expect(textOf(await run(slash(STRANGER, 'club', 'info')))).toMatch('base de datos');
  });

  it('un error inesperado no expone detalles internos', async () => {
    const errors: unknown[] = [];
    deps = {
      ...deps,
      repos: { ...env.repos, clubs: { ...env.repos.clubs, listByGuild: () => Promise.reject(new Error('secreto interno')) } },
      log: { error: (o) => errors.push(o) },
    };
    const res = await run(slash(STRANGER, 'club', 'info'));
    expect(textOf(res)).not.toMatch('secreto interno');
    expect(textOf(res)).toMatch('error inesperado');
    expect(errors).toHaveLength(1);
  });
});

describe('/club', () => {
  it('registrar: solo con "Gestionar servidor"', async () => {
    const res = await run(slash(STRANGER, 'club', 'registrar', [str('nombre', 'X'), str('identificador', 'x')]));
    expect(textOf(res)).toMatch('gestionar el servidor');
    expect(env.state.clubs).toHaveLength(0);
  });

  it('registrar: el permiso Administrador también vale', async () => {
    const admin = { ...STRANGER, permissions: String(1 << 3) };
    await run(slash(admin, 'club', 'registrar', [str('nombre', 'X'), str('identificador', 'x')]));
    expect(env.state.clubs).toHaveLength(1);
  });

  it('registrar crea el club y nombra admin a quien lo registra', async () => {
    const res = await run(
      slash(OWNER, 'club', 'registrar', [str('nombre', 'Marítimo CF'), str('identificador', 'Maritimo-CF')]),
    );
    expect(textOf(res)).toMatch('`maritimo-cf`');
    expect(isEphemeral(res)).toBe(true);
    const info = await run(slash({ ...OWNER, permissions: '0' }, 'club', 'info'));
    expect(textOf(info)).toMatch('Marítimo CF');
    expect(textOf(info)).toMatch('Admin');
  });

  it('info avisa si el servidor no tiene club', async () => {
    expect(textOf(await run(slash(STRANGER, 'club', 'info')))).toMatch('/club registrar');
  });

  it('canal: solo admin, y queda guardado', async () => {
    const clubId = await registerClub();
    env.addMember(clubId, DT.userId, 'dt');
    const ch = channel('canal', '700000000000000001');
    expect(textOf(await run(slash(DT, 'club', 'canal', [str('uso', 'anuncios'), ch])))).toMatch('permiso');
    await run(slash(OWNER, 'club', 'canal', [str('uso', 'anuncios'), ch]));
    expect(await env.repos.channels.list(clubId)).toEqual([
      { purpose: 'anuncios', channelId: '700000000000000001' },
    ]);
  });

  it('desde otro servidor no se ve el club', async () => {
    await registerClub();
    const res = await run(slash({ ...STRANGER, guildId: OTHER_GUILD }, 'club', 'info', [str('club', 'club-prueba')]));
    expect(textOf(res)).toMatch(/no tiene ningún club|No hay ningún club/);
    expect(textOf(res)).not.toMatch('Club Prueba');
  });
});

describe('/vincular y /solicitudes', () => {
  it('flujo completo con botones: solicitar → listar → aprobar', async () => {
    const clubId = await registerClub();
    env.addMember(clubId, DT.userId, 'dt');

    const req = await run(slash(PLAYER, 'vincular', null, [str('nombre', 'Jugador Tres'), str('gamertag', 'JT3')]));
    expect(textOf(req)).toMatch('Solicitud enviada');

    const list = (await run(slash(DT, 'solicitudes', null))) as {
      data: { components: { components: { custom_id: string }[] }[] };
    };
    expect(textOf(list)).toMatch('Jugador Tres');
    const approveId = list.data.components[0]!.components[0]!.custom_id;
    expect(approveId).toMatch(/^link:approve:club-prueba:/);

    const res = await run(button(DT, approveId));
    expect((res as { type: number }).type).toBe(7); // actualiza el mensaje original
    expect(textOf(res)).toMatch('aprobada');
    expect((await env.repos.memberships.findActiveByDiscordUser(clubId, PLAYER.userId))?.role).toBe('jugador');
  });

  it('un jugador no puede pulsar el botón de aprobar', async () => {
    const clubId = await registerClub();
    env.addMember(clubId, DT.userId, 'dt');
    env.addMember(clubId, PLAYER.userId, 'jugador');
    await run(slash(STRANGER, 'vincular', null, [str('nombre', 'Nuevo')]));
    const list = (await run(slash(DT, 'solicitudes', null))) as {
      data: { components: { components: { custom_id: string }[] }[] };
    };
    const res = await run(button(PLAYER, list.data.components[0]!.components[0]!.custom_id));
    expect(textOf(res)).toMatch('permiso');
    expect(await env.repos.memberships.findActiveByDiscordUser(clubId, STRANGER.userId)).toBeNull();
  });

  it('un botón manipulado de otro servidor no aprueba nada', async () => {
    await registerClub();
    await run(slash(STRANGER, 'vincular', null, [str('nombre', 'Nuevo')]));
    const requestId = env.state.linkRequests[0]!.id;
    const outsider = { userId: '800000000000000009', permissions: MANAGE_GUILD, guildId: OTHER_GUILD };
    const res = await run(button(outsider, `link:approve:club-prueba:${requestId}`));
    expect(textOf(res)).toMatch(/no encontrado|No hay ningún club|no tiene ningún club/);
    expect(env.state.linkRequests[0]!.status).toBe('pendiente');
  });

  it('botones con datos inválidos responden de forma controlada', async () => {
    await registerClub();
    expect(textOf(await run(button(OWNER, 'link:approve:club-prueba:no-es-uuid')))).toMatch('no encontrado');
    expect(textOf(await run(button(OWNER, 'desconocido:x')))).toMatch('ya no está disponible');
  });

  it('sin solicitudes pendientes lo dice', async () => {
    await registerClub();
    expect(textOf(await run(slash(OWNER, 'solicitudes', null)))).toMatch('No hay solicitudes');
  });
});

describe('/plantilla', () => {
  it('ver: solo miembros', async () => {
    const clubId = await registerClub();
    env.addMember(clubId, PLAYER.userId, 'jugador');
    expect(textOf(await run(slash(STRANGER, 'plantilla', 'ver')))).toMatch('permiso');
    const res = await run(slash(PLAYER, 'plantilla', 'ver'));
    expect(textOf(res)).toMatch('Plantilla');
    expect(textOf(res)).toMatch(`<@${PLAYER.userId}>`);
  });

  it('rol: un DT nombra capitán, pero no otro DT', async () => {
    const clubId = await registerClub();
    env.addMember(clubId, DT.userId, 'dt');
    env.addMember(clubId, PLAYER.userId, 'jugador');
    expect(textOf(await run(slash(DT, 'plantilla', 'rol', [user('usuario', PLAYER.userId), str('rol', 'capitan')])))).toMatch('Capitán');
    expect(textOf(await run(slash(DT, 'plantilla', 'rol', [user('usuario', PLAYER.userId), str('rol', 'dt')])))).toMatch('inferiores');
  });

  it('rol: usuario que no está en la plantilla', async () => {
    await registerClub();
    const res = await run(slash(OWNER, 'plantilla', 'rol', [user('usuario', STRANGER.userId), str('rol', 'capitan')]));
    expect(textOf(res)).toMatch('no forma parte de la plantilla');
  });

  it('posiciones: cada jugador define las suyas', async () => {
    const clubId = await registerClub();
    env.addMember(clubId, PLAYER.userId, 'jugador');
    await run(slash(PLAYER, 'plantilla', 'posiciones', [str('posiciones', 'mc, mco')]));
    expect((await env.repos.memberships.findActiveByDiscordUser(clubId, PLAYER.userId))?.positions).toEqual(['MC', 'MCO']);
  });

  it('posiciones: rechaza códigos desconocidos', async () => {
    const clubId = await registerClub();
    env.addMember(clubId, PLAYER.userId, 'jugador');
    expect(textOf(await run(slash(PLAYER, 'plantilla', 'posiciones', [str('posiciones', 'MC, XX')])))).toMatch('XX');
  });

  it('baja: el último admin no puede darse de baja', async () => {
    await registerClub();
    const res = await run(slash({ ...OWNER, permissions: '0' }, 'plantilla', 'baja', [user('usuario', OWNER.userId)]));
    expect(textOf(res)).toMatch('al menos un admin');
  });
});

describe('/temporada', () => {
  it('crear (por defecto actual) y ver', async () => {
    await registerClub();
    await run(slash(OWNER, 'temporada', 'crear', [str('nombre', 'T1')]));
    await run(slash(OWNER, 'temporada', 'crear', [str('nombre', 'T2'), bool('actual', true)]));
    const res = textOf(await run(slash(STRANGER, 'temporada', 'ver')));
    expect(res).toMatch('▶️ T2');
    expect(res).toMatch('• T1');
  });

  it('un DT no puede crear temporadas', async () => {
    const clubId = await registerClub();
    env.addMember(clubId, DT.userId, 'dt');
    expect(textOf(await run(slash(DT, 'temporada', 'crear', [str('nombre', 'T1')])))).toMatch('permiso');
  });
});

describe('parsePositions', () => {
  it('acepta separadores variados y mayúsculas/minúsculas', () => {
    expect(parsePositions('mc, MCO dc/por')).toEqual(['MC', 'MCO', 'DC', 'POR']);
  });
});

describe('definiciones de comandos', () => {
  it('nombres y descripciones respetan los límites de Discord', () => {
    const check = (o: { name: string; description: string; options?: unknown[] }) => {
      expect(o.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(o.description.length).toBeGreaterThan(0);
      expect(o.description.length <= 100).toBe(true);
      for (const sub of (o.options ?? []) as (typeof o)[]) check(sub);
    };
    for (const c of commandsByName.values()) check(c.definition as never);
  });

  it('todos los comandos son solo para servidores', () => {
    for (const c of commandsByName.values()) expect(c.definition.contexts).toEqual([0]);
  });
});
