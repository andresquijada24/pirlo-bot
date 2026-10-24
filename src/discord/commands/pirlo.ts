import { CONTEXT_GUILD, OT } from '../constants.js';
import { embed, reply } from '../responses.js';
import type { SlashCommand } from './types.js';

const HELP = [
  '**Primeros pasos**',
  '`/club registrar` — registra tu club (requiere "Gestionar servidor")',
  '`/club canal` — elige canales de anuncios, convocatorias…',
  '`/temporada crear` — crea la temporada actual',
  '',
  '**Plantilla**',
  '`/vincular` — pide unirte al club',
  '`/solicitudes` — aprueba o rechaza solicitudes (DT/admin)',
  '`/plantilla ver` · `rol` · `posiciones` · `gamertag` · `baja`',
  '',
  '**Estadísticas**',
  '`/stats` — tus estadísticas (o las de otro jugador)',
  '`/ranking` — goleadores, asistencias, nota, pases, entradas…',
  '`/club sincronizacion` — estado de la sincronización (DT/admin)',
  '',
  '**Información**',
  '`/club info` · `/temporada ver`',
  '',
  'Próximamente: convocatorias y alineaciones.',
].join('\n');

export const pirloCommand: SlashCommand = {
  needsDatabase: false,
  definition: {
    name: 'pirlo',
    description: 'Información general de PIRLO BOT',
    contexts: [CONTEXT_GUILD],
    options: [{ type: OT.Subcommand, name: 'ayuda', description: 'Muestra qué puede hacer PIRLO BOT' }],
  },
  async execute() {
    return reply(null, {
      embeds: [embed({ title: 'PIRLO BOT', description: HELP, footer: { text: 'EA SPORTS FC 27 · Pro Clubs' } })],
    });
  },
};
