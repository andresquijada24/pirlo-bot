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
] as const;
export type ChannelPurpose = (typeof CHANNEL_PURPOSES)[number];

export interface Club {
  id: string;
  slug: string;
  name: string;
  status: 'activo' | 'inactivo';
  statsProvider: 'maritimo' | 'ourproclub' | 'ea' | 'manual';
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
