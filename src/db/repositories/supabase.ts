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
} from './types.js';

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
});
const toSeason = (r: z.infer<typeof seasonRow>): Season => ({
  id: r.id,
  clubId: r.club_id,
  name: r.name,
  isCurrent: r.is_current,
});

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
      return { id: z.string().uuid().parse(id), clubId, name, isCurrent: makeCurrent };
    },
    async list(clubId) {
      const rows = check(
        await db
          .from('seasons')
          .select('id, club_id, name, is_current')
          .eq('club_id', clubId)
          .order('created_at', { ascending: false }),
      );
      return z.array(seasonRow).parse(rows).map(toSeason);
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

  return { clubs, memberships, linkRequests, channels, seasons, audit };
}
