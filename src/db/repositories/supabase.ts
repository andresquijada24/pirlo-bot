import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { CALLUP_ANSWERS, CHANNEL_PURPOSES, CLUB_ROLES, POSITION_CODES } from '../../core/types.js';
import type { Callup, Club, LinkRequest, Lineup, Membership, Season } from '../../core/types.js';
import { check } from '../errors.js';
import type {
  AuditRepository,
  ReminderRepository,
  CallupRepository,
  LineupRepository,
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
  timezone: z.string(),
  reminder_minutes: z.number().int().nullable(),
});
const toClub = (r: z.infer<typeof clubRow>): Club => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  status: r.status,
  statsProvider: r.stats_provider,
  timezone: r.timezone,
  reminderMinutes: r.reminder_minutes,
});
const CLUB_COLUMNS = 'id, slug, name, status, stats_provider, timezone, reminder_minutes';

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

const callupRow = z.object({
  id: z.string().uuid(),
  club_id: z.string().uuid(),
  title: z.string(),
  opponent_name: z.string().nullable(),
  starts_at: z.string(),
  closes_at: z.string().nullable(),
  status: z.enum(['abierta', 'cerrada', 'cancelada']),
});
const toCallup = (r: z.infer<typeof callupRow>): Callup => ({
  id: r.id,
  clubId: r.club_id,
  title: r.title,
  opponent: r.opponent_name,
  startsAt: new Date(r.starts_at).toISOString(),
  closesAt: r.closes_at ? new Date(r.closes_at).toISOString() : null,
  status: r.status,
});
const CALLUP_COLUMNS = Object.keys(callupRow.shape).join(', ');
const lineupRow = z.object({
  id: z.string().uuid(),
  club_id: z.string().uuid(),
  callup_id: z.string().uuid().nullable(),
  formation: z.string(),
  status: z.enum(['borrador', 'publicada']),
  lineup_slots: z.array(
    z.object({
      slot: z.number().int(),
      position: z.enum(POSITION_CODES).nullable(),
      player_id: z.string().uuid().nullable(),
      is_substitute: z.boolean(),
    }),
  ),
});
const toLineup = (r: z.infer<typeof lineupRow>): Lineup => ({
  id: r.id,
  clubId: r.club_id,
  callupId: r.callup_id,
  formation: r.formation,
  status: r.status,
  slots: r.lineup_slots
    .map((s) => ({ slot: s.slot, position: s.position, playerId: s.player_id, substitute: s.is_substitute }))
    .sort((a, b) => a.slot - b.slot),
});
const LINEUP_COLUMNS = 'id, club_id, callup_id, formation, status, lineup_slots(slot, position, player_id, is_substitute)';

/** Una convocatoria sigue en la lista unas horas después de empezar (por si el partido se alarga). */
const CALLUP_GRACE_MS = 3 * 60 * 60 * 1000;

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
    async setTimezone(clubId, timezone) {
      check(await db.from('clubs').update({ timezone }).eq('id', clubId));
    },
    async setReminderMinutes(clubId, minutes) {
      check(await db.from('clubs').update({ reminder_minutes: minutes }).eq('id', clubId));
    },
    async disconnectGuild(clubId, guildId, actorDiscordId) {
      check(
        await db.rpc('disconnect_club_guild', {
          p_club_id: clubId,
          p_guild_id: guildId,
          p_actor_discord_id: actorDiscordId,
        }),
      );
    },
    async findById(clubId) {
      const row = check(await db.from('clubs').select(CLUB_COLUMNS).eq('id', clubId).maybeSingle());
      return row ? toClub(clubRow.parse(row)) : null;
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

  const callups: CallupRepository = {
    async create(clubId, input, actorDiscordId) {
      const id = check(
        await db.rpc('create_callup', {
          p_club_id: clubId,
          p_title: input.title,
          p_opponent: input.opponent,
          p_starts_at: input.startsAt.toISOString(),
          p_closes_at: input.closesAt ? input.closesAt.toISOString() : null,
          p_actor_discord_id: actorDiscordId,
        }),
      );
      return z.string().uuid().parse(id);
    },
    async findById(clubId, callupId) {
      const row = check(
        await db.from('callups').select(CALLUP_COLUMNS).eq('club_id', clubId).eq('id', callupId).maybeSingle(),
      );
      return row ? toCallup(callupRow.parse(row)) : null;
    },
    async listUpcoming(clubId, limit) {
      const rows = check(
        await db
          .from('callups')
          .select(CALLUP_COLUMNS)
          .eq('club_id', clubId)
          .eq('status', 'abierta')
          .gte('starts_at', new Date(Date.now() - CALLUP_GRACE_MS).toISOString())
          .order('starts_at')
          .limit(limit),
      );
      return z.array(callupRow).parse(rows).map(toCallup);
    },
    async next(clubId) {
      const row = check(
        await db
          .from('callups')
          .select(CALLUP_COLUMNS)
          .eq('club_id', clubId)
          .neq('status', 'cancelada')
          .gte('starts_at', new Date(Date.now() - CALLUP_GRACE_MS).toISOString())
          .order('starts_at')
          .limit(1)
          .maybeSingle(),
      );
      return row ? toCallup(callupRow.parse(row)) : null;
    },
    async responses(clubId, callupId) {
      const rows = check(
        await db.from('callup_responses').select('player_id, answer').eq('club_id', clubId).eq('callup_id', callupId),
      );
      return z
        .array(z.object({ player_id: z.string().uuid(), answer: z.enum(CALLUP_ANSWERS) }))
        .parse(rows)
        .map((r) => ({ playerId: r.player_id, answer: r.answer }));
    },
    async respond(clubId, callupId, playerId, answer) {
      check(
        await db.rpc('respond_callup', {
          p_club_id: clubId,
          p_callup_id: callupId,
          p_player_id: playerId,
          p_answer: answer,
        }),
      );
    },
    async cancel(clubId, callupId, actorDiscordId) {
      check(
        await db.rpc('cancel_callup', { p_club_id: clubId, p_callup_id: callupId, p_actor_discord_id: actorDiscordId }),
      );
    },
    async recordMessage(clubId, callupId, channelId, messageId) {
      check(
        await db
          .from('callup_messages')
          .upsert(
            { club_id: clubId, callup_id: callupId, channel_id: channelId, message_id: messageId },
            { onConflict: 'callup_id,message_id', ignoreDuplicates: true },
          ),
      );
    },
    async messages(clubId, callupId) {
      const rows = check(
        await db
          .from('callup_messages')
          .select('channel_id, message_id')
          .eq('club_id', clubId)
          .eq('callup_id', callupId)
          .order('created_at')
          .limit(20),
      );
      return z
        .array(z.object({ channel_id: z.string(), message_id: z.string() }))
        .parse(rows)
        .map((r) => ({ channelId: r.channel_id, messageId: r.message_id }));
    },
    async close(clubId, callupId, actorDiscordId) {
      check(
        await db.rpc('close_callup', { p_club_id: clubId, p_callup_id: callupId, p_actor_discord_id: actorDiscordId }),
      );
    },
  };

  const lineups: LineupRepository = {
    async create(clubId, input, actorDiscordId) {
      const id = check(
        await db.rpc('create_lineup', {
          p_club_id: clubId,
          p_callup_id: input.callupId,
          p_formation: input.formation,
          p_positions: input.positions,
          p_replace: input.replace,
          p_actor_discord_id: actorDiscordId,
        }),
      );
      return z.string().uuid().parse(id);
    },
    async findByCallup(clubId, callupId) {
      const row = check(
        await db
          .from('lineups')
          .select(LINEUP_COLUMNS)
          .eq('club_id', clubId)
          .eq('callup_id', callupId)
          .eq('lineup_slots.club_id', clubId)
          .maybeSingle(),
      );
      return row ? toLineup(lineupRow.parse(row)) : null;
    },
    async assign(clubId, lineupId, playerId, target) {
      const slot = check(
        await db.rpc('lineup_assign', {
          p_club_id: clubId,
          p_lineup_id: lineupId,
          p_player_id: playerId,
          p_position: 'position' in target ? target.position : null,
          p_substitute: 'substitute' in target,
        }),
      );
      return z.number().int().parse(slot);
    },
    async remove(clubId, lineupId, playerId) {
      const r = check(
        await db.rpc('lineup_remove', { p_club_id: clubId, p_lineup_id: lineupId, p_player_id: playerId }),
      );
      return z.boolean().parse(r);
    },
    async publish(clubId, lineupId, actorDiscordId) {
      check(
        await db.rpc('publish_lineup', { p_club_id: clubId, p_lineup_id: lineupId, p_actor_discord_id: actorDiscordId }),
      );
    },
  };

  const reminders: ReminderRepository = {
    async due(limit, blockedGuilds) {
      const rows = check(
        await db.rpc('due_callup_reminders', { p_limit: limit, p_blocked_guilds: blockedGuilds }),
      );
      return z
        .array(
          z.object({
            club_id: z.string().uuid(),
            callup_id: z.string().uuid(),
            guild_id: z.string(),
            channel_id: z.string(),
          }),
        )
        .parse(rows)
        .map((r) => ({ clubId: r.club_id, callupId: r.callup_id, guildId: r.guild_id, channelId: r.channel_id }));
    },
    async release(clubId, callupId) {
      check(await db.rpc('release_callup_reminder', { p_club_id: clubId, p_callup_id: callupId }));
    },
    async claim(clubId, callupId) {
      const r = check(await db.rpc('claim_callup_reminder', { p_club_id: clubId, p_callup_id: callupId }));
      return z.boolean().parse(r);
    },
  };

  return {
    reminders,
    clubs,
    memberships,
    linkRequests,
    channels,
    seasons,
    audit,
    stats,
    externalPlayers,
    sync,
    callups,
    lineups,
  };
}
