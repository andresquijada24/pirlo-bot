import { describe, expect, it } from 'vitest';
import { splitRoster } from '../../src/discord/commands/plantilla.js';
import type { ClubRole, Membership } from '../../src/core/types.js';

// Datos ficticios, solo para pruebas.
const m = (name: string, role: ClubRole, playerId = name): Membership => ({
  id: `m-${name}`,
  clubId: 'c',
  playerId,
  role,
  positions: [],
  shirtNumber: null,
  displayName: name,
  discordUserId: null,
});

describe('plantilla: jugadores y cuerpo técnico', () => {
  it('un admin o DT sale en la plantilla solo si ha jugado; si no, en el cuerpo técnico', () => {
    const roster = [
      m('Zeta', 'jugador'),
      m('AdminQueJuega', 'admin'),
      m('AdminSinJugar', 'admin'),
      m('Dt', 'dt'),
      m('Capi', 'capitan'),
    ];
    const { players, staff } = splitRoster(roster, new Set(['AdminQueJuega']));
    expect(players.map((p) => p.displayName)).toEqual(['AdminQueJuega', 'Capi', 'Zeta']);
    expect(staff.map((p) => p.displayName)).toEqual(['AdminSinJugar', 'Dt']);
  });

  it('en cuanto juega (tiene estadísticas), pasa a la plantilla', () => {
    const roster = [m('Nuevo', 'admin')];
    expect(splitRoster(roster, new Set()).staff).toHaveLength(1);
    expect(splitRoster(roster, new Set(['Nuevo'])).players).toHaveLength(1);
  });
});
