import { describe, expect, it } from 'vitest';
import { runAutoCrests } from '../../src/jobs/auto-crests.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';

const ICON = new Uint8Array([1, 2, 3]);

async function setup() {
  const env = createMemoryRepos();
  const reg = (slug: string, guildId: string) =>
    env.repos.clubs.register({
      guildId,
      guildName: null,
      slug,
      name: slug,
      adminDiscordId: '800000000000000001',
      adminDisplayName: 'Admin',
    });
  return { env, reg };
}

describe('escudo automático (ícono del servidor)', () => {
  it('pone el ícono del servidor propio y nunca usa servidores compartidos ni pisa un escudo', async () => {
    const { env, reg } = await setup();
    const solo = await reg('club-solo', '900000000000000001');
    const conEscudo = await reg('club-escudo', '900000000000000002');
    const compartido = await reg('club-comp', '900000000000000003');
    env.state.multiClubGuilds.add('900000000000000003');
    const otro = await reg('club-comp2', '900000000000000003');
    env.state.crests.set(conEscudo.clubId, 'subido-por-el-club');
    const asked: string[] = [];
    const res = await runAutoCrests({
      repos: env.repos,
      api: { guildIcon: async (id) => (asked.push(id), ICON) },
      normalize: async () => 'png-normalizado',
    });
    expect(env.state.crests.get(solo.clubId)).toBe('png-normalizado');
    expect(env.state.crests.get(conEscudo.clubId)).toBe('subido-por-el-club');
    expect(env.state.crests.has(compartido.clubId)).toBe(false);
    expect(env.state.crests.has(otro.clubId)).toBe(false);
    expect(asked).toEqual(['900000000000000001']);
    expect(res.saved).toBe(1);
  });

  it('sin ícono o con error no guarda nada', async () => {
    const { env, reg } = await setup();
    const a = await reg('club-a', '900000000000000011');
    await runAutoCrests({
      repos: env.repos,
      api: { guildIcon: async () => null },
      normalize: async () => 'x',
    });
    await runAutoCrests({
      repos: env.repos,
      api: { guildIcon: async () => ICON },
      normalize: async () => {
        throw new Error('imagen rota');
      },
    });
    expect(env.state.crests.has(a.clubId)).toBe(false);
  });
});
