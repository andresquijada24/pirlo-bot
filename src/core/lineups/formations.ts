import type { PositionCode } from '../types.js';

/**
 * Formaciones disponibles. Cada una lista sus líneas de atrás hacia delante (sin el portero).
 * Las posiciones usan los códigos de PIRLO BOT (los de EA SPORTS FC en español).
 */
export const FORMATIONS = {
  '4-3-3': [['LD', 'DFC', 'DFC', 'LI'], ['MC', 'MCD', 'MC'], ['ED', 'DC', 'EI']],
  '4-4-2': [['LD', 'DFC', 'DFC', 'LI'], ['MD', 'MC', 'MC', 'MI'], ['DC', 'DC']],
  '4-2-3-1': [['LD', 'DFC', 'DFC', 'LI'], ['MCD', 'MCD'], ['MD', 'MCO', 'MI'], ['DC']],
  '4-1-2-1-2': [['LD', 'DFC', 'DFC', 'LI'], ['MCD'], ['MC', 'MC'], ['MCO'], ['DC', 'DC']],
  '4-1-4-1': [['LD', 'DFC', 'DFC', 'LI'], ['MCD'], ['MD', 'MC', 'MC', 'MI'], ['DC']],
  '4-4-1-1': [['LD', 'DFC', 'DFC', 'LI'], ['MD', 'MC', 'MC', 'MI'], ['SD'], ['DC']],
  '4-3-2-1': [['LD', 'DFC', 'DFC', 'LI'], ['MC', 'MC', 'MC'], ['SD', 'SD'], ['DC']],
  '4-5-1': [['LD', 'DFC', 'DFC', 'LI'], ['MD', 'MC', 'MCO', 'MC', 'MI'], ['DC']],
  '3-5-2': [['DFC', 'DFC', 'DFC'], ['MD', 'MCD', 'MCO', 'MCD', 'MI'], ['DC', 'DC']],
  '3-4-3': [['DFC', 'DFC', 'DFC'], ['MD', 'MC', 'MC', 'MI'], ['ED', 'DC', 'EI']],
  '3-4-1-2': [['DFC', 'DFC', 'DFC'], ['MD', 'MC', 'MC', 'MI'], ['MCO'], ['DC', 'DC']],
  '5-3-2': [['CAD', 'DFC', 'DFC', 'DFC', 'CAI'], ['MC', 'MCD', 'MC'], ['DC', 'DC']],
  '5-2-1-2': [['CAD', 'DFC', 'DFC', 'DFC', 'CAI'], ['MC', 'MC'], ['MCO'], ['DC', 'DC']],
} as const satisfies Record<string, readonly (readonly PositionCode[])[]>;

export type Formation = keyof typeof FORMATIONS;
export const FORMATION_NAMES = Object.keys(FORMATIONS) as Formation[];

/** Las 11 posiciones titulares en orden de hueco: portero y luego de atrás hacia delante. */
export function formationSlots(f: Formation): PositionCode[] {
  return ['POR', ...FORMATIONS[f].flat()];
}

/** Líneas con sus números de hueco (1 = portero), de atrás hacia delante. */
export function formationLines(f: Formation): number[][] {
  const lines: number[][] = [[1]];
  let slot = 2;
  for (const line of FORMATIONS[f]) {
    lines.push(line.map(() => slot++));
  }
  return lines;
}

export const isFormation = (s: string): s is Formation => s in FORMATIONS;
