import { clubCommand } from './club.js';
import { callupButtons, convocatoriaCommand } from './convocatoria.js';
import { linkButtons, solicitudesCommand, vincularCommand } from './link.js';
import { pirloCommand } from './pirlo.js';
import { plantillaCommand } from './plantilla.js';
import { rankingCommand, statsCommand } from './stats.js';
import { temporadaCommand } from './temporada.js';
import type { ComponentHandler, SlashCommand } from './types.js';

/** Registro único de comandos. Añadir aquí cada comando nuevo. */
export const commands: readonly SlashCommand[] = [
  pirloCommand,
  clubCommand,
  vincularCommand,
  solicitudesCommand,
  plantillaCommand,
  temporadaCommand,
  statsCommand,
  rankingCommand,
  convocatoriaCommand,
];

export const commandsByName: ReadonlyMap<string, SlashCommand> = new Map(
  commands.map((c) => [c.definition.name, c]),
);

export const componentHandlers: ReadonlyMap<string, ComponentHandler> = new Map(
  [linkButtons, callupButtons].map((h) => [h.prefix, h]),
);
