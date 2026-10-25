import { beforeEach, describe, expect, it } from 'vitest';
import { formationLines, formationSlots, FORMATION_NAMES } from '../../src/core/lineups/formations.js';
import { commandsByName, componentHandlers } from '../../src/discord/commands/index.js';
import { routeInteraction, type RouterDeps } from '../../src/discord/router.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';
import { bool, button, MANAGE_GUILD, slash, str, textOf, user } from '../helpers/interactions.js';

// Usuarios y datos ficticios, solo para pruebas.
const OWNER = { userId: '800000000000000001', name: 'Dueño', permissions: MANAGE_GUILD };
const DT = { userId: '800000000000000002', name: 'Entrenador' };
const PLAYER = { userId: '800000000000000003', name: 'Jugador' };
const OTHER = { userId: '800000000000000005', name: 'Otro' };
const STRANGER = { userId: '800000000000000004', name: 'Visitante' };

let env: ReturnType<typeof createMemoryRepos>;
let deps: RouterDeps;
let clubId: string;
const run = (i: Parameters<typeof routeInteraction>[0]) => routeInteraction(i, deps);
const flags = (r: unknown) => (r as { data: { flags?: number } }).data.flags;
const footer = (r: unknown) =>
  (r as { data: { embeds?: { footer?: { text: string } }[] } }).data.embeds?.[0]?.footer?.text ?? '';

beforeEach(async () => {
  env = createMemoryRepos();
  deps = { commands: commandsByName, components: componentHandlers, repos: env.repos };
  await run(slash(OWNER, 'club', 'registrar', [str('nombre', 'Club Prueba'), str('identificador', 'club-prueba')]));
  clubId = env.state.clubs[0]!.id;
  env.addMember(clubId, DT.userId, 'dt');
  env.addMember(clubId, PLAYER.userId, 'jugador');
  env.addMember(clubId, OTHER.userId, 'jugador');
});

const convocar = () =>
  run(slash(DT, 'convocatoria', 'crear', [str('titulo', 'Liga J1'), str('fecha', 'mañana'), str('hora', '21:30')]));
const crear = (formacion = '4-3-3', extra: ReturnType<typeof bool>[] = []) =>
  run(slash(DT, 'alineacion', 'crear', [str('formacion', formacion), ...extra]));
const poner = (who: { userId: string }, posicion: string, as = DT) =>
  run(slash(as, 'alineacion', 'poner', [user('jugador', who.userId), str('posicion', posicion)]));

describe('formaciones', () => {
  it('todas tienen 11 titulares y empiezan por el portero', () => {
    for (const f of FORMATION_NAMES) {
      expect(formationSlots(f)).toHaveLength(11);
      expect(formationSlots(f)[0]).toBe('POR');
      expect(formationLines(f).flat()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(f.split('-').map(Number).reduce((a, b) => a + b, 0)).toBe(10);
    }
  });
});

describe('/alineacion', () => {
  it('sin convocatoria pide crear una primero', async () => {
    expect(textOf(await crear())).toMatch('/convocatoria crear');
  });

  it('crear, poner, mover y quitar con un borrador que solo ve el DT', async () => {
    await convocar();
    const created = await crear();
    expect(textOf(created)).toMatch('4-3-3');
    expect(flags(created)).toBe(64);
    expect(footer(created)).toMatch('0/11 titulares');

    let res = await poner(PLAYER, 'DC');
    expect(textOf(res)).toMatch('**DC** Usuario 003 ⌛');
    expect(textOf(res)).toMatch('No dijeron "Voy": Usuario 003');
    res = await poner(PLAYER, 'EI');
    expect(textOf(res)).toMatch('**EI** Usuario 003');
    expect(textOf(res)).toMatch('**DC** —');

    res = await run(slash(DT, 'alineacion', 'suplente', [user('jugador', OTHER.userId)]));
    expect(textOf(res)).toMatch('Suplentes (1)');
    res = await run(slash(DT, 'alineacion', 'quitar', [user('jugador', OTHER.userId)]));
    expect(textOf(res)).toMatch('sale de la alineación');
    expect(textOf(res)).toMatch('Suplentes (0)');

    expect(textOf(await run(slash(PLAYER, 'alineacion', 'ver')))).toMatch('todavía no se ha publicado');
  });

  it('quien dijo "Voy" no lleva aviso', async () => {
    await convocar();
    await run(button(PLAYER, `callup:voy:club-prueba:${env.state.callups[0]!.id}`));
    await crear();
    const res = await poner(PLAYER, 'DC');
    expect(textOf(res)).toMatch('**DC** Usuario 003');
    expect(textOf(res)).not.toMatch('No dijeron');
  });

  it('una posición ocupada o inexistente se rechaza', async () => {
    await convocar();
    await crear();
    await poner(PLAYER, 'DC');
    expect(textOf(await poner(OTHER, 'DC'))).toMatch('ya están ocupadas');
    expect(textOf(await poner(OTHER, 'SD'))).toMatch('no tiene la posición SD');
  });

  it('crear otra vez exige reemplazar', async () => {
    await convocar();
    await crear();
    expect(textOf(await crear('4-4-2'))).toMatch('ya tiene alineación');
    expect(textOf(await crear('4-4-2', [bool('reemplazar', true)]))).toMatch('4-4-2');
  });

  it('publicar la muestra a todo el canal y luego cualquiera puede verla', async () => {
    await convocar();
    await crear();
    expect(textOf(await run(slash(DT, 'alineacion', 'publicar')))).toMatch('vacía');
    await poner(PLAYER, 'POR');
    const pub = await run(slash(DT, 'alineacion', 'publicar'));
    expect(flags(pub)).toBeUndefined();
    expect(footer(pub)).toBe('Alineación publicada');
    const seen = textOf(await run(slash(STRANGER, 'alineacion', 'ver')));
    expect(seen).toMatch('**POR** Usuario 003');
    expect(seen).not.toMatch('⌛');
  });

  it('solo DT o admin la gestionan, y solo con miembros del club', async () => {
    await convocar();
    expect(textOf(await run(slash(PLAYER, 'alineacion', 'crear', [str('formacion', '4-3-3')])))).toMatch('permiso');
    await crear();
    expect(textOf(await poner(PLAYER, 'DC', PLAYER))).toMatch('permiso');
    expect(textOf(await poner(STRANGER, 'DC'))).toMatch('no forma parte de la plantilla');
  });
});
