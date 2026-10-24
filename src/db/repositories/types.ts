import type {
  ChannelPurpose,
  Club,
  ClubRole,
  LinkRequest,
  Membership,
  PositionCode,
  Season,
} from '../../core/types.js';
import type { SessionStatRow } from '../../core/stats/service.js';
import type { SyncRepository } from '../../sync/types.js';

/**
 * Contratos de acceso a datos.
 *
 * Regla de aislamiento: todo método que lee o escribe datos de un club recibe `clubId` y filtra
 * por él. Nunca se busca una fila de club solo por su id. Si el id pertenece a otro club, el
 * resultado es "no encontrado".
 *
 * Errores: las implementaciones convierten los errores de la base de datos en DomainError
 * (CONFLICT, NOT_FOUND, VALIDATION).
 */

export interface RegisterClubInput {
  guildId: string;
  guildName: string | null;
  slug: string;
  name: string;
  adminDiscordId: string;
  adminDisplayName: string;
}

export interface ClubRepository {
  listByGuild(guildId: string): Promise<Club[]>;
  register(input: RegisterClubInput): Promise<{ clubId: string; membershipId: string }>;
}

export interface MembershipRepository {
  findActiveByDiscordUser(clubId: string, discordUserId: string): Promise<Membership | null>;
  findActiveById(clubId: string, membershipId: string): Promise<Membership | null>;
  listActive(clubId: string): Promise<Membership[]>;
  countActiveAdmins(clubId: string): Promise<number>;
  updateRole(clubId: string, membershipId: string, role: ClubRole): Promise<void>;
  updatePositions(clubId: string, membershipId: string, positions: PositionCode[]): Promise<void>;
  end(clubId: string, membershipId: string): Promise<void>;
}

export interface LinkRequestRepository {
  create(
    clubId: string,
    input: { discordUserId: string; displayName: string; eaGamertag: string | null },
  ): Promise<LinkRequest>;
  findById(clubId: string, requestId: string): Promise<LinkRequest | null>;
  listPending(clubId: string): Promise<LinkRequest[]>;
  approve(
    clubId: string,
    requestId: string,
    decidedBy: string,
    role: ClubRole,
  ): Promise<{ membershipId: string }>;
  reject(clubId: string, requestId: string, decidedBy: string): Promise<void>;
}

export interface ChannelRepository {
  set(clubId: string, guildId: string, purpose: ChannelPurpose, channelId: string): Promise<void>;
  list(clubId: string): Promise<{ purpose: ChannelPurpose; channelId: string }[]>;
}

export interface SeasonRepository {
  create(clubId: string, name: string, makeCurrent: boolean, actorDiscordId: string): Promise<Season>;
  list(clubId: string): Promise<Season[]>;
}

export interface AuditEntry {
  clubId: string | null;
  actorDiscordId: string;
  action: string;
  entity?: string;
  entityId?: string;
  details?: Record<string, unknown>;
}

export interface AuditRepository {
  log(entry: AuditEntry): Promise<void>;
}

export interface StatsRepository {
  /** Totales por temporada a nivel sesión. seasonId null = todas (incluye sesiones sin temporada). */
  sessionRows(clubId: string, seasonId: string | null): Promise<SessionStatRow[]>;
}

export interface ExternalPlayerRepository {
  /**
   * Vincula al jugador con la ficha externa de ese gamertag y le asigna sus estadísticas.
   * Devuelve cuántas fichas quedaron vinculadas (0 si el proveedor aún no informó ese gamertag).
   * Lanza CONFLICT si el gamertag ya pertenece a otro jugador del club.
   */
  linkGamertag(clubId: string, playerId: string, gamertag: string, actorDiscordId: string): Promise<number>;
}

export interface Repositories {
  clubs: ClubRepository;
  memberships: MembershipRepository;
  linkRequests: LinkRequestRepository;
  channels: ChannelRepository;
  seasons: SeasonRepository;
  audit: AuditRepository;
  stats: StatsRepository;
  externalPlayers: ExternalPlayerRepository;
  sync: SyncRepository;
}
