import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  onboardGuild,
  purposeForChannel,
  slugFromName,
  type GuildApi,
} from '../../src/discord/onboarding.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';
import { createTestSigner } from '../helpers/keys.js';

const GUILD = '900000000000000001';
const USER = '800000000000000009';
const OWNER = '800000000000000777';
const OWNERS = new Set([OWNER]);

function fakeApi(channels: { id: string; name: string }[] = []) {
  const dms: { userId: string; body: Record<string, unknown> }[] = [];
  const api: GuildApi = {
    textChannels: async () => channels,
    dm: async (userId, body) => {
      dms.push({ userId, body });
    },
  };
  return { api, dms };
}

const input = { guildId: GUILD, guildName: 'Lácritas FC ⚽', userId: USER, userName: 'Andrés' };

describe('alta automática al instalar el bot', () => {
  it('identificador y propósito de canal a partir de nombres', () => {
    expect(slugFromName('Lácritas FC ⚽')).toBe('lacritas-fc');
    expect(slugFromName('⚽⚽')).toBe('');
    expect(purposeForChannel('📢-anuncios')).toBe('anuncios');
    expect(purposeForChannel('resultados-ea')).toBe('resultados');
    expect(purposeForChannel('general')).toBeNull();
  });

  it('crea el club, hace admin a quien instaló, detecta canales y le da la bienvenida por privado', async () => {
    const env = createMemoryRepos();
    const { api, dms } = fakeApi([
      { id: '700000000000000001', name: '📢-anuncios' },
      { id: '700000000000000002', name: 'resultados' },
      { id: '700000000000000003', name: 'general' },
    ]);
    const res = await onboardGuild(
      { repos: env.repos, api, blockedGuilds: new Set(), ownerIds: OWNERS },
      input,
    );
    expect(res).toEqual({
      status: 'creado',
      slug: 'lacritas-fc',
      channels: ['anuncios', 'resultados'],
    });
    const club = (await env.repos.clubs.listByGuild(GUILD))[0]!;
    expect(club.name).toBe('Lácritas FC ⚽');
    expect((await env.repos.memberships.findActiveByDiscordUser(club.id, USER))?.role).toBe(
      'admin',
    );
    expect((await env.repos.channels.list(club.id)).map((c) => c.purpose).sort()).toEqual([
      'anuncios',
      'resultados',
    ]);
    // Queda pendiente: el dueño recibe los botones y quien instaló, la bienvenida.
    expect(club.status).toBe('pendiente');
    expect(dms.map((d) => d.userId)).toEqual([OWNER, USER]);
    expect(JSON.stringify(dms[0]!.body.components)).toMatch(`owner:approve:${club.id}:${USER}`);
    expect(String(dms[1]!.body.content)).toMatch('lacritas-fc');
    expect(String(dms[1]!.body.content)).toMatch('aprobación');
    for (const d of dms) expect(d.body.allowed_mentions).toEqual({ parse: [] });
  });

  it('es idempotente (Discord reintenta) y evita identificadores ocupados', async () => {
    const env = createMemoryRepos();
    const { api, dms } = fakeApi();
    await onboardGuild(
      { repos: env.repos, api, blockedGuilds: new Set(), ownerIds: OWNERS },
      input,
    );
    expect(
      await onboardGuild(
        { repos: env.repos, api, blockedGuilds: new Set(), ownerIds: OWNERS },
        input,
      ),
    ).toEqual({
      status: 'existente',
    });
    expect(dms).toHaveLength(2);
    const other = await onboardGuild(
      { repos: env.repos, api, blockedGuilds: new Set(), ownerIds: OWNERS },
      { ...input, guildId: '900000000000000002' },
    );
    expect(other).toMatchObject({ status: 'creado', slug: 'lacritas-fc-2' });
  });

  it('nunca actúa en el servidor de referencia ni en los bloqueados', async () => {
    const env = createMemoryRepos();
    const { api, dms } = fakeApi();
    const deps = { repos: env.repos, api, blockedGuilds: new Set([GUILD]), ownerIds: OWNERS };
    expect(await onboardGuild(deps, input)).toEqual({ status: 'bloqueado' });
    expect(await onboardGuild(deps, { ...input, guildId: '853894813169614848' })).toEqual({
      status: 'bloqueado',
    });
    expect(env.state.clubs).toHaveLength(0);
    expect(dms).toHaveLength(0);
  });
});

describe('POST /api/discord/events', () => {
  async function setup() {
    const signer = await createTestSigner();
    const env = createMemoryRepos();
    const { api, dms } = fakeApi();
    const app = createApp({
      discordPublicKey: signer.publicKey,
      repos: env.repos,
      onboarding: { api, blockedGuilds: new Set(), ownerIds: OWNERS },
    });
    const post = async (payload: unknown, tamper = false) => {
      const body = JSON.stringify(payload);
      const { signature, timestamp } = await signer.sign(body);
      return app.request('/api/discord/events', {
        method: 'POST',
        body: tamper ? body + ' ' : body,
        headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
      });
    };
    return { env, dms, post };
  }
  const authorized = (integrationType: number) => ({
    version: 1,
    application_id: '1562889315657195530',
    type: 1,
    event: {
      type: 'APPLICATION_AUTHORIZED',
      timestamp: '2026-10-26T04:00:00Z',
      data: {
        integration_type: integrationType,
        scopes: ['bot', 'applications.commands'],
        user: { id: USER, username: 'andres', global_name: 'Andrés' },
        guild: { id: GUILD, name: 'Club Nuevo' },
      },
    },
  });

  it('PING firmado → 204; firma inválida → 401', async () => {
    const { post } = await setup();
    expect((await post({ version: 1, type: 0 })).status).toBe(204);
    expect((await post({ version: 1, type: 0 }, true)).status).toBe(401);
  });

  it('instalación en un servidor crea el club; en una cuenta de usuario no', async () => {
    const { post, env, dms } = await setup();
    expect((await post(authorized(1))).status).toBe(204);
    expect(env.state.clubs).toHaveLength(0);
    expect((await post(authorized(0))).status).toBe(204);
    expect(env.state.clubs.map((c) => c.slug)).toEqual(['club-nuevo']);
    expect(dms).toHaveLength(2);
  });
});

describe('aprobación final del dueño', () => {
  async function pending() {
    const signer = await createTestSigner();
    const env = createMemoryRepos();
    const { api, dms } = fakeApi();
    await onboardGuild(
      { repos: env.repos, api, blockedGuilds: new Set(), ownerIds: OWNERS },
      input,
    );
    const app = createApp({
      discordPublicKey: signer.publicKey,
      repos: env.repos,
      onboarding: { api, blockedGuilds: new Set(), ownerIds: OWNERS },
    });
    const club = env.state.clubs[0]!;
    const click = async (userId: string, action: string) => {
      const body = JSON.stringify({
        type: 3,
        id: '1',
        application_id: '1562889315657195530',
        token: 't',
        version: 1,
        user: { id: userId, username: 'x' },
        message: { id: '2' },
        data: { component_type: 2, custom_id: `owner:${action}:${club.id}:${USER}` },
      });
      const { signature, timestamp } = await signer.sign(body);
      const res = await app.request('/api/interactions', {
        method: 'POST',
        body,
        headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
      });
      return (await res.json()) as { type: number; data?: { content?: string; embeds?: { description?: string }[] } };
    };
    return { env, dms, club, click };
  }

  it('un club pendiente no responde comandos', async () => {
    const { env } = await pending();
    const { resolveClub } = await import('../../src/core/context.js');
    await expect(resolveClub(env.repos, GUILD)).rejects.toThrow('pendiente de aprobación');
  });

  it('solo el dueño aprueba; el solicitante recibe el aviso', async () => {
    const { club, click, dms } = await pending();
    const denied = await click(USER, 'approve');
    expect(denied.data?.embeds?.[0]?.description).toMatch('Solo el dueño');
    expect(club.status).toBe('pendiente');
    const ok = await click(OWNER, 'approve');
    expect(ok.type).toBe(7);
    expect(ok.data?.content).toMatch('aprobado');
    expect(club.status).toBe('activo');
    expect(dms.at(-1)!.userId).toBe(USER);
    expect(String(dms.at(-1)!.body.content)).toMatch('fue aprobado');
  });

  it('rechazar deja el club rechazado', async () => {
    const { club, click } = await pending();
    await click(OWNER, 'reject');
    expect(club.status).toBe('rechazado');
  });
});

describe('club pedido desde otro servidor', () => {
  it('explica qué club hay aquí, sin decir dónde está el otro; acepta mayúsculas y el nombre', async () => {
    const { createMemoryRepos } = await import('../fakes/memory-repos.js');
    const { resolveClub } = await import('../../src/core/context.js');
    const env = createMemoryRepos();
    await env.repos.clubs.register({
      guildId: '900000000000000071', guildName: null, slug: 'club-prueba', name: 'Club Prueba',
      adminDiscordId: '800000000000000001', adminDisplayName: 'Admin',
    });
    await env.repos.clubs.register({
      guildId: '900000000000000072', guildName: null, slug: 'lacritas-fc', name: 'LACRITAS FC',
      adminDiscordId: '800000000000000001', adminDisplayName: 'Admin',
    });
    const err = await resolveClub(env.repos, '900000000000000071', 'lacritas-fc').catch((e: Error) => e);
    expect(String((err as Error).message)).toMatch('aquí solo está **Club Prueba** (`club-prueba`)');
    expect(String((err as Error).message)).not.toMatch('900000000000000072');
    expect((await resolveClub(env.repos, '900000000000000072', 'LACRITAS FC')).slug).toBe('lacritas-fc');
    expect((await resolveClub(env.repos, '900000000000000072', 'LACRITAS-FC')).slug).toBe('lacritas-fc');
  });
});
