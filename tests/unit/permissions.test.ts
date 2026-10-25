import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/core/errors.js';
import {
  ACTION_REQUIREMENTS,
  assertCanManageMember,
  can,
  type Action,
} from '../../src/core/permissions/index.js';
import type { ClubContext, ClubRole } from '../../src/core/types.js';

function ctx(role: ClubRole | null, isGuildManager = false): ClubContext {
  return {
    actor: { discordUserId: '111111111111111111', displayName: 'X', guildId: '1'.repeat(18), isGuildManager },
    club: { id: 'c', slug: 'c', name: 'C', status: 'activo', statsProvider: 'manual', timezone: 'America/Caracas', reminderMinutes: null },
    membership: role
      ? {
          id: 'm',
          clubId: 'c',
          playerId: 'p',
          role,
          positions: [],
          shirtNumber: null,
          displayName: 'X',
          discordUserId: '111111111111111111',
        }
      : null,
  };
}

const actions = Object.keys(ACTION_REQUIREMENTS) as Action[];

describe('can()', () => {
  it('quien no es miembro solo puede hacer acciones públicas', () => {
    const allowed = actions.filter((a) => can(ctx(null), a));
    expect(allowed.sort()).toEqual(['club.view', 'link.request', 'stats.view']);
  });

  it('un jugador puede ver la plantilla y responder convocatorias, pero no gestionar', () => {
    const c = ctx('jugador');
    expect(can(c, 'roster.view')).toBe(true);
    expect(can(c, 'callup.respond')).toBe(true);
    expect(can(c, 'callup.manage')).toBe(false);
    expect(can(c, 'match.record')).toBe(false);
  });

  it('un capitán gestiona convocatorias y registra resultados, pero no la plantilla', () => {
    const c = ctx('capitan');
    expect(can(c, 'callup.manage')).toBe(true);
    expect(can(c, 'match.record')).toBe(true);
    expect(can(c, 'roster.manage')).toBe(false);
    expect(can(c, 'link.approve')).toBe(false);
  });

  it('un DT gestiona plantilla, alineaciones y correcciones, pero no la configuración del club', () => {
    const c = ctx('dt');
    expect(can(c, 'roster.manage')).toBe(true);
    expect(can(c, 'lineup.manage')).toBe(true);
    expect(can(c, 'stats.correct')).toBe(true);
    expect(can(c, 'club.configure')).toBe(false);
    expect(can(c, 'season.manage')).toBe(false);
  });

  it('un admin puede hacerlo todo', () => {
    expect(actions.every((a) => can(ctx('admin'), a))).toBe(true);
  });

  it('el gestor del servidor de Discord actúa como admin aunque no sea miembro', () => {
    expect(actions.every((a) => can(ctx(null, true), a))).toBe(true);
  });

  it('los permisos son crecientes: cada rol puede todo lo del rol inferior', () => {
    const order: ClubRole[] = ['jugador', 'capitan', 'dt', 'admin'];
    for (let i = 1; i < order.length; i++) {
      for (const a of actions) {
        if (can(ctx(order[i - 1]!), a)) expect(can(ctx(order[i]!), a)).toBe(true);
      }
    }
  });
});

describe('assertCanManageMember()', () => {
  it('un DT puede nombrar capitanes', () => {
    expect(() => assertCanManageMember(ctx('dt'), { role: 'jugador' }, 'capitan')).not.toThrow();
  });

  it('un DT no puede nombrar a otro DT ni admins', () => {
    expect(() => assertCanManageMember(ctx('dt'), { role: 'jugador' }, 'dt')).toThrow(DomainError);
    expect(() => assertCanManageMember(ctx('dt'), { role: 'jugador' }, 'admin')).toThrow(DomainError);
  });

  it('un DT no puede gestionar a otro DT ni a un admin', () => {
    expect(() => assertCanManageMember(ctx('dt'), { role: 'dt' })).toThrow(DomainError);
    expect(() => assertCanManageMember(ctx('dt'), { role: 'admin' })).toThrow(DomainError);
  });

  it('un admin puede gestionar y nombrar a cualquiera', () => {
    expect(() => assertCanManageMember(ctx('admin'), { role: 'admin' }, 'admin')).not.toThrow();
  });

  it('quien no es miembro no puede gestionar a nadie', () => {
    expect(() => assertCanManageMember(ctx(null), { role: 'jugador' })).toThrow(DomainError);
  });
});
