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
import type { CachedMatch, EA_PLATFORMS } from '../../providers/ea/ingest.js';
import type { ProcessedEaMatch } from '../../providers/ea/matches.js';

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

/** Fila del panel interno de PIRLO BOT (todos los clubes; solo el dueño la ve). */
export interface AdminClubRow {
  id: string;
  slug: string;
  name: string;
  status: Club['status'];
  createdAt: string;
  webPublic: boolean;
  websiteUrl: string | null;
  guilds: { id: string; name: string | null }[];
  members: number;
  eaLinked: boolean;
}

export interface ClubRepository {
  /** Todos los clubes con su resumen, para el panel interno (más recientes primero). */
  listAdmin(): Promise<AdminClubRow[]>;
  listByGuild(guildId: string): Promise<Club[]>;
  register(input: RegisterClubInput): Promise<{ clubId: string; membershipId: string }>;
  setTimezone(clubId: string, timezone: string): Promise<void>;
  /** null desactiva los recordatorios. */
  setReminderMinutes(clubId: string, minutes: number | null): Promise<void>;
  findById(clubId: string): Promise<Club | null>;
  /** Cambia el estado (aprobación del dueño de PIRLO BOT). Lo controla la app; queda auditado. */
  setStatus(clubId: string, status: Club['status'], actorDiscordId: string): Promise<void>;
  /** Clubes con la página web publicada (para el directorio /clubes). */
  listPublic(): Promise<{ slug: string; name: string; hasCrest: boolean }[]>;
  /** Club con la página web pública activada (por su identificador) o null. */
  findPublic(slug: string): Promise<Club | null>;
  /** Activa o desactiva la página web pública. Solo un admin del club. */
  setWebPublic(clubId: string, isPublic: boolean, actorDiscordId: string): Promise<void>;
  /** ¿Tiene activada la página web? */
  webPublic(clubId: string): Promise<boolean>;
  /** Sitio web oficial del club o null. */
  website(clubId: string): Promise<string | null>;
  /** Guarda o quita (null) el sitio web. Solo un admin del club (lo comprueba la base de datos). */
  setWebsite(clubId: string, url: string | null, actorDiscordId: string): Promise<void>;
  /** Guarda el nombre de un servidor de Discord si aún no lo tenía (panel interno). */
  setGuildName(guildId: string, name: string): Promise<void>;
  /**
   * Clubes activos sin escudo, con los servidores de Discord que son solo suyos (los compartidos
   * por varios clubes, p. ej. un servidor de pruebas multiclub, no representan a ninguno).
   */
  withoutCrest(limit: number): Promise<{ clubId: string; guildIds: string[] }[]>;
  /** Guarda un escudo automático solo si el club sigue sin escudo. true si se guardó. */
  setAutoCrest(clubId: string, pngBase64: string): Promise<boolean>;
  /** Escudo del club (PNG en base64) o null. Aparte de findById para no cargarlo siempre. */
  crest(clubId: string): Promise<string | null>;
  /** Guarda o quita (null) el escudo. Solo un admin del club (lo comprueba la base de datos). */
  setCrest(clubId: string, pngBase64: string | null, actorDiscordId: string): Promise<void>;
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
  /** Foto (JPEG en base64) del jugador en este club, por id de jugador; null si no tiene. */
  photo(clubId: string, playerId: string): Promise<string | null>;
  /** ¿Qué jugadores del club tienen foto? (ids de jugador) */
  withPhoto(clubId: string): Promise<Set<string>>;
  /** Guarda o quita (null) la foto. El propio jugador o un admin/DT (lo comprueba la base de datos). */
  setPhoto(clubId: string, membershipId: string, jpgBase64: string | null, actorDiscordId: string): Promise<void>;
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
  list(clubId: string): Promise<{ purpose: ChannelPurpose; channelId: string; guildId: string }[]>;
}

/** Mensajes de Our Pro Club ya procesados (espejo desde el Discord de cada club). */
export interface OurProClubRepository {
  /** Clubes con canal de Our Pro Club configurado. */
  channels(): Promise<{ clubId: string; guildId: string; channelId: string }[]>;
  /** Id del mensaje más reciente procesado (null: nunca se leyó el canal). */
  latest(clubId: string): Promise<string | null>;
  record(
    clubId: string,
    rows: { messageId: string; kind: 'partido' | 'resumen' | 'otro'; postedAt: string }[],
  ): Promise<void>;
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
  store(matches: CachedMatch[]): Promise<number>;
}

export interface EaLink {
  clubId: string;
  platform: (typeof EA_PLATFORMS)[number];
  eaClubId: string;
  consentedBy: string;
  consentedAt: string;
}

export interface EaMatchSummary {
  matchId: string;
  matchType: ProcessedEaMatch['matchType'];
  playedAt: string;
  goalsFor: number | null;
  goalsAgainst: number | null;
  result: ProcessedEaMatch['result'];
  opponentName: string | null;
  /** Colores de la equipación del rival (#rrggbb); null o ausente si no hay. */
  opponentColors?: { primary: string; secondary: string } | null;
}

/** Una línea del historial de partidos de un jugador (solo el lado propio). */
export interface EaPlayerMatch {
  matchId: string;
  matchType: ProcessedEaMatch['matchType'];
  playedAt: string;
  opponentName: string | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  result: ProcessedEaMatch['result'];
  position: string | null;
  goals: number | null;
  assists: number | null;
  shots: number | null;
  passesMade: number | null;
  passesAttempted: number | null;
  tacklesMade: number | null;
  tacklesAttempted: number | null;
  saves: number | null;
  rating: number | null;
  manOfTheMatch: boolean | null;
}

export interface EaRecapPlayer {
  /** Nombre en el club si el gamertag está vinculado; si no, el gamertag de EA. */
  name: string;
  /** Posición que da EA (forward, midfielder, defender, goalkeeper…). */
  position: string | null;
  goals: number | null;
  assists: number | null;
  rating: number | null;
  shots: number | null;
  passesMade: number | null;
  passesAttempted: number | null;
  tacklesMade: number | null;
  tacklesAttempted: number | null;
  saves: number | null;
  manOfTheMatch: boolean | null;
}

/** Datos de un resumen de partido: solo jugadores propios; el rival solo por nombre y marcador. */
export interface EaRecap extends EaMatchSummary {
  players: EaRecapPlayer[];
}

/** Enlace (con consentimiento) de cada club con su club de EA y partidos ya procesados. */
export interface EaRepository {
  link(clubId: string, platform: EaLink['platform'], eaClubId: string, actorDiscordId: string): Promise<void>;
  /** false si el club no estaba vinculado. */
  unlink(clubId: string, actorDiscordId: string): Promise<boolean>;
  getLink(clubId: string): Promise<EaLink | null>;
  /** ¿Algún club de PIRLO dio su consentimiento para este club de EA? */
  consented(platform: string, eaClubId: string): Promise<boolean>;
  /** Todos los enlaces: solo lo usa la tarea programada. */
  listLinks(): Promise<EaLink[]>;
  pending(clubId: string, limit: number): Promise<CachedMatch[]>;
  /** Guarda un partido procesado; false si ya existía. */
  apply(clubId: string, match: ProcessedEaMatch): Promise<boolean>;
  recent(clubId: string, limit: number): Promise<EaMatchSummary[]>;
  /**
   * Partidos jugados del calendario de un proveedor por sesión (Marítimo), con el mismo formato
   * que los de EA: competición convertida a tipo (torneo y relámpago = copa) y marcador.
   */
  calendar(clubId: string, limit: number): Promise<EaMatchSummary[]>;
  /** Historial de partidos de unos jugadores de EA del club (más recientes primero). */
  playerMatches(clubId: string, eaPlayerIds: string[], limit: number): Promise<EaPlayerMatch[]>;
  /** Reclama partidos recientes sin anunciar (cada uno solo una vez). Devuelve sus ids. */
  claimRecaps(clubId: string, limit: number): Promise<string[]>;
  /** Devuelve a la cola partidos cuyo anuncio falló por un error temporal. */
  releaseRecaps(clubId: string, matchIds: string[]): Promise<void>;
  recaps(clubId: string, matchIds: string[]): Promise<EaRecap[]>;
}

/** Un jugador del club en una sesión (resumen de Our Pro Club vía el proveedor). */
export interface SessionRecapPlayer {
  /** Gamertag tal como lo publica la fuente. */
  name: string;
  playerId: string | null;
  matchesPlayed: number | null;
  rating: number | null;
  goals: number | null;
  assists: number | null;
  shots: number | null;
  dribbles: number | null;
  passesMade: number | null;
  passesAttempted: number | null;
  tacklesMade: number | null;
  tacklesAttempted: number | null;
  interceptions: number | null;
  blocks: number | null;
  clearances: number | null;
  saves: number | null;
  /** Calificación media del jugador en la temporada de la sesión (para comparar); null si no hay. */
  seasonRating: number | null;
}

export interface SessionRecap {
  sessionId: string;
  playedOn: string;
  publishedAt: string | null;
  matchesPlayed: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  /** Partidos sin goles recibidos; null si la fuente no informa goles en contra (Marítimo). */
  cleanSheets?: number | null;
  players: SessionRecapPlayer[];
}

export interface StatsRepository {
  /** Reserva hasta `limit` sesiones nuevas sin anunciar (cada una se anuncia una sola vez). */
  claimSessionRecaps(clubId: string, limit: number): Promise<string[]>;
  /** Devuelve sesiones reservadas que no se pudieron publicar (error temporal). */
  releaseSessionRecaps(clubId: string, sessionIds: string[]): Promise<void>;
  sessionRecaps(clubId: string, sessionIds: string[]): Promise<SessionRecap[]>;
  /** Clubes con sesiones sin anunciar. */
  clubsWithPendingRecaps(): Promise<string[]>;
  /** Totales por temporada a nivel sesión. seasonId null = todas (incluye sesiones sin temporada). */
  sessionRows(
    clubId: string,
    seasonId: string | null,
    /** Solo partidos de estos tipos (las sesiones sin tipo conocido quedan fuera). */
    matchTypes?: readonly ProcessedEaMatch['matchType'][],
  ): Promise<SessionStatRow[]>;
}

export interface ExternalPlayerRepository {
  /**
   * Vincula al jugador con la ficha externa de ese gamertag y le asigna sus estadísticas.
   * Devuelve cuántas fichas quedaron vinculadas (0 si el proveedor aún no informó ese gamertag).
   * Lanza CONFLICT si el gamertag ya pertenece a otro jugador del club.
   */
  linkGamertag(clubId: string, playerId: string, gamertag: string, actorDiscordId: string): Promise<number>;
  /**
   * ¿Ha jugado alguien con ese gamertag en el club? (estadísticas de EA, fichas o sesiones del
   * proveedor). Sin distinguir mayúsculas. Sirve para no vincular nombres que el club no conoce.
   */
  knowsGamertag(clubId: string, gamertag: string): Promise<boolean>;
  /** Fichas activas de un usuario de Discord en todos los clubes (para «Mi cuenta»). */
  accountsOf(discordUserId: string): Promise<DiscordAccountMembership[]>;
}

export interface DiscordAccountMembership {
  clubId: string;
  clubSlug: string;
  clubName: string;
  /** La página del club está publicada (la ficha se puede enlazar). */
  clubPublic: boolean;
  playerId: string;
  gamertag: string | null;
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
  ea: EaRepository;
  ourproclub: OurProClubRepository;
}
