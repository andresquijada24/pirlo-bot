import type { Repositories } from '../../db/repositories/types.js';
import { DomainError, validation } from '../errors.js';
import { assertCan, can } from '../permissions/index.js';
import type { Callup, CallupAnswer, ClubContext, Lineup, Membership, PositionCode } from '../types.js';
import { formationLines, formationSlots, isFormation, type Formation } from './formations.js';

type Repos = Pick<Repositories, 'callups' | 'lineups' | 'memberships'>;

/** Convocatoria a la que se refieren los comandos de alineación: la próxima (abierta o cerrada). */
export async function targetCallup(repos: Repos, ctx: ClubContext): Promise<Callup> {
  const callup = await repos.callups.next(ctx.club.id);
  if (!callup) {
    throw new DomainError('NOT_FOUND', 'No hay ninguna convocatoria próxima. Crea una con /convocatoria crear.');
  }
  return callup;
}

async function requireLineup(repos: Repos, ctx: ClubContext, callup: Callup): Promise<Lineup> {
  const lineup = await repos.lineups.findByCallup(ctx.club.id, callup.id);
  if (!lineup) throw new DomainError('NOT_FOUND', 'Esa convocatoria aún no tiene alineación. Usa /alineacion crear.');
  return lineup;
}

async function memberByDiscord(repos: Repos, ctx: ClubContext, discordUserId: string): Promise<Membership> {
  const m = await repos.memberships.findActiveByDiscordUser(ctx.club.id, discordUserId);
  if (!m) throw new DomainError('NOT_FOUND', 'Ese usuario no forma parte de la plantilla.');
  return m;
}

export async function createLineup(
  repos: Repos,
  ctx: ClubContext,
  formation: string,
  replace: boolean,
): Promise<{ callup: Callup; lineup: Lineup }> {
  assertCan(ctx, 'lineup.manage');
  if (!isFormation(formation)) throw validation('Formación no disponible.');
  const callup = await targetCallup(repos, ctx);
  await repos.lineups.create(
    ctx.club.id,
    { callupId: callup.id, formation, positions: formationSlots(formation), replace },
    ctx.actor.discordUserId,
  );
  return { callup, lineup: await requireLineup(repos, ctx, callup) };
}

export async function assignPlayer(
  repos: Repos,
  ctx: ClubContext,
  discordUserId: string,
  target: { position: PositionCode } | { substitute: true },
): Promise<{ callup: Callup; lineup: Lineup; member: Membership }> {
  assertCan(ctx, 'lineup.manage');
  const callup = await targetCallup(repos, ctx);
  const lineup = await requireLineup(repos, ctx, callup);
  const member = await memberByDiscord(repos, ctx, discordUserId);
  await repos.lineups.assign(ctx.club.id, lineup.id, member.playerId, target);
  return { callup, lineup: await requireLineup(repos, ctx, callup), member };
}

export async function removePlayer(
  repos: Repos,
  ctx: ClubContext,
  discordUserId: string,
): Promise<{ callup: Callup; lineup: Lineup; member: Membership; removed: boolean }> {
  assertCan(ctx, 'lineup.manage');
  const callup = await targetCallup(repos, ctx);
  const lineup = await requireLineup(repos, ctx, callup);
  const member = await memberByDiscord(repos, ctx, discordUserId);
  const removed = await repos.lineups.remove(ctx.club.id, lineup.id, member.playerId);
  return { callup, lineup: await requireLineup(repos, ctx, callup), member, removed };
}

export async function publishLineup(repos: Repos, ctx: ClubContext): Promise<{ callup: Callup; lineup: Lineup }> {
  assertCan(ctx, 'lineup.manage');
  const callup = await targetCallup(repos, ctx);
  const lineup = await requireLineup(repos, ctx, callup);
  if (!lineup.slots.some((s) => s.playerId)) throw validation('La alineación está vacía: pon al menos un jugador.');
  await repos.lineups.publish(ctx.club.id, lineup.id, ctx.actor.discordUserId);
  return { callup, lineup: await requireLineup(repos, ctx, callup) };
}

/** Alineación de la próxima convocatoria. Un borrador solo lo ve quien puede gestionarlo. */
export async function viewLineup(repos: Repos, ctx: ClubContext): Promise<{ callup: Callup; lineup: Lineup }> {
  const callup = await targetCallup(repos, ctx);
  const lineup = await requireLineup(repos, ctx, callup);
  if (lineup.status === 'borrador' && !can(ctx, 'lineup.manage')) {
    throw new DomainError('NOT_FOUND', 'La alineación todavía no se ha publicado.');
  }
  return { callup, lineup };
}

export interface LineupView {
  formation: string;
  /** Líneas de delante hacia atrás (la delantera primero, el portero al final). */
  lines: { position: PositionCode | null; member: Membership | null; answer: CallupAnswer | null }[][];
  substitutes: { member: Membership | null; answer: CallupAnswer | null }[];
  /** Titulares o suplentes que no dijeron "Voy" en la convocatoria. */
  warnings: Membership[];
  filled: number;
}

/** Prepara la alineación para mostrarla, con los nombres de la plantilla y sus respuestas. */
export async function buildLineupView(
  repos: Repos,
  ctx: ClubContext,
  callup: Callup,
  lineup: Lineup,
): Promise<LineupView> {
  const [roster, responses] = await Promise.all([
    repos.memberships.listActive(ctx.club.id),
    repos.callups.responses(ctx.club.id, callup.id),
  ]);
  const byPlayer = new Map(roster.map((m) => [m.playerId, m]));
  const answerOf = new Map(responses.map((r) => [r.playerId, r.answer]));
  const slotOf = new Map(lineup.slots.map((s) => [s.slot, s]));
  const entry = (playerId: string | null) => ({
    member: playerId ? (byPlayer.get(playerId) ?? null) : null,
    answer: playerId ? (answerOf.get(playerId) ?? null) : null,
  });

  const shape: number[][] = isFormation(lineup.formation)
    ? formationLines(lineup.formation as Formation)
    : [lineup.slots.filter((s) => !s.substitute).map((s) => s.slot)];
  const lines = shape
    .map((slots) =>
      slots.map((n) => {
        const s = slotOf.get(n);
        return { position: s?.position ?? null, ...entry(s?.playerId ?? null) };
      }),
    )
    .reverse();
  const substitutes = lineup.slots.filter((s) => s.substitute).map((s) => entry(s.playerId));
  const placed = [...lines.flat(), ...substitutes];
  return {
    formation: lineup.formation,
    lines,
    substitutes,
    warnings: placed.filter((p) => p.member && p.answer !== 'voy').map((p) => p.member as Membership),
    filled: lines.flat().filter((p) => p.member).length,
  };
}
