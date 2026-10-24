import type { Repositories } from '../../db/repositories/types.js';
import { conflict, notFound, permissionDenied, validation } from '../errors.js';
import { assertCan, assertCanManageMember, can } from '../permissions/index.js';
import type { ClubContext, ClubRole, LinkRequest, Membership, PositionCode } from '../types.js';
import { displayNameSchema, gamertagSchema, parse } from '../validation.js';

type Repos = Pick<Repositories, 'memberships' | 'linkRequests' | 'audit'>;

/** Un usuario de Discord pide unirse a la plantilla del club. */
export async function requestLink(
  repos: Repos,
  ctx: ClubContext,
  input: { displayName: string; eaGamertag?: string | null },
): Promise<LinkRequest> {
  assertCan(ctx, 'link.request');
  if (ctx.membership) throw conflict('Ya formas parte de la plantilla de este club.');
  return repos.linkRequests.create(ctx.club.id, {
    discordUserId: ctx.actor.discordUserId,
    displayName: parse(displayNameSchema, input.displayName),
    eaGamertag: parse(gamertagSchema, input.eaGamertag ?? null),
  });
}

export async function listPendingLinks(repos: Repos, ctx: ClubContext): Promise<LinkRequest[]> {
  assertCan(ctx, 'link.approve');
  return repos.linkRequests.listPending(ctx.club.id);
}

/** Aprueba una solicitud. Un DT solo puede incorporar con roles inferiores al suyo. */
export async function approveLink(
  repos: Repos,
  ctx: ClubContext,
  requestId: string,
  role: ClubRole = 'jugador',
): Promise<{ membershipId: string }> {
  assertCan(ctx, 'link.approve');
  // Un recién llegado no tiene rango previo: se valida solo el rol que se le otorga.
  assertCanManageMember(ctx, { role: 'jugador' }, role);
  const request = await repos.linkRequests.findById(ctx.club.id, requestId);
  if (!request) throw notFound('Solicitud');
  if (request.status !== 'pendiente') throw conflict('Esa solicitud ya fue resuelta.');
  return repos.linkRequests.approve(ctx.club.id, requestId, ctx.actor.discordUserId, role);
}

export async function rejectLink(repos: Repos, ctx: ClubContext, requestId: string): Promise<void> {
  assertCan(ctx, 'link.approve');
  const request = await repos.linkRequests.findById(ctx.club.id, requestId);
  if (!request) throw notFound('Solicitud');
  if (request.status !== 'pendiente') throw conflict('Esa solicitud ya fue resuelta.');
  await repos.linkRequests.reject(ctx.club.id, requestId, ctx.actor.discordUserId);
  await repos.audit.log({
    clubId: ctx.club.id,
    actorDiscordId: ctx.actor.discordUserId,
    action: 'link.reject',
    entity: 'link_request',
    entityId: requestId,
  });
}

export async function listRoster(repos: Repos, ctx: ClubContext): Promise<Membership[]> {
  assertCan(ctx, 'roster.view');
  return repos.memberships.listActive(ctx.club.id);
}

async function getMember(repos: Repos, ctx: ClubContext, membershipId: string) {
  const m = await repos.memberships.findActiveById(ctx.club.id, membershipId);
  if (!m) throw notFound('Miembro');
  return m;
}

/** El club nunca puede quedarse sin ningún admin. */
async function assertNotLastAdmin(repos: Repos, ctx: ClubContext, target: Membership) {
  if (target.role !== 'admin') return;
  if ((await repos.memberships.countActiveAdmins(ctx.club.id)) <= 1) {
    throw conflict('El club debe tener al menos un admin. Nombra otro admin antes.');
  }
}

export async function assignRole(
  repos: Repos,
  ctx: ClubContext,
  membershipId: string,
  role: ClubRole,
): Promise<void> {
  assertCan(ctx, 'role.assign');
  const target = await getMember(repos, ctx, membershipId);
  assertCanManageMember(ctx, target, role);
  if (target.role === role) return;
  if (role !== 'admin') await assertNotLastAdmin(repos, ctx, target);
  await repos.memberships.updateRole(ctx.club.id, membershipId, role);
  await repos.audit.log({
    clubId: ctx.club.id,
    actorDiscordId: ctx.actor.discordUserId,
    action: 'member.role',
    entity: 'membership',
    entityId: membershipId,
    details: { from: target.role, to: role },
  });
}

/** Cada jugador puede editar sus propias posiciones; DT y admin, las de los demás. */
export async function setPositions(
  repos: Repos,
  ctx: ClubContext,
  membershipId: string,
  positions: PositionCode[],
): Promise<void> {
  const target = await getMember(repos, ctx, membershipId);
  const isSelf = ctx.membership?.id === target.id;
  if (!isSelf) {
    if (!can(ctx, 'roster.manage')) throw permissionDenied();
    assertCanManageMember(ctx, target);
  }
  const unique = [...new Set(positions)];
  await repos.memberships.updatePositions(ctx.club.id, membershipId, unique);
}

/** Da de baja a un miembro (conserva su historial). */
export async function removeMember(
  repos: Repos,
  ctx: ClubContext,
  membershipId: string,
): Promise<void> {
  assertCan(ctx, 'roster.manage');
  const target = await getMember(repos, ctx, membershipId);
  assertCanManageMember(ctx, target);
  await assertNotLastAdmin(repos, ctx, target);
  await repos.memberships.end(ctx.club.id, membershipId);
  await repos.audit.log({
    clubId: ctx.club.id,
    actorDiscordId: ctx.actor.discordUserId,
    action: 'member.remove',
    entity: 'membership',
    entityId: membershipId,
  });
}

/**
 * Vincula a un miembro con su gamertag del proveedor (p. ej. Marítimo) para asignarle sus
 * estadísticas. Solo DT o admin, y respetando la jerarquía (un DT no reasigna a otro DT).
 * Devuelve cuántas fichas externas se vincularon: 0 significa que el proveedor todavía no
 * informó ese gamertag; se vinculará solo cuando llegue.
 */
export async function linkGamertag(
  repos: Pick<Repositories, 'memberships' | 'externalPlayers'>,
  ctx: ClubContext,
  membershipId: string,
  gamertag: string,
): Promise<{ target: Membership; gamertag: string; linked: number }> {
  assertCan(ctx, 'roster.manage');
  const target = await repos.memberships.findActiveById(ctx.club.id, membershipId);
  if (!target) throw notFound('Miembro');
  if (target.id !== ctx.membership?.id) assertCanManageMember(ctx, target);
  const gt = parse(gamertagSchema, gamertag);
  if (!gt) throw validation('Indica un gamertag.');
  const linked = await repos.externalPlayers.linkGamertag(
    ctx.club.id,
    target.playerId,
    gt,
    ctx.actor.discordUserId,
  );
  return { target, gamertag: gt, linked };
}
