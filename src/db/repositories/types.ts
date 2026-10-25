import type {
  Callup,
  Lineup,
  CallupAnswer,
  CallupResponse,
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
  setTimezone(clubId: string, timezone: string): Promise<void>;
  /** null desactiva los recordatorios. */
  setReminderMinutes(clubId: string, minutes: number | null): Promise<void>;
  findById(clubId: string): Promise<Club | null>;
  /** Quita el vínculo del club con un servidor (no el último). Solo un admin del club. */
  disconnectGuild(clubId: string, guildId: string, actorDiscordId: string): Promise<void>;
  /** Conecta un club existente (por identificador) a otro servidor. Solo un admin del club. Devuelve el id. */
  connectGuild(input: { slug: string; guildId: string; guildName: string | null; actorDiscordId: string }): Promise<string>;
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
  /**
   * Pone las fechas de una temporada y reasigna las sesiones del club según su fecha.
   * Devuelve cuántas sesiones cambiaron de temporada.
   */
  setDates(
    clubId: string,
    seasonId: string,
    startsOn: string,
    endsOn: string | null,
    actorDiscordId: string,
  ): Promise<number>;
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

export interface CallupRepository {
  /** Crea la convocatoria (y su evento del calendario). Devuelve su id. */
  create(
    clubId: string,
    input: { title: string; opponent: string | null; startsAt: Date; closesAt: Date | null },
    actorDiscordId: string,
  ): Promise<string>;
  findById(clubId: string, callupId: string): Promise<Callup | null>;
  /** Abiertas cuyo inicio no pasó hace más de unas horas, de la más próxima a la más lejana. */
  listUpcoming(clubId: string, limit: number): Promise<Callup[]>;
  /** Próxima convocatoria no cancelada (abierta o cerrada), aunque haya empezado hace unas horas. */
  next(clubId: string): Promise<Callup | null>;
  responses(clubId: string, callupId: string): Promise<CallupResponse[]>;
  /** Lanza CONFLICT si está cerrada o fuera de plazo. */
  respond(clubId: string, callupId: string, playerId: string, answer: CallupAnswer): Promise<void>;
  close(clubId: string, callupId: string, actorDiscordId: string): Promise<void>;
  cancel(clubId: string, callupId: string, actorDiscordId: string): Promise<void>;
  /** Recuerda un mensaje de Discord que muestra el tablero (idempotente). */
  recordMessage(clubId: string, callupId: string, channelId: string, messageId: string): Promise<void>;
  messages(clubId: string, callupId: string): Promise<{ channelId: string; messageId: string }[]>;
}

export interface LineupRepository {
  /** Crea la alineación de una convocatoria con 11 huecos titulares (positions) vacíos. */
  create(
    clubId: string,
    input: { callupId: string; formation: string; positions: PositionCode[]; replace: boolean },
    actorDiscordId: string,
  ): Promise<string>;
  findByCallup(clubId: string, callupId: string): Promise<Lineup | null>;
  /** Titular en una posición (primer hueco libre) o suplente. Mueve si ya estaba. Devuelve el hueco. */
  assign(
    clubId: string,
    lineupId: string,
    playerId: string,
    target: { position: PositionCode } | { substitute: true },
  ): Promise<number>;
  /** false si no estaba en la alineación. */
  remove(clubId: string, lineupId: string, playerId: string): Promise<boolean>;
  publish(clubId: string, lineupId: string, actorDiscordId: string): Promise<void>;
}

export interface DueReminder {
  clubId: string;
  callupId: string;
  guildId: string;
  channelId: string;
}

/** Recordatorios de convocatorias. due() recorre todos los clubes: solo lo usa la tarea programada. */
export interface ReminderRepository {
  /** Pendientes, sin los servidores bloqueados (el de referencia siempre lo está). */
  due(limit: number, blockedGuilds: string[]): Promise<DueReminder[]>;
  /** Devuelve a la cola un recordatorio reclamado cuyo envío falló por un error temporal. */
  release(clubId: string, callupId: string): Promise<void>;
  /** Marca la convocatoria como recordada; false si otra tarea ya lo hizo. */
  claim(clubId: string, callupId: string): Promise<boolean>;
}

export interface EaCaptureRepository {
  /** Guarda partidos nuevos; los ya guardados se ignoran. Devuelve cuántos eran nuevos. */
  store(matches: import('../../providers/ea/ingest.js').CachedMatch[]): Promise<number>;
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
  callups: CallupRepository;
  lineups: LineupRepository;
  reminders: ReminderRepository;
  eaCapture: EaCaptureRepository;
}
