import { beforeEach, describe, expect, it } from 'vitest';
import { configureChannel, registerClub } from '../../src/core/clubs/service.js';
import { resolveContext } from '../../src/core/context.js';
import {
  approveLink,
  assignRole,
  listRoster,
  rejectLink,
  removeMember,
  requestLink,
  setPositions,
} from '../../src/core/roster/service.js';
import { createSeason, setSeasonDates } from '../../src/core/seasons/service.js';
import type { SessionStatRow } from '../../src/core/stats/service.js';
import { calendarDateSchema } from '../../src/core/validation.js';
import type { Actor } from '../../src/core/types.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';

// Identificadores de prueba (no son servidores ni usuarios reales).
const GUILD_A = '900000000000000001';
const GUILD_B = '900000000000000002';
const actor = (n: number, guildId = GUILD_A, isGuildManager = false): Actor => ({
  discordUserId: `80000000000000000${n}`,
  displayName: `Usuario ${n}`,
  guildId,
  isGuildManager,
});

let env: ReturnType<typeof createMemoryRepos>;
beforeEach(() => {
  env = createMemoryRepos();
});

async function setupClub(guildId = GUILD_A, slug = 'club-a') {
  const owner = actor(1, guildId, true);
  const res = await registerClub(env.repos, owner, { slug, name: 'Club', guildName: null });
  return { owner, ...res };
}

describe('registro de clubes', () => {
  it('solo el gestor del servidor puede registrar un club', async () => {
    await expect(
      registerClub(env.repos, actor(2), { slug: 'x', name: 'X', guildName: null }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('valida y normaliza el identificador', async () => {
    const r = await registerClub(env.repos, actor(1, GUILD_A, true), {
      slug: '  Maritimo-CF ',
      name: 'Marítimo CF',
      guildName: null,
    });
    expect(r.slug).toBe('maritimo-cf');
    await expect(
      registerClub(env.repos, actor(1, GUILD_B, true), { slug: 'con espacios', name: 'X', guildName: null }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('quien registra queda como admin del club', async () => {
    const { owner } = await setupClub();
    const ctx = await resolveContext(env.repos, { ...owner, isGuildManager: false });
    expect(ctx.membership?.role).toBe('admin');
  });
});

describe('resolución del club', () => {
  it('avisa si el servidor no tiene club', async () => {
    await expect(resolveContext(env.repos, actor(2))).rejects.toMatchObject({
      code: 'CLUB_NOT_REGISTERED',
    });
  });

  it('en modalidad multiclub exige indicar el club', async () => {
    env.state.multiClubGuilds.add(GUILD_A);
    await setupClub(GUILD_A, 'club-a');
    await setupClub(GUILD_A, 'club-b');
    await expect(resolveContext(env.repos, actor(2))).rejects.toMatchObject({
      code: 'CLUB_AMBIGUOUS',
    });
    const ctx = await resolveContext(env.repos, actor(2), 'club-b');
    expect(ctx.club.slug).toBe('club-b');
  });

  it('sin modalidad multiclub no se puede registrar un segundo club', async () => {
    await setupClub(GUILD_A, 'club-a');
    await expect(
      registerClub(env.repos, actor(1, GUILD_A, true), { slug: 'club-b', name: 'B', guildName: null }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('desde un servidor no se puede operar sobre el club de otro servidor', async () => {
    await setupClub(GUILD_A, 'club-a');
    await setupClub(GUILD_B, 'club-b');
    await expect(resolveContext(env.repos, actor(3, GUILD_A), 'club-b')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('vinculación de jugadores', () => {
  it('flujo completo: solicitud → aprobación del DT → miembro', async () => {
    const { clubId } = await setupClub();
    env.addMember(clubId, actor(5).discordUserId, 'dt');

    const req = await requestLink(env.repos, await resolveContext(env.repos, actor(2)), {
      displayName: 'Jugador Dos',
      eaGamertag: 'JD2',
    });
    const dtCtx = await resolveContext(env.repos, actor(5));
    await approveLink(env.repos, dtCtx, req.id);

    const ctx2 = await resolveContext(env.repos, actor(2));
    expect(ctx2.membership?.role).toBe('jugador');
  });

  it('un jugador no puede aprobar solicitudes', async () => {
    const { clubId } = await setupClub();
    env.addMember(clubId, actor(4).discordUserId, 'jugador');
    const req = await requestLink(env.repos, await resolveContext(env.repos, actor(2)), {
      displayName: 'X',
    });
    await expect(
      approveLink(env.repos, await resolveContext(env.repos, actor(4)), req.id),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('un DT no puede incorporar a alguien directamente como DT', async () => {
    const { clubId } = await setupClub();
    env.addMember(clubId, actor(5).discordUserId, 'dt');
    const req = await requestLink(env.repos, await resolveContext(env.repos, actor(2)), {
      displayName: 'X',
    });
    await expect(
      approveLink(env.repos, await resolveContext(env.repos, actor(5)), req.id, 'dt'),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('un miembro no puede volver a solicitar unirse', async () => {
    const { owner } = await setupClub();
    await expect(
      requestLink(env.repos, await resolveContext(env.repos, { ...owner, isGuildManager: false }), {
        displayName: 'X',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('un club no puede aprobar solicitudes de otro club', async () => {
    await setupClub(GUILD_A, 'club-a');
    await setupClub(GUILD_B, 'club-b');
    const reqB = await requestLink(env.repos, await resolveContext(env.repos, actor(7, GUILD_B)), {
      displayName: 'X',
    });
    const adminA = await resolveContext(env.repos, actor(1, GUILD_A, true));
    await expect(approveLink(env.repos, adminA, reqB.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(rejectLink(env.repos, adminA, reqB.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('una solicitud rechazada no se puede aprobar después', async () => {
    const { owner } = await setupClub();
    const req = await requestLink(env.repos, await resolveContext(env.repos, actor(2)), {
      displayName: 'X',
    });
    const adminCtx = await resolveContext(env.repos, owner);
    await rejectLink(env.repos, adminCtx, req.id);
    await expect(approveLink(env.repos, adminCtx, req.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('gestión de la plantilla', () => {
  it('un DT puede nombrar capitán a un jugador', async () => {
    const { clubId } = await setupClub();
    env.addMember(clubId, actor(5).discordUserId, 'dt');
    const p = env.addMember(clubId, actor(6).discordUserId, 'jugador');
    await assignRole(env.repos, await resolveContext(env.repos, actor(5)), p.id, 'capitan');
    expect((await env.repos.memberships.findActiveById(clubId, p.id))?.role).toBe('capitan');
    expect(env.state.audit.some((a) => a.action === 'member.role')).toBe(true);
  });

  it('el club no puede quedarse sin admins', async () => {
    const { owner, membershipId } = await setupClub();
    const ctx = await resolveContext(env.repos, { ...owner, isGuildManager: false });
    await expect(assignRole(env.repos, ctx, membershipId, 'dt')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(removeMember(env.repos, ctx, membershipId)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('con dos admins, uno puede dejar el rol', async () => {
    const { clubId, owner, membershipId } = await setupClub();
    env.addMember(clubId, actor(9).discordUserId, 'admin');
    const ctx = await resolveContext(env.repos, { ...owner, isGuildManager: false });
    await assignRole(env.repos, ctx, membershipId, 'jugador');
    expect(await env.repos.memberships.countActiveAdmins(clubId)).toBe(1);
  });

  it('un jugador puede editar sus posiciones pero no las de otros', async () => {
    const { clubId } = await setupClub();
    const me = env.addMember(clubId, actor(6).discordUserId, 'jugador');
    const other = env.addMember(clubId, actor(7).discordUserId, 'jugador');
    const ctx = await resolveContext(env.repos, actor(6));
    await setPositions(env.repos, ctx, me.id, ['MC', 'MCO', 'MC']);
    expect((await env.repos.memberships.findActiveById(clubId, me.id))?.positions).toEqual(['MC', 'MCO']);
    await expect(setPositions(env.repos, ctx, other.id, ['DC'])).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('dar de baja conserva el historial y saca al miembro de la plantilla', async () => {
    const { clubId, owner } = await setupClub();
    const p = env.addMember(clubId, actor(6).discordUserId, 'jugador');
    const ctx = await resolveContext(env.repos, owner);
    await removeMember(env.repos, ctx, p.id);
    expect((await listRoster(env.repos, ctx)).some((m) => m.id === p.id)).toBe(false);
    expect(env.state.memberships.some((m) => m.id === p.id)).toBe(true);
  });

  it('quien no es miembro no ve la plantilla', async () => {
    await setupClub();
    await expect(listRoster(env.repos, await resolveContext(env.repos, actor(2)))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('no se puede gestionar a un miembro de otro club', async () => {
    const a = await setupClub(GUILD_A, 'club-a');
    const b = await setupClub(GUILD_B, 'club-b');
    const ctxA = await resolveContext(env.repos, a.owner);
    await expect(assignRole(env.repos, ctxA, b.membershipId, 'jugador')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('configuración y temporadas', () => {
  it('solo un admin configura canales y queda auditado', async () => {
    const { clubId, owner } = await setupClub();
    env.addMember(clubId, actor(5).discordUserId, 'dt');
    await expect(
      configureChannel(env.repos, await resolveContext(env.repos, actor(5)), 'anuncios', '7'.repeat(18)),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    await configureChannel(env.repos, await resolveContext(env.repos, owner), 'anuncios', '7'.repeat(18));
    expect(await env.repos.channels.list(clubId)).toEqual([
      { purpose: 'anuncios', channelId: '7'.repeat(18), guildId: '900000000000000001' },
    ]);
    expect(env.state.audit.some((a) => a.action === 'club.channel.set')).toBe(true);
  });

  it('rechaza identificadores de canal inválidos', async () => {
    const { owner } = await setupClub();
    await expect(
      configureChannel(env.repos, await resolveContext(env.repos, owner), 'anuncios', 'abc'),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('crear una temporada actual desmarca la anterior', async () => {
    const { clubId, owner } = await setupClub();
    const ctx = await resolveContext(env.repos, owner);
    await createSeason(env.repos, ctx, { name: 'T1', makeCurrent: true });
    await createSeason(env.repos, ctx, { name: 'T2', makeCurrent: true });
    const seasons = await env.repos.seasons.list(clubId);
    expect(seasons.filter((s) => s.isCurrent).map((s) => s.name)).toEqual(['T2']);
  });

  it('un DT no puede crear temporadas', async () => {
    const { clubId } = await setupClub();
    env.addMember(clubId, actor(5).discordUserId, 'dt');
    await expect(
      createSeason(env.repos, await resolveContext(env.repos, actor(5)), { name: 'T1', makeCurrent: true }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('fechas de temporada', () => {
  // Fila mínima de prueba: solo importan club, temporada y fecha.
  const row = (clubId: string, playedOn: string) => ({
    ...({} as SessionStatRow),
    clubId,
    seasonId: null,
    playedOn,
  });

  it('acepta DD/MM/AAAA y AAAA-MM-DD y rechaza fechas que no existen', () => {
    expect(calendarDateSchema.parse('18/09/2026')).toBe('2026-09-18');
    expect(calendarDateSchema.parse('2026-09-18')).toBe('2026-09-18');
    expect(calendarDateSchema.parse(' 1/2/2027 ')).toBe('2027-02-01');
    for (const bad of ['31/02/2026', '2026-13-01', 'ayer', '18-09-2026', '']) {
      expect(calendarDateSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('pone el inicio a la temporada actual y reasigna las sesiones desde esa fecha', async () => {
    const { clubId, owner } = await setupClub();
    const ctx = await resolveContext(env.repos, owner);
    await createSeason(env.repos, ctx, { name: 'Temporada 1', makeCurrent: true });
    env.state.sessionRows.push(row(clubId, '2026-09-17'), row(clubId, '2026-09-18'), row(clubId, '2026-10-23'));

    const res = await setSeasonDates(env.repos, ctx, { startsOn: '18/09/2026' });
    expect(res.moved).toBe(2);
    expect(res.season).toMatchObject({ name: 'Temporada 1', startsOn: '2026-09-18', endsOn: null });
    const [s] = await env.repos.seasons.list(clubId);
    expect(s?.startsOn).toBe('2026-09-18');
    expect(env.state.sessionRows.filter((r) => r.seasonId === s?.id)).toHaveLength(2);
  });

  it('busca la temporada por nombre sin distinguir mayúsculas', async () => {
    const { owner } = await setupClub();
    const ctx = await resolveContext(env.repos, owner);
    await createSeason(env.repos, ctx, { name: 'T1', makeCurrent: false });
    await createSeason(env.repos, ctx, { name: 'T2', makeCurrent: true });
    const res = await setSeasonDates(env.repos, ctx, { seasonName: ' t1 ', startsOn: '2026-01-01', endsOn: '2026-06-30' });
    expect(res.season).toMatchObject({ name: 'T1', startsOn: '2026-01-01', endsOn: '2026-06-30' });
  });

  it('rechaza un fin anterior al inicio, una temporada inexistente y fechas que se cruzan', async () => {
    const { owner } = await setupClub();
    const ctx = await resolveContext(env.repos, owner);
    await createSeason(env.repos, ctx, { name: 'T1', makeCurrent: true });
    await expect(
      setSeasonDates(env.repos, ctx, { startsOn: '2026-10-01', endsOn: '2026-09-01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      setSeasonDates(env.repos, ctx, { seasonName: 'No existe', startsOn: '2026-10-01' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await setSeasonDates(env.repos, ctx, { startsOn: '2026-09-18' });
    await createSeason(env.repos, ctx, { name: 'T2', makeCurrent: false });
    await expect(
      setSeasonDates(env.repos, ctx, { seasonName: 'T2', startsOn: '2026-10-01' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('sin temporada actual pide el nombre', async () => {
    const { owner } = await setupClub();
    const ctx = await resolveContext(env.repos, owner);
    await expect(setSeasonDates(env.repos, ctx, { startsOn: '2026-09-18' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('un DT no puede cambiar las fechas', async () => {
    const { clubId, owner } = await setupClub();
    await createSeason(env.repos, await resolveContext(env.repos, owner), { name: 'T1', makeCurrent: true });
    env.addMember(clubId, actor(5).discordUserId, 'dt');
    await expect(
      setSeasonDates(env.repos, await resolveContext(env.repos, actor(5)), { startsOn: '2026-09-18' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
