import { permissionDenied } from '../errors.js';
import type { ClubContext, ClubRole } from '../types.js';

/**
 * Sistema de permisos de PIRLO BOT.
 *
 * Jerarquía de roles del club: admin > dt > capitan > jugador.
 *
 * Además, quien tiene "Gestionar servidor" en Discord actúa como admin de los clubes vinculados
 * a ese servidor. Así un servidor nunca queda bloqueado si su club se queda sin admins.
 *
 * Niveles de acceso:
 *   - 'servidor': cualquier miembro del servidor de Discord (consultas públicas).
 *   - 'miembro':  cualquier miembro activo del club.
 *   - un rol:     ese rol o superior.
 */
export const ROLE_RANK: Record<ClubRole, number> = { jugador: 1, capitan: 2, dt: 3, admin: 4 };

export type Action =
  | 'club.view'
  | 'stats.view'
  | 'roster.view'
  | 'link.request'
  | 'callup.respond'
  | 'match.record'
  | 'callup.manage'
  | 'event.manage'
  | 'roster.manage'
  | 'link.approve'
  | 'role.assign'
  | 'lineup.manage'
  | 'stats.correct'
  | 'season.manage'
  | 'club.configure'
  | 'sync.run';

type Requirement = 'servidor' | 'miembro' | ClubRole;

export const ACTION_REQUIREMENTS: Record<Action, Requirement> = {
  'club.view': 'servidor',
  'stats.view': 'servidor',
  'link.request': 'servidor',
  'roster.view': 'miembro',
  'callup.respond': 'miembro',
  'match.record': 'capitan',
  'callup.manage': 'capitan',
  'event.manage': 'capitan',
  'roster.manage': 'dt',
  'link.approve': 'dt',
  'role.assign': 'dt',
  'lineup.manage': 'dt',
  'stats.correct': 'dt',
  'season.manage': 'admin',
  'club.configure': 'admin',
  'sync.run': 'admin',
};

/** Rol efectivo del actor en el club (el gestor del servidor cuenta como admin). */
export function effectiveRole(ctx: ClubContext): ClubRole | null {
  if (ctx.actor.isGuildManager) return 'admin';
  return ctx.membership?.role ?? null;
}

export function can(ctx: ClubContext, action: Action): boolean {
  const req = ACTION_REQUIREMENTS[action];
  if (req === 'servidor') return true;
  const role = effectiveRole(ctx);
  if (role === null) return false;
  if (req === 'miembro') return true;
  return ROLE_RANK[role] >= ROLE_RANK[req];
}

export function assertCan(ctx: ClubContext, action: Action): void {
  if (!can(ctx, action)) throw permissionDenied();
}

/**
 * Reglas para gestionar a otro miembro (cambiar rol, posiciones, dar de baja):
 *   - Un admin puede gestionar a cualquiera.
 *   - Los demás solo a miembros de rango inferior al suyo, y solo pueden otorgar roles
 *     inferiores al suyo (un DT puede nombrar capitanes, pero no DT ni admins).
 */
export function assertCanManageMember(
  ctx: ClubContext,
  target: { role: ClubRole },
  newRole?: ClubRole,
): void {
  const role = effectiveRole(ctx);
  if (role === null) throw permissionDenied();
  if (role === 'admin') return;
  const rank = ROLE_RANK[role];
  if (ROLE_RANK[target.role] >= rank) {
    throw permissionDenied('Solo puedes gestionar a miembros con un rol inferior al tuyo.');
  }
  if (newRole !== undefined && ROLE_RANK[newRole] >= rank) {
    throw permissionDenied('Solo puedes asignar roles inferiores al tuyo.');
  }
}
