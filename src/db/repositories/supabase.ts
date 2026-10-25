import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { CHANNEL_PURPOSES, CLUB_ROLES, POSITION_CODES } from '../../core/types.js';
import type { Club, LinkRequest, Membership, Season } from '../../core/types.js';
import { check } from '../errors.js';
import type {
  AuditRepository,
  ChannelRepository,
  ClubRepository,
  LinkRequestRepository,
  MembershipRepository,
  Repositories,
  SeasonRepository,
  ExternalPlayerRepository,
  StatsRepository,
} from './types.js';
import type { SessionStatRow } from '../../core/stats/service.js';
import type { SyncRepository, SyncRunSummary } from '../../sync/types.js';
import type { ProviderId } from '../../providers/types.js';

/*
 * Implementación de los repositorios sobre Supabase.
 * Las filas se validan con zod al leerlas: si el esquema de la base de datos cambia sin
 * actualizar el código, falla de forma explícita en lugar de propagar datos incorrectos.
 */

const clubRow = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['activo', 'inactivo']),
  stats_provider: z.enum(['maritimo', 'ourproclub', 'ea', 'manual']),
});
const toClub = (r: z.infer<typeof clubRow>): Club => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  status: r.status,
  statsProvider: r.stats_provider,
});
const CLUB_COLUMNS = 'id, slug, name, status, stats_provider';

const membershipRow = z.object({
  id: z.string().uuid(),
  club_id: z.string().uuid(),
  player_id: z.string().uuid(),
  role: z.enum(CLUB_ROLES),
  positions: z.array(z.enum(POSITION_CODES)),
  shirt_number: z.number().int().nullable(),
  players: z.object({ display_name: z.string(), discord_user_id: z.string().nullable() }),
});
const toMembership = (r: z.infer<typeof membershipRow>): Membership => ({
  id: r.id,
  clubId: r.club_id,
  playerId: r.player_id,
  role: r.role,
  positions: r.positions,
  shirtNumber: r.shirt_number,
  displayName: r.players.display_name,
  discordUserId: r.players.discord_user_id,
});
const MEMBERSHIP_COLUMNS =
  'id, club_id, player_id, role, positions, shirt_number, players!inner(display_name, discord_user_id)';

const linkRequestRow = z.object({
  id: z.string().uuid(),
  club_id: z.string().uuid(),
  discord_user_id: z.string(),
  display_name: z.string(),
  ea_gamertag: z.string().nullable(),
  status: z.enum(['pendiente', 'aprobada', 'rechazada']),
});
const toLinkRequest = (r: z.infer<typeof linkRequestRow>): LinkRequest => ({
  id: r.id,
  clubId: r.club_id,
  discordUserId: r.discord_user_id,
  displayName: r.display_name,
  eaGamertag: r.ea_gamertag,
  status: r.status,
});
const LINK_COLUMNS = 'id, club_id, discord_user_id, display_name, ea_gamertag, status';

const seasonRow = z.object({
  id: z.string().uuid(),
  club_id: z.string().uuid(),
  name: z.string(),
  is_current: z.boolean(),
  starts_on: z.string().nullable(),
  ends_on: z.string().nullable(),
});
const toSeason = (r: z.infer<typeof seasonRow>): Season => ({
  id: r.id,
  clubId: r.club_id,
  name: r.name,
  isCurrent: r.is_current,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
});

/** PostgREST puede devolver bigint/numeric como número o como texto: se normaliza. */
const num = z.union([z.number(), z.string()]).transform((v) => Number(v));
const numOrNull = num.nullable();

const sessionStatRow = z.object({
  season_id: z.string().uuid().nullable(),
  player_id: z.string().uuid().nullable(),
  source: z.string(),
  source_player_id: z.string(),
  source_player_name: z.string(),
  sessions: num,
  matches_played: numOrNull,
  goals: numOrNull,
  assists: numOrNull,
  shots: numOrNull,
  dribbles: numOrNull,
  passes_made: numOrNull,
  passes_attempted: numOrNull,
  tackles_made: numOrNull,
  tackles_attempted: numOrNull,
  interceptions: numOrNull,
  blocks: numOrNull,
  clearances: numOrNull,
  saves: numOrNull,
  rating_points: numOrNull,
  rated_matches: numOrNull,
});
const toSessionStatRow = (r: z.infer<typeof sessionStatRow>): SessionStatRow => ({
  seasonId: r.season_id,
  playerId: r.player_id,
  source: r.source,
  sourcePlayerId: r.source_player_id,
  name: r.source_player_name,
  sessions: r.sessions,
  matchesPlayed: r.matches_played,
  goals: r.goals,
  assists: r.assists,
  shots: r.shots,
  dribbles: r.dribbles,
  passesMade: r.passes_made,
  passesAttempted: r.passes_attempted,
  tacklesMade: r.tackles_made,
  tacklesAttempted: r.tackles_attempted,
  interceptions: r.interceptions,
  blocks: r.blocks,
  clearances: r.clearances,
  saves: r.saves,
  ratingPoints: r.rating_points,
  ratedMatches: r.rated_matches,
});
const SESSION_STAT_COLUMNS = Object.keys(sessionStatRow.shape).join(', ');

const syncRunRow = z.object({
  id: z.string().uuid(),
  status: z.enum(['en_curso', 'ok', 'error']),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  cursor_after: z.string().nullable(),
  rows_inserted: z.number().int(),
  rows_updated: z.number().int(),
  error_message: z.string().nullable(),
});
const toSyncRun = (r: z.infer<typeof syncRunRow>): SyncRunSummary => ({
  id: r.id,
  status: r.status,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  cursorAfter: r.cursor_after,
  rowsInserted: r.rows_inserted,
  rowsUpdated: r.rows_updated,
  errorMessage: r.error_message,
});
const SYNC_RUN_COLUMNS = Object.keys(syncRunRow.shape).join(', ');

/** Una ejecución "en curso" más antigua que esto se considera interrumpida. */
export const STALE_RUN_MINUTES = 15;
const PAGE = 1000;

export function createSupabaseRepositories(db: SupabaseClient): Repositories {
  const clubs: ClubRepository = {
    async listByGuild(guildId) {
      const rows = check(
        await db.from('club_guilds').select(`clubs(${CLUB_COLUMNS})`).eq('guild_id', guildId),
      );
      return z
        .array(z.object({ clubs: clubRow }))
        .parse(rows)
        .map((r) => toClub(r.clubs));
    },
    async register(input) {
      const rows = check(
        await db.rpc('register_club', {
          p_guild_id: input.guildId,
          p_guild_name: input.guildName,
          p_slug: input.slug,
          p_name: input.name,
          p_admin_discord_id: input.adminDiscordId,
          p_admin_display_name: input.adminDisplayName,
        }),
      );
      const [row] = z
        .array(z.object({ club_id: z.string().uuid(), membership_id: z.string().uuid() }))
        .length(1)
        .parse(rows);
      return { clubId: row!.club_id, membershipId: row!.membership_id };
    },
    async connectGuild(input) {
      const id = check(
        await db.rpc('connect_club_guild', {
          p_slug: input.slug,
          p_guild_id: input.guildId,
          p_guild_name: input.guildName,
          p_actor_discord_id: input.actorDiscordId,
        }),
      );
      return z.string().uuid().parse(id);
    },
  };

  const activeMemberships = (clubId: string) =>
    db.from('club_memberships').select(MEMBERSHIP_COLUMNS).eq('club_id', clubId).is('left_at', null);

  const memberships: MembershipRepository = {
    async findActiveByDiscordUser(clubId, discordUserId) {
      const row = check(
        await activeMemberships(clubId).eq('players.discord_user_id', discordUserId).maybeSingle(),
      );
      return row ? toMembership(membershipRow.parse(row)) : null;
    },
    async findActiveById(clubId, membershipId) {
      const row = check(await activeMemberships(clubId).eq('id', membershipId).maybeSingle());
      return row ? toMembership(membershipRow.parse(row)) : null;
    },
    async listActive(clubId) {
      const rows = check(await activeMemberships(clubId).order('joined_at'));
      return z.array(membershipRow).parse(rows).map(toMembership);
    },
    async countActiveAdmins(clubId) {
      const res = await db
        .from('club_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('club_id', clubId)
        .eq('role', 'admin')
        .is('left_at', null);
      check(res);
      return res.count ?? 0;
    },
    async updateRole(clubId, membershipId, role) {
      check(
        await db
          .from('club_memberships')
          .update({ role })
          .eq('club_id', clubId)
          .eq('id', membershipId)
          .is('left_at', null),
      );
    },
    async updatePositions(clubId, membershipId, positions) {
      check(
        await db
          .from('club_memberships')
          .update({ positions })
          .eq('club_id', clubId)
          .eq('id', membershipId)
          .is('left_at', null),
      );
    },
    async end(clubId, membershipId) {
      check(
        await db
          .from('club_memberships')
          .update({ left_at: new Date().toISOString() })
          .eq('club_id', clubId)
          .eq('id', membershipId)
          .is('left_at', null),
      );
    },
  };

  const linkRequests: LinkRequestRepository = {
    async create(clubId, input) {
      const row = check(
        await db
          .from('link_requests')
          .insert({
            club_id: clubId,
            discord_user_id: input.discordUserId,
            display_name: input.displayName,
            ea_gamertag: input.eaGamertag,
          })
          .select(LINK_COLUMNS)
          .single(),
      );
      return toLinkRequest(linkRequestRow.parse(row));
    },
    async findById(clubId, requestId) {
      const row = check(
        await db
          .from('link_requests')
          .select(LINK_COLUMNS)
          .eq('club_id', clubId)
          .eq('id', requestId)
          .maybeSingle(),
      );
      return row ? toLinkRequest(linkRequestRow.parse(row)) : null;
    },
    async listPending(clubId) {
      const rows = check(
        await db
          .from('link_requests')
          .select(LINK_COLUMNS)
          .eq('club_id', clubId)
          .eq('status', 'pendiente')
          .order('requested_at'),
      );
      return z.array(linkRequestRow).parse(rows).map(toLinkRequest);
    },
    async approve(clubId, requestId, decidedBy, role) {
      const id = check(
        await db.rpc('approve_link_request', {
          p_club_id: clubId,
          p_request_id: requestId,
          p_decided_by: decidedBy,
          p_role: role,
        }),
      );
      return { membershipId: z.string().uuid().parse(id) };
    },
    async reject(clubId, requestId, decidedBy) {
      check(
        await db
          .from('link_requests')
          .update({ status: 'rechazada', decided_at: new Date().toISOString(), decided_by: decidedBy })
          .eq('club_id', clubId)
          .eq('id', requestId)
          .eq('status', 'pendiente'),
      );
    },
  };

  const channels: ChannelRepository = {
    async set(clubId, guildId, purpose, channelId) {
      check(
        await db
          .from('club_channels')
          .upsert(
            { club_id: clubId, guild_id: guildId, purpose, channel_id: channelId },
            { onConflict: 'club_id,purpose' },
          ),
      );
    },
    async list(clubId) {
      const rows = check(
        await db.from('club_channels').select('purpose, channel_id').eq('club_id', clubId),
      );
      return z
        .array(z.object({ purpose: z.enum(CHANNEL_PURPOSES), channel_id: z.string() }))
        .parse(rows)
        .map((r) => ({ purpose: r.purpose, channelId: r.channel_id }));
    },
  };

  const seasons: SeasonRepository = {
    async create(clubId, name, makeCurrent, actorDiscordId) {
      const id = check(
        await db.rpc('create_season', {
          p_club_id: clubId,
          p_name: name,
          p_make_current: makeCurrent,
          p_actor_discord_id: actorDiscordId,
        }),
      );
      return {
        id: z.string().uuid().parse(id),
        clubId,
        name,
        isCurrent: makeCurrent,
        startsOn: null,
        endsOn: null,
      };
    },
    async list(clubId) {
      const rows = check(
        await db
          .from('seasons')
          .select('id, club_id, name, is_current, starts_on, ends_on')
          .eq('club_id', clubId)
          .order('created_at', { ascending: false }),
      );
      return z.array(seasonRow).parse(rows).map(toSeason);
    },
    async setDates(clubId, seasonId, startsOn, endsOn, actorDiscordId) {
      const n = check(
        await db.rpc('set_season_dates', {
          p_club_id: clubId,
          p_season_id: seasonId,
          p_starts_on: startsOn,
          p_ends_on: endsOn,
          p_actor_discord_id: actorDiscordId,
        }),
      );
      return z.number().int().parse(n);
    },
  };

  const audit: AuditRepository = {
    async log(entry) {
      check(
        await db.from('audit_log').insert({
          club_id: entry.clubId,
          actor_discord_id: entry.actorDiscordId,
          action: entry.action,
          entity: entry.entity ?? null,
          entity_id: entry.entityId ?? null,
          details: entry.details ?? {},
        }),
      );
    },
  };

  const stats: StatsRepository = {
    async sessionRows(clubId, seasonId) {
      const out: SessionStatRow[] = [];
      // Se pagina: PostgREST limita el número de filas por respuesta.
      for (let from = 0; ; from += PAGE) {
        let q = db
          .from('v_player_session_season_stats')
          .select(SESSION_STAT_COLUMNS)
          .eq('club_id', clubId)
          .order('source_player_id')
          .order('season_id', { nullsFirst: true })
          .order('player_id', { nullsFirst: true })
          .range(from, from + PAGE - 1);
        if (seasonId) q = q.eq('season_id', seasonId);
        const rows = z.array(sessionStatRow).parse(check(await q));
        out.push(...rows.map(toSessionStatRow));
        if (rows.length < PAGE) return out;
      }
    },
  };

  const externalPlayers: ExternalPlayerRepository = {
    async linkGamertag(clubId, playerId, gamertag, actorDiscordId) {
      const n = check(
        await db.rpc('link_player_gamertag', {
          p_club: clubId,
          p_player: playerId,
          p_gamertag: gamertag,
          p_actor: actorDiscordId,
        }),
      );
      return z.number().int().parse(n);
    },
  };

  const sync: SyncRepository = {
    async clubProvider(clubId) {
      const row = check(await db.from('clubs').select('stats_provider').eq('id', clubId).maybeSingle());
      return row ? (clubRow.pick({ stats_provider: true }).parse(row).stats_provider as ProviderId) : null;
    },
    async lastRun(clubId, provider) {
      const row = check(
        await db
          .from('provider_sync_runs')
          .select(SYNC_RUN_COLUMNS)
          .eq('club_id', clubId)
          .eq('provider', provider)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      return row ? toSyncRun(syncRunRow.parse(row)) : null;
    },
    async lastCursor(clubId, provider) {
      const row = check(
        await db
          .from('provider_sync_runs')
          .select('cursor_after')
          .eq('club_id', clubId)
          .eq('provider', provider)
          .eq('status', 'ok')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      return row ? z.object({ cursor_after: z.string().nullable() }).parse(row).cursor_after : null;
    },
    async startRun(clubId, provider, cursorBefore) {
      const staleBefore = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();
      check(
        await db
          .from('provider_sync_runs')
          .update({
            status: 'error',
            finished_at: new Date().toISOString(),
            error_message: 'Interrumpida: superó el tiempo máximo.',
          })
          .eq('club_id', clubId)
          .eq('provider', provider)
          .eq('status', 'en_curso')
          .lt('started_at', staleBefore),
      );
      const row = check(
        await db
          .from('provider_sync_runs')
          .insert({ club_id: clubId, provider, cursor_before: cursorBefore })
          .select('id')
          .single(),
      );
      return z.object({ id: z.string().uuid() }).parse(row).id;
    },
    async finishRun(clubId, runId, input) {
      check(
        await db
          .from('provider_sync_runs')
          .update({
            status: input.status,
            finished_at: new Date().toISOString(),
            cursor_after: input.cursorAfter,
            rows_inserted: input.rowsInserted,
            rows_updated: input.rowsUpdated,
            error_message: input.errorMessage,
          })
          .eq('club_id', clubId)
          .eq('id', runId),
      );
    },
    async applyPlayers(clubId, provider, players) {
      const n = check(
        await db.rpc('sync_apply_players', { p_club: clubId, p_source: provider, p_players: players }),
      );
      return z.number().int().parse(n);
    },
    async applySession(clubId, provider, session) {
      const r = check(
        await db.rpc('sync_apply_session', { p_club: clubId, p_source: provider, p_session: session }),
      );
      return z.enum(['insertada', 'actualizada', 'sin_cambios']).parse(r);
    },
    async applyDeletion(clubId, provider, deletion) {
      const r = check(
        await db.rpc('sync_apply_deletion', {
          p_club: clubId,
          p_source: provider,
          p_kind: deletion.kind,
          p_external_id: deletion.externalId,
        }),
      );
      return z.boolean().parse(r);
    },
  };

  return { clubs, memberships, linkRequests, channels, seasons, audit, stats, externalPlayers, sync };
}
