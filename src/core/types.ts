/** Tipos de dominio compartidos. Reflejan las tablas de Supabase (migraciones 1-7). */

export const CLUB_ROLES = ['jugador', 'capitan', 'dt', 'admin'] as const;
export type ClubRole = (typeof CLUB_ROLES)[number];

export const POSITION_CODES = [
  'POR',
  'DFC',
  'LI',
  'LD',
  'CAI',
  'CAD',
  'MCD',
  'MC',
  'MCO',
  'MI',
  'MD',
  'EI',
  'ED',
  'SD',
  'DC',
] as const;
export type PositionCode = (typeof POSITION_CODES)[number];

export const CHANNEL_PURPOSES = [
  'anuncios',
  'convocatorias',
  'alineaciones',
  'resultados',
  'rankings',
  'recordatorios',
  'ourproclub',
] as const;
export type ChannelPurpose = (typeof CHANNEL_PURPOSES)[number];

export interface Club {
  id: string;
  slug: string;
  name: string;
  /** 'pendiente' hasta que el dueño de PIRLO BOT lo aprueba; 'rechazado' si no. */
  status: 'activo' | 'inactivo' | 'pendiente' | 'rechazado';
  statsProvider: 'maritimo' | 'ourproclub' | 'ea' | 'manual';
  /** Zona horaria IANA con la que se interpretan las fechas que escribe el club. */
  timezone: string;
  /** Minutos antes de cada convocatoria en que se publica un recordatorio. null = desactivado. */
  reminderMinutes: number | null;
}

export interface Membership {
  id: string;
  clubId: string;
  playerId: string;
  role: ClubRole;
  positions: PositionCode[];
  shirtNumber: number | null;
  displayName: string;
  discordUserId: string | null;
}

export interface LinkRequest {
  id: string;
  clubId: string;
  discordUserId: string;
  displayName: string;
  eaGamertag: string | null;
  status: 'pendiente' | 'aprobada' | 'rechazada';
}

export interface Season {
  id: string;
  clubId: string;
  name: string;
  isCurrent: boolean;
  /** Inicio y fin (AAAA-MM-DD). null = sin fecha: cuenta desde el día en que se creó. */
  startsOn: string | null;
  endsOn: string | null;
}

/** Quien ejecuta una acción, tal como lo identifica Discord. */
export interface Actor {
  discordUserId: string;
  displayName: string;
  guildId: string;
  /** El usuario tiene el permiso "Gestionar servidor" en Discord. */
  isGuildManager: boolean;
}

/** Contexto ya resuelto: el actor, el club sobre el que actúa y su membresía (si tiene). */
export interface ClubContext {
  actor: Actor;
  club: Club;
  membership: Membership | null;
}

export const CALLUP_ANSWERS = ['voy', 'no_voy', 'duda'] as const;
export type CallupAnswer = (typeof CALLUP_ANSWERS)[number];

export interface Callup {
  id: string;
  clubId: string;
  title: string;
  opponent: string | null;
  /** Instantes en ISO 8601 (UTC). */
  startsAt: string;
  closesAt: string | null;
  status: 'abierta' | 'cerrada' | 'cancelada';
}

export interface CallupResponse {
  playerId: string;
  answer: CallupAnswer;
}

export interface LineupSlot {
  slot: number;
  position: PositionCode | null;
  playerId: string | null;
  substitute: boolean;
}

export interface Lineup {
  id: string;
  clubId: string;
  callupId: string | null;
  formation: string;
  status: 'borrador' | 'publicada';
  slots: LineupSlot[];
}
