import { describe, expect, it } from 'vitest';
import { discordTime, isValidTimeZone, parseDay, parseLocalDateTime, parseTime } from '../../src/core/time.js';

// "Ahora" fijo: 24/10/2026 18:00 en Caracas (22:00 UTC).
const NOW = new Date('2026-10-24T22:00:00Z');
const CCS = 'America/Caracas';

describe('parseTime', () => {
  it('acepta 24 h, am/pm y "h"', () => {
    expect(parseTime('21:30')).toEqual({ hour: 21, minute: 30 });
    expect(parseTime('9:30pm')).toEqual({ hour: 21, minute: 30 });
    expect(parseTime('9 PM')).toEqual({ hour: 21, minute: 0 });
    expect(parseTime('12am')).toEqual({ hour: 0, minute: 0 });
    expect(parseTime('21h')).toEqual({ hour: 21, minute: 0 });
  });
  it('rechaza horas imposibles', () => {
    expect(() => parseTime('25:00')).toThrow('Hora no válida');
    expect(() => parseTime('13pm')).toThrow('Hora no válida');
    expect(() => parseTime('mediodía')).toThrow('Hora no válida');
  });
});

describe('parseDay', () => {
  it('hoy y mañana según la zona del club, no la del servidor', () => {
    // 01:00 UTC del 25/10 todavía es 24/10 en Caracas.
    const lateUtc = new Date('2026-10-25T01:00:00Z');
    expect(parseDay('hoy', CCS, lateUtc)).toEqual({ year: 2026, month: 10, day: 24 });
    expect(parseDay('mañana', CCS, lateUtc)).toEqual({ year: 2026, month: 10, day: 25 });
  });
  it('sin año usa el próximo que corresponda', () => {
    expect(parseDay('25/10', CCS, NOW)).toEqual({ year: 2026, month: 10, day: 25 });
    expect(parseDay('3/1', CCS, NOW)).toEqual({ year: 2027, month: 1, day: 3 });
  });
  it('acepta ISO y día/mes/año', () => {
    expect(parseDay('2026-11-02', CCS, NOW)).toEqual({ year: 2026, month: 11, day: 2 });
    expect(parseDay('02/11/26', CCS, NOW)).toEqual({ year: 2026, month: 11, day: 2 });
  });
  it('rechaza fechas que no existen', () => {
    expect(() => parseDay('31/02', CCS, NOW)).toThrow('Esa fecha no existe');
    expect(() => parseDay('el sábado', CCS, NOW)).toThrow('Fecha no válida');
  });
});

describe('parseLocalDateTime', () => {
  it('interpreta la hora en la zona del club', () => {
    expect(parseLocalDateTime('25/10', '21:30', CCS, NOW).toISOString()).toBe('2026-10-26T01:30:00.000Z');
  });
  it('respeta el horario de verano', () => {
    expect(parseLocalDateTime('2026-07-01', '21:30', 'Europe/Madrid', NOW).toISOString()).toBe('2026-07-01T19:30:00.000Z');
    expect(parseLocalDateTime('2026-12-01', '21:30', 'Europe/Madrid', NOW).toISOString()).toBe('2026-12-01T20:30:00.000Z');
  });
});

describe('utilidades', () => {
  it('valida zonas horarias', () => {
    expect(isValidTimeZone('America/Santo_Domingo')).toBe(true);
    expect(isValidTimeZone('Marte/Olympus')).toBe(false);
  });
  it('formatea marcas de tiempo de Discord', () => {
    expect(discordTime('2026-10-26T01:30:00Z', 'R')).toBe('<t:1792978200:R>');
  });
});

describe('parseTime tolerante con el teclado del móvil', () => {
  const cases: [string, number, number][] = [
    ['9:30 p. m.', 21, 30],
    ['9:30 p. m.', 21, 30],
    ['10:30 p.m.', 22, 30],
    ['21.30', 21, 30],
    ['21 30', 21, 30],
    ['a las 9 pm', 21, 0],
    ['21:30 hrs', 21, 30],
    ['23：30', 23, 30],
    ['2130', 21, 30],
  ];
  for (const [input, hour, minute] of cases) {
    it(JSON.stringify(input), () => {
      expect(parseTime(input)).toEqual({ hour, minute });
    });
  }
  it('el error repite lo escrito', () => {
    expect(() => parseTime('mediodía')).toThrow('«mediodía»');
  });
});
