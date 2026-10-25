import { beforeEach, describe, expect, it } from 'vitest';
import { commandsByName, componentHandlers } from '../../src/discord/commands/index.js';
import { createDiscordPoster, DiscordPostError, type ChannelPoster } from '../../src/discord/poster.js';
import { routeInteraction, type RouterDeps } from '../../src/discord/router.js';
import { REFERENCE_GUILD_ID, runReminders } from '../../src/jobs/reminders.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';
import { button, channel, MANAGE_GUILD, slash, str, TEST_GUILD, textOf } from '../helpers/interactions.js';

// Usuarios, canales y datos ficticios, solo para pruebas.
const OWNER = { userId: '800000000000000001', name: 'Dueño', permissions: MANAGE_GUILD };
const PLAYER = { userId: '800000000000000003', name: 'Jugador' };
const CHANNEL = '930000000000000001';
const int = (name: string, value: number) => ({ name, type: 4, value }) as unknown as ReturnType<typeof str>;

let env: ReturnType<typeof createMemoryRepos>;
let deps: RouterDeps;
let clubId: string;
const run = (i: Parameters<typeof routeInteraction>[0]) => routeInteraction(i, deps);

function fakePoster(fail = false) {
  const posts: { channelId: string; body: Record<string, unknown> }[] = [];
  const poster: ChannelPoster = {
    async post(channelId, body) {
      if (fail) throw new DiscordPostError(403);
      posts.push({ channelId, body });
    },
  };
  return { posts, poster };
}

beforeEach(async () => {
  env = createMemoryRepos();
  deps = { commands: commandsByName, components: componentHandlers, repos: env.repos };
  await run(slash(OWNER, 'club', 'registrar', [str('nombre', 'Club Prueba'), str('identificador', 'club-prueba')]));
  clubId = env.state.clubs[0]!.id;
  env.addMember(clubId, PLAYER.userId, 'jugador');
});

/** Convocatoria que empieza en `minutes` minutos. */
function callupIn(minutes: number) {
  env.state.callups.push({
    id: `00000000-0000-4000-9000-00000000000${env.state.callups.length + 1}`,
    clubId,
    title: 'Liga J1',
    opponent: null,
    startsAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    closesAt: null,
    status: 'abierta',
  });
  return env.state.callups.at(-1)!.id;
}

describe('/club recordatorios', () => {
  it('el admin los activa y avisa si falta el canal', async () => {
    const res = await run(slash(OWNER, 'club', 'recordatorios', [int('minutos', 60)]));
    expect(textOf(res)).toMatch('60 minutos antes');
    expect(textOf(res)).toMatch('Falta el canal');
    expect(env.state.clubs[0]!.reminderMinutes).toBe(60);
    await run(slash(OWNER, 'club', 'canal', [str('uso', 'convocatorias'), channel('canal', CHANNEL)]));
    expect(textOf(await run(slash(OWNER, 'club', 'recordatorios', [int('minutos', 30)])))).toMatch(`<#${CHANNEL}>`);
  });

  it('0 los desactiva; fuera de rango se rechaza; solo admin', async () => {
    expect(textOf(await run(slash(OWNER, 'club', 'recordatorios', [int('minutos', 0)])))).toMatch('desactivados');
    expect(env.state.clubs[0]!.reminderMinutes).toBeNull();
    expect(textOf(await run(slash(OWNER, 'club', 'recordatorios', [int('minutos', 5)])))).toMatch('entre 15 y 1440');
    expect(textOf(await run(slash(PLAYER, 'club', 'recordatorios', [int('minutos', 60)])))).toMatch('permiso');
  });
});

describe('runReminders', () => {
  beforeEach(async () => {
    await run(slash(OWNER, 'club', 'canal', [str('uso', 'convocatorias'), channel('canal', CHANNEL)]));
  });

  it('desactivados por defecto: no publica nada', async () => {
    callupIn(30);
    const { posts, poster } = fakePoster();
    expect(await runReminders({ repos: env.repos, poster, blockedGuilds: new Set() })).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(posts).toHaveLength(0);
  });

  it('publica una sola vez, con el tablero y mencionando solo a quien no respondió', async () => {
    env.state.clubs[0]!.reminderMinutes = 60;
    const id = callupIn(30);
    callupIn(600); // fuera de la ventana
    await run(button(OWNER, `callup:voy:club-prueba:${id}`));
    const { posts, poster } = fakePoster();
    expect(await runReminders({ repos: env.repos, poster, blockedGuilds: new Set() })).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(posts[0]!.channelId).toBe(CHANNEL);
    expect(posts[0]!.body.content).toMatch(`<@${PLAYER.userId}>`);
    expect(posts[0]!.body.content).not.toMatch(`<@${OWNER.userId}>`);
    expect(posts[0]!.body.allowed_mentions).toEqual({ parse: [], users: [PLAYER.userId] });
    expect((posts[0]!.body.components as unknown[]).length).toBe(1);
    expect(await runReminders({ repos: env.repos, poster, blockedGuilds: new Set() })).toEqual({ sent: 0, skipped: 0, failed: 0 });
  });

  it('nunca publica en servidores bloqueados ni en el de referencia', async () => {
    env.state.clubs[0]!.reminderMinutes = 60;
    callupIn(30);
    const { posts, poster } = fakePoster();
    expect((await runReminders({ repos: env.repos, poster, blockedGuilds: new Set([TEST_GUILD]) })).skipped).toBe(1);
    env.state.channels[0]!.guildId = REFERENCE_GUILD_ID;
    expect((await runReminders({ repos: env.repos, poster, blockedGuilds: new Set() })).skipped).toBe(1);
    expect(posts).toHaveLength(0);
  });

  it('un fallo al publicar se cuenta y no se reintenta en bucle', async () => {
    env.state.clubs[0]!.reminderMinutes = 60;
    callupIn(30);
    const { poster } = fakePoster(true);
    expect(await runReminders({ repos: env.repos, poster, blockedGuilds: new Set() })).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(await runReminders({ repos: env.repos, poster, blockedGuilds: new Set() })).toEqual({ sent: 0, skipped: 0, failed: 0 });
  });
});

describe('createDiscordPoster', () => {
  it('usa el token del bot y no lo expone en los errores', async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const ok = (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await createDiscordPoster('token-ficticio', ok).post(CHANNEL, { content: 'x' });
    expect(calls[0]).toEqual({ url: `https://discord.com/api/v10/channels/${CHANNEL}/messages`, auth: 'Bot token-ficticio' });

    const denied = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    const err = await createDiscordPoster('token-ficticio', denied).post(CHANNEL, {}).catch((e: Error) => e);
    expect(err).toBeInstanceOf(DiscordPostError);
    expect((err as Error).message).not.toMatch('token-ficticio');
    await expect(createDiscordPoster('t', ok).post('../evil', {})).rejects.toBeInstanceOf(DiscordPostError);
  });
});
