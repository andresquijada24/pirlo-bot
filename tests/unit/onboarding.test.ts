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
    const res = await onboardGuild({ repos: env.repos, api, blockedGuilds: new Set() }, input);
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
    expect(dms).toHaveLength(1);
    expect(dms[0]!.userId).toBe(USER);
    expect(String(dms[0]!.body.content)).toMatch('lacritas-fc');
    expect(dms[0]!.body.allowed_mentions).toEqual({ parse: [] });
  });

  it('es idempotente (Discord reintenta) y evita identificadores ocupados', async () => {
    const env = createMemoryRepos();
    const { api, dms } = fakeApi();
    await onboardGuild({ repos: env.repos, api, blockedGuilds: new Set() }, input);
    expect(await onboardGuild({ repos: env.repos, api, blockedGuilds: new Set() }, input)).toEqual({
      status: 'existente',
    });
    expect(dms).toHaveLength(1);
    const other = await onboardGuild(
      { repos: env.repos, api, blockedGuilds: new Set() },
      { ...input, guildId: '900000000000000002' },
    );
    expect(other).toMatchObject({ status: 'creado', slug: 'lacritas-fc-2' });
  });

  it('nunca actúa en el servidor de referencia ni en los bloqueados', async () => {
    const env = createMemoryRepos();
    const { api, dms } = fakeApi();
    const deps = { repos: env.repos, api, blockedGuilds: new Set([GUILD]) };
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
      onboarding: { api, blockedGuilds: new Set() },
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
    expect(dms).toHaveLength(1);
  });
});
