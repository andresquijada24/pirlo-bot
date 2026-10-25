import { beforeEach, describe, expect, it } from 'vitest';
import { commandsByName, componentHandlers } from '../../src/discord/commands/index.js';
import { routeInteraction, type RouterDeps } from '../../src/discord/router.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';
import { button, MANAGE_GUILD, OTHER_GUILD, slash, str, textOf } from '../helpers/interactions.js';

// Usuarios y datos ficticios, solo para pruebas.
const OWNER = { userId: '800000000000000001', name: 'Dueño', permissions: MANAGE_GUILD };
const CAPTAIN = { userId: '800000000000000002', name: 'Capitán' };
const PLAYER = { userId: '800000000000000003', name: 'Jugador' };
const STRANGER = { userId: '800000000000000004', name: 'Visitante' };

let env: ReturnType<typeof createMemoryRepos>;
let deps: RouterDeps;
let clubId: string;
const run = (i: Parameters<typeof routeInteraction>[0]) => routeInteraction(i, deps);
type Res = {
  type: number;
  data: {
    flags?: number;
    embeds?: { fields?: { name: string; value: string }[] }[];
    components?: { components: { custom_id: string; disabled?: boolean }[] }[];
  };
};
const buttonsOf = (r: unknown) => (r as Res).data.components?.[0]?.components ?? [];
const field = (r: unknown, prefix: string) =>
  (r as Res).data.embeds?.[0]?.fields?.find((f) => f.name.startsWith(prefix));

beforeEach(async () => {
  env = createMemoryRepos();
  deps = { commands: commandsByName, components: componentHandlers, repos: env.repos };
  await run(slash(OWNER, 'club', 'registrar', [str('nombre', 'Club Prueba'), str('identificador', 'club-prueba')]));
  clubId = env.state.clubs[0]!.id;
  env.addMember(clubId, CAPTAIN.userId, 'capitan');
  env.addMember(clubId, PLAYER.userId, 'jugador');
});

async function create(who = CAPTAIN) {
  return run(
    slash(who, 'convocatoria', 'crear', [
      str('titulo', 'Liga · J1'),
      str('fecha', 'mañana'),
      str('hora', '21:30'),
      str('rival', 'Rival FC'),
    ]),
  );
}

describe('/convocatoria crear', () => {
  it('publica en el canal el tablero con botones y toda la plantilla sin responder', async () => {
    const res = await create();
    expect((res as Res).data.flags).toBeUndefined();
    expect(textOf(res)).toMatch('Liga · J1');
    expect(textOf(res)).toMatch('Rival FC');
    expect(textOf(res)).toMatch(/<t:\d+:F>/);
    expect(field(res, '⌛')!.name).toBe('⌛ Sin responder (3)');
    expect(buttonsOf(res).map((b) => b.custom_id.split(':')[1])).toEqual(['voy', 'duda', 'no_voy', 'cerrar']);
    expect(buttonsOf(res)[0]!.custom_id).toBe(`callup:voy:club-prueba:${env.state.callups[0]!.id}`);
  });

  it('un jugador no puede convocar', async () => {
    expect(textOf(await create(PLAYER))).toMatch('permiso');
    expect(env.state.callups).toHaveLength(0);
  });

  it('rechaza fechas pasadas o mal escritas', async () => {
    const past = await run(
      slash(CAPTAIN, 'convocatoria', 'crear', [str('titulo', 'X'), str('fecha', '2020-01-01'), str('hora', '21:00')]),
    );
    expect(textOf(past)).toMatch('ya pasaron');
    const bad = await run(
      slash(CAPTAIN, 'convocatoria', 'crear', [str('titulo', 'X'), str('fecha', 'el sábado'), str('hora', '21:00')]),
    );
    expect(textOf(bad)).toMatch('Fecha no válida');
  });
});

describe('botones de la convocatoria', () => {
  it('responder actualiza el tablero y se puede cambiar de opinión', async () => {
    await create();
    const id = env.state.callups[0]!.id;
    let res = await run(button(PLAYER, `callup:duda:club-prueba:${id}`));
    expect((res as Res).type).toBe(7);
    expect(field(res, '❓')!.name).toBe('❓ Duda (1)');
    res = await run(button(PLAYER, `callup:voy:club-prueba:${id}`));
    expect(field(res, '✅')!.name).toBe('✅ Voy (1)');
    expect(field(res, '✅')!.value).toBe(`<@${PLAYER.userId}>`);
    expect(field(res, '❓')!.name).toBe('❓ Duda (0)');
    expect(env.state.callupResponses).toHaveLength(1);
  });

  it('quien no es del club no puede responder', async () => {
    await create();
    const res = await run(button(STRANGER, `callup:voy:club-prueba:${env.state.callups[0]!.id}`));
    expect(textOf(res)).toMatch('/vincular');
    expect(env.state.callupResponses).toHaveLength(0);
  });

  it('cerrar: solo capitán o superior, y después no se aceptan respuestas', async () => {
    await create();
    const id = env.state.callups[0]!.id;
    expect(textOf(await run(button(PLAYER, `callup:cerrar:club-prueba:${id}`)))).toMatch('permiso');
    const closed = await run(button(CAPTAIN, `callup:cerrar:club-prueba:${id}`));
    expect(textOf(closed)).toMatch('Convocatoria cerrada');
    expect(buttonsOf(closed).every((b) => b.disabled)).toBe(true);
    expect(textOf(await run(button(PLAYER, `callup:voy:club-prueba:${id}`)))).toMatch('cerrada');
  });

  it('un botón no sirve desde otro servidor ni con ids manipulados', async () => {
    await create();
    const id = env.state.callups[0]!.id;
    const other = await run(button({ ...PLAYER, guildId: OTHER_GUILD }, `callup:voy:club-prueba:${id}`));
    expect(textOf(other)).not.toMatch('Voy \\(1\\)');
    expect(env.state.callupResponses).toHaveLength(0);
    expect(textOf(await run(button(PLAYER, 'callup:voy:club-prueba:no-es-uuid')))).toMatch('no encontrad');
    expect(textOf(await run(button(PLAYER, `callup:borrar:club-prueba:${id}`)))).toMatch('no encontrad');
  });
});

describe('/convocatoria ver y lista', () => {
  it('sin convocatorias lo dice', async () => {
    expect(textOf(await run(slash(PLAYER, 'convocatoria', 'ver')))).toMatch('No hay convocatorias abiertas');
  });

  it('lista muestra los conteos y ver vuelve a publicar el tablero', async () => {
    await create();
    await run(button(PLAYER, `callup:voy:club-prueba:${env.state.callups[0]!.id}`));
    expect(textOf(await run(slash(PLAYER, 'convocatoria', 'lista')))).toMatch('✅ 1 · ❓ 0 · ❌ 0 · ⌛ 2');
    const shown = await run(slash(PLAYER, 'convocatoria', 'ver'));
    expect((shown as Res).data.flags).toBeUndefined();
    expect(buttonsOf(shown)).toHaveLength(4);
  });
});

describe('/club zona', () => {
  it('el admin cambia la zona horaria; zonas inválidas se rechazan', async () => {
    expect(textOf(await run(slash(OWNER, 'club', 'zona', [str('zona', 'America/Santo_Domingo')])))).toMatch(
      'America/Santo_Domingo',
    );
    expect(env.state.clubs[0]!.timezone).toBe('America/Santo_Domingo');
    expect(textOf(await run(slash(OWNER, 'club', 'zona', [str('zona', 'Marte/Olympus')])))).toMatch('no válida');
    expect(textOf(await run(slash(CAPTAIN, 'club', 'zona', [str('zona', 'UTC')])))).toMatch('permiso');
  });
});

describe('/convocatoria crear: hora pasada', () => {
  it('sugiere la versión pm si la hora escrita ya pasó', async () => {
    // A las 00:00 ya pasaron todas las horas "de hoy" salvo que se usen las de la noche.
    const res = await run(
      slash(CAPTAIN, 'convocatoria', 'crear', [str('titulo', 'X'), str('fecha', '2020-01-01'), str('hora', '9:30')]),
    );
    expect(textOf(res)).toMatch('ya pasaron');
  });
});
