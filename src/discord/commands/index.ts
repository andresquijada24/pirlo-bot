import { pirloCommand } from './pirlo.js';
import type { SlashCommand } from './types.js';

/** Registro único de comandos. Añadir aquí cada comando nuevo. */
export const commands: readonly SlashCommand[] = [pirloCommand];

export const commandsByName: ReadonlyMap<string, SlashCommand> = new Map(
  commands.map((c) => [c.definition.name, c]),
);
