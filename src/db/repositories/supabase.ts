import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { CALLUP_ANSWERS, CHANNEL_PURPOSES, CLUB_ROLES, POSITION_CODES } from '../../core/types.js';
import type { Callup, Club, LinkRequest, Lineup, Membership, Season } from '../../core/types.js';
import { check } from '../errors.js';
import type {
  AuditRepository,
  EaCaptureRepository,
  EaRepository,
  ReminderRepository,
  CallupRepository,
  LineupRepository,
  ChannelRepository,
  ClubRepository,
  LinkRequestRepository,
  MembershipRepository,
  Repositories,
  SeasonRepository,
  OurProClubRepository,
  ExternalPlayerRepository,
  StatsRepository,
} from './types.js';
import type { SessionStatRow } from '../../core/stats/service.js';
import type { SyncRepository, SyncRunSummary } from '../../sync/types.js';
import type { ProviderId } from '../../providers/types.js';
import { EA_MATCH_TYPES, EA_PLATFORMS } from '../../providers/ea/ingest.js';

/*
 * Implementación de los repositorios sobre Supabase.
 * Las filas se validan con zod al leerlas: si el esquema de la base de datos cambia sin
 * actualizar el código, falla de forma explícita en lugar de propagar datos incorrectos.
 */

const clubRow = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['activo', 'inactivo', 'pendiente', 'rechazado']),
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
  clean_sheets: numOrNull,
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
  cleanSheets: r.clean_sheets,
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
    async listAdmin() {
      const rows = check(
        await db
          .from('clubs')
          .select(
            'id,slug,name,status,created_at,web_public,website_url,club_guilds(guild_id,guilds(name)),club_memberships(left_at),club_ea_links(club_id)',
          )
          .order('created_at', { ascending: false })
          .limit(500),
      );
      const row = z.object({
        id: z.string().uuid(),
        slug: z.string(),
        name: z.string(),
        status: clubRow.shape.status,
        created_at: z.string(),
        web_public: z.boolean(),
        website_url: z.string().nullable(),
        club_guilds: z.array(
          z.object({ guild_id: z.string(), guilds: z.object({ name: z.string().nullable() }).nullable() }),
        ),
        club_memberships: z.array(z.object({ left_at: z.string().nullable() })),
        club_ea_links: z.union([z.array(z.object({ club_id: z.string() })), z.object({ club_id: z.string() }), z.null()]),
      });
      return z
        .array(row)
        .parse(rows)
        .map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          status: r.status,
          createdAt: r.created_at,
          webPublic: r.web_public,
          websiteUrl: r.website_url,
          guilds: r.club_guilds.map((g) => ({ id: g.guild_id, name: g.guilds?.name ?? null })),
          members: r.club_memberships.filter((m) => m.left_at === null).length,
          eaLinked: Array.isArray(r.club_ea_links) ? r.club_ea_links.length > 0 : r.club_ea_links !== null,
        }));
    },
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
    async listPublic() {
      const rows = check(await db.rpc('list_public_clubs'));
      return z
        .array(z.object({ slug: z.string(), name: z.string(), has_crest: z.boolean() }))
        .parse(rows)
        .map((r) => ({ slug: r.slug, name: r.name, hasCrest: r.has_crest }));
    },
    async findPublic(slug) {
      const row = check(
        await db
          .from('clubs')
          .select(CLUB_COLUMNS)
          .eq('slug', slug)
          .eq('web_public', true)
          .eq('status', 'activo')
          .maybeSingle(),
      );
      return row ? toClub(clubRow.parse(row)) : null;
    },
    async setStatus(clubId, status, actorDiscordId) {
      check(
        await db.rpc('set_club_status', {
          p_club_id: clubId,
          p_status: status,
          p_actor_discord_id: actorDiscordId,
        }),
      );
    },
    async setWebPublic(clubId, isPublic, actorDiscordId) {
      check(
        await db.rpc('set_club_web', {
          p_club_id: clubId,
          p_public: isPublic,
          p_actor_discord_id: actorDiscordId,
        }),
      );
    },
    async webPublic(clubId) {
      const row = check(await db.from('clubs').select('web_public').eq('id', clubId).maybeSingle());
      return row ? z.object({ web_public: z.boolean() }).parse(row).web_public : false;
    },
    async website(clubId) {
      const row = check(await db.from('clubs').select('website_url').eq('id', clubId).maybeSingle());
      return row ? z.object({ website_url: z.string().nullable() }).parse(row).website_url : null;
    },
    async setWebsite(clubId, url, actorDiscordId) {
      check(
        await db.rpc('set_club_website', { p_club_id: clubId, p_url: url, p_actor_discord_id: actorDiscordId }),
      );
    },
    async setGuildName(guildId, name) {
      check(await db.from('guilds').update({ name }).eq('id', guildId).is('name', null));
    },
    async crest(clubId) {
      const row = check(await db.from('clubs').select('crest_png').eq('id', clubId).maybeSingle());
      return row ? z.object({ crest_png: z.string().nullable() }).parse(row).crest_png : null;
    },
    async withoutCrest(limit) {
      const rows = z
        .array(z.object({ id: z.string().uuid(), club_guilds: z.array(z.object({ guild_id: z.string() })) }))
        .parse(
          check(
            await db
              .from('clubs')
              .select('id,club_guilds(guild_id)')
              .is('crest_png', null)
              .eq('status', 'activo')
              .order('created_at', { ascending: true })
              .limit(limit),
          ),
        );
      const guildIds = [...new Set(rows.flatMap((r) => r.club_guilds.map((g) => g.guild_id)))];
      if (guildIds.length === 0) return [];
      const links = z
        .array(z.object({ guild_id: z.string(), club_id: z.string() }))
        .parse(check(await db.from('club_guilds').select('guild_id,club_id').in('guild_id', guildIds)));
      const owners = new Map<string, Set<string>>();
      for (const l of links) owners.set(l.guild_id, (owners.get(l.guild_id) ?? new Set()).add(l.club_id));
      return rows.map((r) => ({
        clubId: r.id,
        guildIds: r.club_guilds.map((g) => g.guild_id).filter((g) => owners.get(g)?.size === 1),
      }));
    },
    async setAutoCrest(clubId, pngBase64) {
      const rows = check(
        await db.from('clubs').update({ crest_png: pngBase64 }).eq('id', clubId).is('crest_png', null).select('id'),
      );
      return Array.isArray(rows) && rows.length > 0;
    },
    async setCrest(clubId, pngBase64, actorDiscordId) {
      check(
        await db.rpc('set_club_crest', {
          p_club_id: clubId,
          p_png_base64: pngBase64,
          p_actor_discord_id: actorDiscordId,
        }),
      );
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
    async photo(clubId, playerId) {
      const row = check(
        await db
          .from('club_memberships')
          .select('photo_jpg')
          .eq('club_id', clubId)
          .eq('player_id', playerId)
          .is('left_at', null)
          .maybeSingle(),
      );
      return row ? z.object({ photo_jpg: z.string().nullable() }).parse(row).photo_jpg : null;
    },
    async withPhoto(clubId) {
      const rows = check(
        await db
          .from('club_memberships')
          .select('player_id')
          .eq('club_id', clubId)
          .is('left_at', null)
          .not('photo_jpg', 'is', null),
      );
      return new Set(z.array(z.object({ player_id: z.string() })).parse(rows).map((r) => r.player_id));
    },
    async setPhoto(clubId, membershipId, jpgBase64, actorDiscordId) {
      check(
        await db.rpc('set_member_photo', {
          p_club_id: clubId,
          p_membership_id: membershipId,
          p_jpg_base64: jpgBase64,
          p_actor_discord_id: actorDiscordId,
        }),
      );
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
        await db.from('club_channels').select('purpose, channel_id, guild_id').eq('club_id', clubId),
      );
      return z
        .array(z.object({ purpose: z.enum(CHANNEL_PURPOSES), channel_id: z.string(), guild_id: z.string() }))
        .parse(rows)
        .map((r) => ({ purpose: r.purpose, channelId: r.channel_id, guildId: r.guild_id }));
    },
  };

  const ourproclub: OurProClubRepository = {
    async channels() {
      const rows = check(
        await db.from('club_channels').select('club_id, guild_id, channel_id').eq('purpose', 'ourproclub'),
      );
      return z
        .array(z.object({ club_id: z.string().uuid(), guild_id: z.string(), channel_id: z.string() }))
        .parse(rows)
        .map((r) => ({ clubId: r.club_id, guildId: r.guild_id, channelId: r.channel_id }));
    },
    async latest(clubId) {
      // Los ids de Discord crecen con el tiempo; el más reciente es el de fecha mayor.
      const row = check(
        await db
          .from('ourproclub_messages')
          .select('message_id')
          .eq('club_id', clubId)
          .order('posted_at', { ascending: false })
          .order('message_id', { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      return row ? z.object({ message_id: z.string() }).parse(row).message_id : null;
    },
    async record(clubId, rows) {
      if (rows.length === 0) return;
      check(
        await db.from('ourproclub_messages').upsert(
          rows.map((r) => ({ club_id: clubId, message_id: r.messageId, kind: r.kind, posted_at: r.postedAt })),
          { onConflict: 'club_id,message_id', ignoreDuplicates: true },
        ),
      );
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
    async claimSessionRecaps(clubId, limit) {
      const ids = check(await db.rpc('claim_session_recaps', { p_club: clubId, p_limit: limit }));
      return z.array(z.string().uuid()).parse(ids ?? []);
    },
    async releaseSessionRecaps(clubId, sessionIds) {
      if (sessionIds.length === 0) return;
      check(await db.rpc('release_session_recaps', { p_club: clubId, p_ids: sessionIds }));
    },
    async clubsWithPendingRecaps() {
      const rows = check(
        await db
          .from('sessions')
          .select('club_id')
          .is('recap_posted_at', null)
          .eq('is_duplicate', false)
          .neq('source', 'manual')
          .limit(200),
      );
      return [...new Set(z.array(z.object({ club_id: z.string().uuid() })).parse(rows).map((r) => r.club_id))];
    },
    async sessionRecaps(clubId, sessionIds) {
      if (sessionIds.length === 0) return [];
      const sessions = z
        .array(
          z.object({
            id: z.string().uuid(),
            season_id: z.string().uuid().nullable(),
            played_on: z.string(),
            published_at: z.string().nullable(),
            matches_played: z.number().nullable(),
            wins: z.number().nullable(),
            draws: z.number().nullable(),
            losses: z.number().nullable(),
          }),
        )
        .parse(
          check(
            await db
              .from('sessions')
              .select('id, season_id, played_on, published_at, matches_played, wins, draws, losses')
              .eq('club_id', clubId)
              .in('id', sessionIds),
          ),
        );
      const n = z.number().nullable();
      const stats = z
        .array(
          z.object({
            session_id: z.string().uuid(),
            player_id: z.string().uuid().nullable(),
            source_player_id: z.string(),
            source_player_name: z.string(),
            matches_played: n,
            rating: n,
            goals: n,
            assists: n,
            shots: n,
            dribbles: n,
            passes_made: n,
            passes_attempted: n,
            tackles_made: n,
            tackles_attempted: n,
            interceptions: n,
            blocks: n,
            clearances: n,
            saves: n,
          }),
        )
        .parse(
          check(
            await db
              .from('player_session_stats')
              .select(
                'session_id, player_id, source_player_id, source_player_name, matches_played, rating, goals, assists, shots, dribbles, passes_made, passes_attempted, tackles_made, tackles_attempted, interceptions, blocks, clearances, saves',
              )
              .eq('club_id', clubId)
              .in('session_id', sessionIds),
          ),
        );
      // Media de temporada de cada jugador (suma de puntos / partidos calificados de la vista).
      const seasonIds = [...new Set(sessions.map((x) => x.season_id).filter((x): x is string => x !== null))];
      const avg = new Map<string, number>();
      if (seasonIds.length) {
        const rows = z
          .array(
            z.object({
              season_id: z.string().uuid().nullable(),
              source_player_id: z.string(),
              rating_points: z.coerce.number().nullable(),
              rated_matches: z.coerce.number().nullable(),
            }),
          )
          .parse(
            check(
              await db
                .from('v_player_session_season_stats')
                .select('season_id, source_player_id, rating_points, rated_matches')
                .eq('club_id', clubId)
                .in('season_id', seasonIds),
            ),
          );
        const sums = new Map<string, [number, number]>();
        for (const r of rows) {
          if (r.rating_points === null || !r.rated_matches) continue;
          const k = `${r.season_id}:${r.source_player_id}`;
          const cur = sums.get(k) ?? [0, 0];
          sums.set(k, [cur[0] + r.rating_points, cur[1] + r.rated_matches]);
        }
        for (const [k, [pts, m]] of sums) if (m > 0) avg.set(k, pts / m);
      }
      return sessions.map((x) => ({
        sessionId: x.id,
        playedOn: x.played_on,
        publishedAt: x.published_at,
        matchesPlayed: x.matches_played,
        wins: x.wins,
        draws: x.draws,
        losses: x.losses,
        players: stats
          .filter((r) => r.session_id === x.id)
          .map((r) => ({
            name: r.source_player_name,
            playerId: r.player_id,
            matchesPlayed: r.matches_played,
            rating: r.rating,
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
            seasonRating: avg.get(`${x.season_id}:${r.source_player_id}`) ?? null,
          })),
      }));
    },
    async sessionRows(clubId, seasonId, matchTypes) {
      const out: SessionStatRow[] = [];
      // Proveedores por sesión (Marítimo…) y partidos de EA procesados (solo el lado propio).
      for (const view of ['v_player_session_season_stats', 'v_ea_player_season_stats']) {
        // Con filtro de tipo, las sesiones sin tipo conocido (match_type NULL) quedan fuera.
        out.push(...(await statRowsFrom(view, clubId, seasonId, matchTypes)));
      }
      return out;
    },
  };

  async function statRowsFrom(
    view: string,
    clubId: string,
    seasonId: string | null,
    matchTypes?: readonly string[],
  ): Promise<SessionStatRow[]> {
    const out: SessionStatRow[] = [];
    // Se pagina: PostgREST limita el número de filas por respuesta.
    for (let from = 0; ; from += PAGE) {
      let q = db
        .from(view)
        .select(SESSION_STAT_COLUMNS)
        .eq('club_id', clubId)
        .order('source_player_id')
        .order('season_id', { nullsFirst: true })
        .order('player_id', { nullsFirst: true })
        .range(from, from + PAGE - 1);
      if (seasonId) q = q.eq('season_id', seasonId);
      if (matchTypes) q = q.in('match_type', [...matchTypes]);
      const rows = z.array(sessionStatRow).parse(check(await q));
      out.push(...rows.map(toSessionStatRow));
      if (rows.length < PAGE) return out;
    }
  }

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
    async knowsGamertag(clubId, gamertag) {
      // ilike sin comodines: se escapan % y _ (habituales en los gamertags).
      const exact = gamertag.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`);
      if (!exact) return false;
      const [fichas, ea, sesiones] = await Promise.all([
        db.from('external_players').select('id', { count: 'exact', head: true }).eq('club_id', clubId).ilike('gamertag', exact),
        db
          .from('ea_match_players')
          .select('match_id', { count: 'exact', head: true })
          .eq('club_id', clubId)
          .eq('side', 'propio')
          .ilike('gamertag', exact),
        db
          .from('player_session_stats')
          .select('id', { count: 'exact', head: true })
          .eq('club_id', clubId)
          .ilike('source_player_name', exact),
      ]);
      // Cada consulta se comprueba por separado (tipos distintos); cualquier error se propaga.
      check(fichas);
      check(ea);
      check(sesiones);
      return [fichas, ea, sesiones].some((r) => (r.count ?? 0) > 0);
    },
    async accountsOf(discordUserId) {
      const rows = check(
        await db
          .from('club_memberships')
          .select('club_id, player_id, gamertag, players!inner(discord_user_id), clubs!inner(slug, name, status, web_public)')
          .eq('players.discord_user_id', discordUserId)
          .is('left_at', null),
      );
      return z
        .array(
          z.object({
            club_id: z.string().uuid(),
            player_id: z.string().uuid(),
            gamertag: z.string().nullable(),
            clubs: z.object({ slug: z.string(), name: z.string(), status: z.string(), web_public: z.boolean() }),
          }),
        )
        .parse(rows)
        .map((r) => ({
          clubId: r.club_id,
          clubSlug: r.clubs.slug,
          clubName: r.clubs.name,
          clubPublic: r.clubs.web_public && r.clubs.status === 'activo',
          playerId: r.player_id,
          gamertag: r.gamertag,
        }));
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
    async schedulerKeyHash() {
      const row = check(
        await db.from('scheduler_keys').select('token_hash').eq('name', 'supabase').maybeSingle(),
      );
      return row ? z.object({ token_hash: z.string() }).parse(row).token_hash : null;
    },
    async lastMatchVersion(clubId, provider) {
      const row = check(
        await db
          .from('matches')
          .select('source_updated_at')
          .eq('club_id', clubId)
          .eq('source', provider)
          .not('source_updated_at', 'is', null)
          .order('source_updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      return row ? z.object({ source_updated_at: z.string() }).parse(row).source_updated_at : null;
    },
    async applyMatch(clubId, provider, match) {
      const r = check(
        await db.rpc('sync_apply_match', { p_club: clubId, p_source: provider, p_match: match }),
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

  const eaCapture: EaCaptureRepository = {
    async store(matches) {
      if (matches.length === 0) return 0;
      const rows = check(
        await db
          .from('ea_match_cache')
          .upsert(
            matches.map((m) => ({
              platform: m.platform,
              ea_club_id: m.eaClubId,
              match_id: m.matchId,
              match_type: m.matchType,
              played_at: m.playedAt,
              payload: m.payload,
            })),
            { onConflict: 'platform,ea_club_id,match_id', ignoreDuplicates: true },
          )
          .select('match_id'),
      );
      return Array.isArray(rows) ? rows.length : 0;
    },
  };

  const eaLinkRow = z.object({
    club_id: z.string().uuid(),
    platform: z.enum(EA_PLATFORMS),
    ea_club_id: z.string(),
    consented_by: z.string(),
    consented_at: z.string(),
  });
  const toLink = (r: z.infer<typeof eaLinkRow>) => ({
    clubId: r.club_id,
    platform: r.platform,
    eaClubId: r.ea_club_id,
    consentedBy: r.consented_by,
    consentedAt: r.consented_at,
  });
  const EA_LINK_COLUMNS = 'club_id, platform, ea_club_id, consented_by, consented_at';

  const ea: EaRepository = {
    async link(clubId, platform, eaClubId, actorDiscordId) {
      check(
        await db.rpc('link_ea_club', {
          p_club_id: clubId,
          p_platform: platform,
          p_ea_club_id: eaClubId,
          p_actor_discord_id: actorDiscordId,
        }),
      );
    },
    async unlink(clubId, actorDiscordId) {
      const r = check(await db.rpc('unlink_ea_club', { p_club_id: clubId, p_actor_discord_id: actorDiscordId }));
      return z.boolean().parse(r);
    },
    async getLink(clubId) {
      const row = check(await db.from('club_ea_links').select(EA_LINK_COLUMNS).eq('club_id', clubId).maybeSingle());
      return row ? toLink(eaLinkRow.parse(row)) : null;
    },
    async consented(platform, eaClubId) {
      const rows = check(
        await db.from('club_ea_links').select('club_id').eq('platform', platform).eq('ea_club_id', eaClubId).limit(1),
      );
      return Array.isArray(rows) && rows.length > 0;
    },
    async listLinks() {
      const rows = check(await db.from('club_ea_links').select(EA_LINK_COLUMNS));
      return z.array(eaLinkRow).parse(rows).map(toLink);
    },
    async pending(clubId, limit) {
      const link = await ea.getLink(clubId);
      if (!link) return [];
      const rows = check(await db.rpc('pending_ea_matches', { p_club_id: clubId, p_limit: limit }));
      return z
        .array(
          z.object({
            match_id: z.string(),
            match_type: z.enum(EA_MATCH_TYPES),
            played_at: z.string(),
            payload: z.record(z.string(), z.unknown()),
          }),
        )
        .parse(rows)
        .map((r) => ({
          platform: link.platform,
          eaClubId: link.eaClubId,
          matchId: r.match_id,
          matchType: r.match_type,
          playedAt: r.played_at,
          payload: r.payload,
        }));
    },
    async apply(clubId, match) {
      const r = check(await db.rpc('apply_ea_match', { p_club_id: clubId, p_match: match }));
      return z.boolean().parse(r);
    },
    async playerMatches(clubId, eaPlayerIds, limit) {
      const ids = eaPlayerIds.filter((id) => /^\d{1,20}$/.test(id));
      if (ids.length === 0) return [];
      const rows = check(
        await db
          .from('ea_match_players')
          .select(
            'match_id, position, goals, assists, shots, passes_made, passes_attempted, tackles_made, tackles_attempted, saves, rating, man_of_the_match, ea_matches(match_type, played_at, opponent_name, goals_for, goals_against, result)',
          )
          .eq('club_id', clubId)
          .eq('side', 'propio')
          .in('ea_player_id', ids)
          .limit(500),
      );
      const n = z.number().nullable();
      return z
        .array(
          z.object({
            match_id: z.string(),
            position: z.string().nullable(),
            goals: n,
            assists: n,
            shots: n,
            passes_made: n,
            passes_attempted: n,
            tackles_made: n,
            tackles_attempted: n,
            saves: n,
            rating: z.coerce.number().nullable(),
            man_of_the_match: z.boolean().nullable(),
            ea_matches: z.object({
              match_type: z.enum(EA_MATCH_TYPES),
              played_at: z.string(),
              opponent_name: z.string().nullable(),
              goals_for: n,
              goals_against: n,
              result: z.enum(['victoria', 'empate', 'derrota']).nullable(),
            }),
          }),
        )
        .parse(rows)
        .map((r) => ({
          matchId: r.match_id,
          matchType: r.ea_matches.match_type,
          playedAt: r.ea_matches.played_at,
          opponentName: r.ea_matches.opponent_name,
          goalsFor: r.ea_matches.goals_for,
          goalsAgainst: r.ea_matches.goals_against,
          result: r.ea_matches.result,
          position: r.position,
          goals: r.goals,
          assists: r.assists,
          shots: r.shots,
          passesMade: r.passes_made,
          passesAttempted: r.passes_attempted,
          tacklesMade: r.tackles_made,
          tacklesAttempted: r.tackles_attempted,
          saves: r.saves,
          rating: r.rating,
          manOfTheMatch: r.man_of_the_match,
        }))
        .sort((a, b) => b.playedAt.localeCompare(a.playedAt))
        .slice(0, limit);
    },
    async calendar(clubId, limit) {
      const rows = check(
        await db
          .from('matches')
          .select('id, match_type, played_at, goals_for, goals_against, result, opponent_name')
          .eq('club_id', clubId)
          .in('status', ['jugado', 'verificado'])
          .not('match_type', 'is', null)
          .order('played_at', { ascending: false })
          .limit(limit),
      );
      const RESULT = { V: 'victoria', E: 'empate', D: 'derrota' } as const;
      return z
        .array(
          z.object({
            id: z.string(),
            match_type: z.enum(EA_MATCH_TYPES),
            played_at: z.string(),
            goals_for: z.number().nullable(),
            goals_against: z.number().nullable(),
            result: z.enum(['V', 'E', 'D']).nullable(),
            opponent_name: z.string().nullable(),
          }),
        )
        .parse(rows)
        .map((r) => ({
          matchId: r.id,
          matchType: r.match_type,
          playedAt: r.played_at,
          goalsFor: r.goals_for,
          goalsAgainst: r.goals_against,
          result: r.result ? RESULT[r.result] : null,
          opponentName: r.opponent_name,
          opponentColors: null,
        }));
    },
    async recent(clubId, limit) {
      const rows = check(
        await db
          .from('ea_matches')
          .select(
            'match_id, match_type, played_at, goals_for, goals_against, result, opponent_name, opponent_color1, opponent_color2',
          )
          .eq('club_id', clubId)
          .order('played_at', { ascending: false })
          .limit(limit),
      );
      return z
        .array(
          z.object({
            match_id: z.string(),
            match_type: z.enum(EA_MATCH_TYPES),
            played_at: z.string(),
            goals_for: z.number().nullable(),
            goals_against: z.number().nullable(),
            result: z.enum(['victoria', 'empate', 'derrota']).nullable(),
            opponent_name: z.string().nullable(),
            opponent_color1: z.string().nullable().default(null),
            opponent_color2: z.string().nullable().default(null),
          }),
        )
        .parse(rows)
        .map((r) => ({
          matchId: r.match_id,
          matchType: r.match_type,
          playedAt: r.played_at,
          goalsFor: r.goals_for,
          goalsAgainst: r.goals_against,
          result: r.result,
          opponentName: r.opponent_name,
          opponentColors: r.opponent_color1
            ? { primary: r.opponent_color1, secondary: r.opponent_color2 ?? r.opponent_color1 }
            : null,
        }));
    },
    async claimRecaps(clubId, limit) {
      const rows = check(await db.rpc('claim_ea_recaps', { p_club_id: clubId, p_limit: limit }));
      return z.array(z.string()).parse(rows);
    },
    async releaseRecaps(clubId, matchIds) {
      if (matchIds.length === 0) return;
      check(await db.rpc('release_ea_recaps', { p_club_id: clubId, p_match_ids: matchIds }));
    },
    async recaps(clubId, matchIds) {
      if (matchIds.length === 0) return [];
      const rows = check(await db.rpc('ea_recap', { p_club_id: clubId, p_match_ids: matchIds }));
      return z
        .array(
          z.object({
            matchId: z.string(),
            matchType: z.enum(EA_MATCH_TYPES),
            playedAt: z.string(),
            goalsFor: z.number().nullable(),
            goalsAgainst: z.number().nullable(),
            result: z.enum(['victoria', 'empate', 'derrota']).nullable(),
            opponentName: z.string().nullable(),
            opponentColors: z
              .object({ primary: z.string().regex(/^#[0-9a-f]{6}$/), secondary: z.string().regex(/^#[0-9a-f]{6}$/) })
              .nullable()
              .default(null),
            players: z.array(
              z.object({
                name: z.string(),
                position: z.string().nullable().default(null),
                goals: z.number().nullable(),
                assists: z.number().nullable(),
                rating: numOrNull,
                shots: z.number().nullable().default(null),
                passesMade: z.number().nullable().default(null),
                passesAttempted: z.number().nullable().default(null),
                tacklesMade: z.number().nullable().default(null),
                tacklesAttempted: z.number().nullable().default(null),
                saves: z.number().nullable().default(null),
                manOfTheMatch: z.boolean().nullable(),
              }),
            ),
          }),
        )
        .parse(rows);
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
    eaCapture,
    ea,
    ourproclub,
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
