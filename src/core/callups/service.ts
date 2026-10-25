import type { Repositories } from '../../db/repositories/types.js';
import { DomainError, notFound, validation } from '../errors.js';
import { assertCan } from '../permissions/index.js';
import { isValidTimeZone, parseLocalDateTime } from '../time.js';
import type { Callup, CallupAnswer, ClubContext, Membership } from '../types.js';

type Repos = Pick<Repositories, 'callups' | 'memberships'>;

/** Máximo de minutos de antelación con que se puede cerrar una convocatoria (7 días). */
export const MAX_CLOSE_BEFORE_MINUTES = 7 * 24 * 60;

export interface CreateCallupInput {
  title: string;
  opponent?: string | null;
  /** Fecha y hora tal como las escribe el usuario, en la zona horaria del club. */
  day: string;
  time: string;
  /** Minutos antes del inicio en que se cierran las respuestas (opcional). */
  closeBeforeMinutes?: number | null;
}

export async function createCallup(
  repos: Repos,
  ctx: ClubContext,
  input: CreateCallupInput,
  now: Date = new Date(),
): Promise<Callup> {
  assertCan(ctx, 'callup.manage');
  const title = input.title.trim();
  if (title.length < 1 || title.length > 100) throw validation('El título debe tener entre 1 y 100 caracteres.');
  const opponent = input.opponent?.trim() || null;
  if (opponent && opponent.length > 60) throw validation('El rival admite hasta 60 caracteres.');

  const startsAt = parseLocalDateTime(input.day, input.time, ctx.club.timezone, now);
  if (startsAt.getTime() <= now.getTime()) {
    throw validation('Esa fecha y hora ya pasaron (se interpretan en la zona horaria del club).');
  }

  let closesAt: Date | null = null;
  const before = input.closeBeforeMinutes;
  if (before !== null && before !== undefined) {
    if (!Number.isInteger(before) || before < 0 || before > MAX_CLOSE_BEFORE_MINUTES) {
      throw validation('El cierre debe estar entre 0 y 10080 minutos antes del inicio.');
    }
    closesAt = new Date(startsAt.getTime() - before * 60_000);
    if (closesAt.getTime() <= now.getTime()) throw validation('Con ese cierre ya no quedaría tiempo para responder.');
  }

  const id = await repos.callups.create(
    ctx.club.id,
    { title, opponent, startsAt, closesAt },
    ctx.actor.discordUserId,
  );
  const created = await repos.callups.findById(ctx.club.id, id);
  if (!created) throw notFound('Convocatoria');
  return created;
}

export async function respondCallup(
  repos: Repos,
  ctx: ClubContext,
  callupId: string,
  answer: CallupAnswer,
): Promise<void> {
  if (!ctx.membership) {
    throw new DomainError('NOT_A_MEMBER', 'Solo los miembros del club pueden responder. Usa /vincular para unirte.');
  }
  assertCan(ctx, 'callup.respond');
  await repos.callups.respond(ctx.club.id, callupId, ctx.membership.playerId, answer);
}

export async function closeCallup(repos: Repos, ctx: ClubContext, callupId: string): Promise<void> {
  assertCan(ctx, 'callup.manage');
  await repos.callups.close(ctx.club.id, callupId, ctx.actor.discordUserId);
}

export interface CallupBoard {
  callup: Callup;
  /** ¿Se puede responder todavía? */
  open: boolean;
  voy: Membership[];
  no_voy: Membership[];
  duda: Membership[];
  pending: Membership[];
}

/** Estado de la convocatoria con la plantilla agrupada por respuesta. Lo ve cualquiera del servidor. */
export async function callupBoard(
  repos: Repos,
  ctx: ClubContext,
  callupId: string,
  now: Date = new Date(),
): Promise<CallupBoard> {
  const callup = await repos.callups.findById(ctx.club.id, callupId);
  if (!callup) throw notFound('Convocatoria');
  const [responses, roster] = await Promise.all([
    repos.callups.responses(ctx.club.id, callupId),
    repos.memberships.listActive(ctx.club.id),
  ]);
  const answerOf = new Map(responses.map((r) => [r.playerId, r.answer]));
  const byName = (a: Membership, b: Membership) => a.displayName.localeCompare(b.displayName, 'es');
  const group = (answer: CallupAnswer | undefined) =>
    roster.filter((m) => answerOf.get(m.playerId) === answer).sort(byName);
  const deadline = new Date(callup.closesAt ?? callup.startsAt);
  return {
    callup,
    open: callup.status === 'abierta' && now.getTime() < deadline.getTime(),
    voy: group('voy'),
    no_voy: group('no_voy'),
    duda: group('duda'),
    pending: group(undefined),
  };
}

export async function upcomingCallups(repos: Repos, ctx: ClubContext, limit = 5): Promise<Callup[]> {
  return repos.callups.listUpcoming(ctx.club.id, limit);
}

/** Cambia la zona horaria del club (solo admin). */
export async function setClubTimezone(
  repos: Pick<Repositories, 'clubs'>,
  ctx: ClubContext,
  timezone: string,
): Promise<string> {
  assertCan(ctx, 'club.configure');
  const tz = timezone.trim();
  if (!isValidTimeZone(tz) || !/^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2})$/.test(tz)) {
    throw validation('Zona horaria no válida. Ejemplos: America/Caracas, America/Santo_Domingo, Europe/Madrid.');
  }
  await repos.clubs.setTimezone(ctx.club.id, tz);
  return tz;
}

/** Activa (15–1440 minutos antes) o desactiva (0) los recordatorios automáticos. Solo admin. */
export async function setReminderMinutes(
  repos: Pick<Repositories, 'clubs'>,
  ctx: ClubContext,
  minutes: number,
): Promise<number | null> {
  assertCan(ctx, 'club.configure');
  if (minutes === 0) {
    await repos.clubs.setReminderMinutes(ctx.club.id, null);
    return null;
  }
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) {
    throw validation('Indica entre 15 y 1440 minutos, o 0 para desactivar.');
  }
  await repos.clubs.setReminderMinutes(ctx.club.id, minutes);
  return minutes;
}
