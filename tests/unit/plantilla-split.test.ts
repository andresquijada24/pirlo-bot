import { describe, expect, it } from 'vitest';
import { rosterLabel, splitRoster } from '../../src/discord/commands/plantilla.js';
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

describe('plantilla: solo quien forma parte real del equipo', () => {
  it('admins y DT solo si han jugado; capitanes (C) primero', () => {
    const roster = [
      m('Zeta', 'jugador'),
      m('AdminQueJuega', 'admin'),
      m('AdminSinJugar', 'admin'),
      m('DtQueJuega', 'dt'),
      m('DtSinJugar', 'dt'),
      m('Capi', 'capitan'),
    ];
    const { players } = splitRoster(roster, new Set(['AdminQueJuega', 'DtQueJuega']));
    expect(players.map((p) => p.displayName)).toEqual([
      'Capi',
      'DtQueJuega',
      'AdminQueJuega',
      'Zeta',
    ]);
  });

  it('nadie sale como «Admin»: el admin es jugador y el DT lleva la marca de capitán', () => {
    expect(rosterLabel('admin')).toEqual({ captain: false, label: 'Jugador' });
    expect(rosterLabel('dt')).toEqual({ captain: true, label: 'Capitán' });
    expect(rosterLabel('capitan')).toEqual({ captain: true, label: 'Capitán' });
    expect(rosterLabel('jugador')).toEqual({ captain: false, label: 'Jugador' });
  });

  it('en cuanto juega (tiene estadísticas), pasa a la plantilla', () => {
    const roster = [m('Nuevo', 'admin')];
    expect(splitRoster(roster, new Set()).players).toHaveLength(0);
    expect(splitRoster(roster, new Set(['Nuevo'])).players).toHaveLength(1);
  });
});
