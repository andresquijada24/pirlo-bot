import { conflict, notFound } from '../../src/core/errors.js';
import type {
  ChannelPurpose,
  Club,
  LinkRequest,
  Membership,
  Season,
} from '../../src/core/types.js';
import type { AuditEntry, Repositories } from '../../src/db/repositories/types.js';
import type { SessionStatRow } from '../../src/core/stats/service.js';
import type { ProviderId } from '../../src/providers/types.js';
import type { SyncRunSummary } from '../../src/sync/types.js';

/**
 * Repositorios en memoria SOLO para pruebas. Reproducen las reglas relevantes de la base de
 * datos (aislamiento por club, unicidad, un club por servidor salvo multiclub).
 * Los datos aquí son ficticios y nunca llegan a Supabase.
 */
export function createMemoryRepos() {
  let seq = 0;
  const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

  const state = {
    clubs: [] as Club[],
    clubGuilds: [] as { clubId: string; guildId: string }[],
    multiClubGuilds: new Set<string>(),
    memberships: [] as (Membership & { active: boolean })[],
    linkRequests: [] as LinkRequest[],
    channels: [] as { clubId: string; guildId: string; purpose: ChannelPurpose; channelId: string }[],
    seasons: [] as Season[],
    audit: [] as AuditEntry[],
    // playedOn (opcional) solo sirve para probar la reasignación por fechas de temporada.
    sessionRows: [] as (SessionStatRow & { clubId: string; playedOn?: string })[],
    externalPlayers: [] as { clubId: string; gamertag: string; playerId: string | null }[],
    syncRuns: [] as (SyncRunSummary & { clubId: string; provider: ProviderId })[],
  };

  const activeIn = (clubId: string) => state.memberships.filter((m) => m.clubId === clubId && m.active);
  const strip = ({ active: _active, ...m }: Membership & { active: boolean }): Membership => m;

  const repos: Repositories = {
    clubs: {
      async listByGuild(guildId) {
        const ids = state.clubGuilds.filter((cg) => cg.guildId === guildId).map((cg) => cg.clubId);
        return state.clubs.filter((c) => ids.includes(c.id));
      },
      async register(input) {
        if (state.clubs.some((c) => c.slug === input.slug)) {
          throw conflict('Ese identificador de club ya está en uso.');
        }
        const inGuild = state.clubGuilds.some((cg) => cg.guildId === input.guildId);
        if (inGuild && !state.multiClubGuilds.has(input.guildId)) {
          throw conflict(`El servidor ${input.guildId} no tiene habilitada la modalidad multiclub`);
        }
        const club: Club = {
          id: id(),
          slug: input.slug,
          name: input.name,
          status: 'activo',
          statsProvider: 'manual',
        };
        state.clubs.push(club);
        state.clubGuilds.push({ clubId: club.id, guildId: input.guildId });
        const m = {
          id: id(),
          clubId: club.id,
          playerId: id(),
          role: 'admin' as const,
          positions: [],
          shirtNumber: null,
          displayName: input.adminDisplayName,
          discordUserId: input.adminDiscordId,
          active: true,
        };
        state.memberships.push(m);
        state.audit.push({ clubId: club.id, actorDiscordId: input.adminDiscordId, action: 'club.register' });
        return { clubId: club.id, membershipId: m.id };
      },
    },

    memberships: {
      async findActiveByDiscordUser(clubId, discordUserId) {
        const m = activeIn(clubId).find((x) => x.discordUserId === discordUserId);
        return m ? strip(m) : null;
      },
      async findActiveById(clubId, membershipId) {
        const m = activeIn(clubId).find((x) => x.id === membershipId);
        return m ? strip(m) : null;
      },
      async listActive(clubId) {
        return activeIn(clubId).map(strip);
      },
      async countActiveAdmins(clubId) {
        return activeIn(clubId).filter((m) => m.role === 'admin').length;
      },
      async updateRole(clubId, membershipId, role) {
        const m = activeIn(clubId).find((x) => x.id === membershipId);
        if (m) m.role = role;
      },
      async updatePositions(clubId, membershipId, positions) {
        const m = activeIn(clubId).find((x) => x.id === membershipId);
        if (m) m.positions = positions;
      },
      async end(clubId, membershipId) {
        const m = activeIn(clubId).find((x) => x.id === membershipId);
        if (m) m.active = false;
      },
    },

    linkRequests: {
      async create(clubId, input) {
        const dup = state.linkRequests.some(
          (r) => r.clubId === clubId && r.discordUserId === input.discordUserId && r.status === 'pendiente',
        );
        if (dup) throw conflict('Ya tienes una solicitud pendiente en este club.');
        const r: LinkRequest = { id: id(), clubId, ...input, status: 'pendiente' };
        state.linkRequests.push(r);
        return { ...r };
      },
      async findById(clubId, requestId) {
        const r = state.linkRequests.find((x) => x.clubId === clubId && x.id === requestId);
        return r ? { ...r } : null;
      },
      async listPending(clubId) {
        return state.linkRequests.filter((r) => r.clubId === clubId && r.status === 'pendiente');
      },
      async approve(clubId, requestId, decidedBy, role) {
        const r = state.linkRequests.find((x) => x.clubId === clubId && x.id === requestId);
        if (!r) throw notFound('Registro');
        if (r.status !== 'pendiente') throw conflict('La solicitud ya fue resuelta');
        if (activeIn(clubId).some((m) => m.discordUserId === r.discordUserId)) {
          throw conflict('Esa persona ya forma parte de la plantilla.');
        }
        const m = {
          id: id(),
          clubId,
          playerId: id(),
          role,
          positions: [],
          shirtNumber: null,
          displayName: r.displayName,
          discordUserId: r.discordUserId,
          active: true,
        };
        state.memberships.push(m);
        r.status = 'aprobada';
        state.audit.push({ clubId, actorDiscordId: decidedBy, action: 'link.approve' });
        return { membershipId: m.id };
      },
      async reject(clubId, requestId) {
        const r = state.linkRequests.find((x) => x.clubId === clubId && x.id === requestId);
        if (r && r.status === 'pendiente') r.status = 'rechazada';
      },
    },

    channels: {
      async set(clubId, guildId, purpose, channelId) {
        const linked = state.clubGuilds.some((cg) => cg.clubId === clubId && cg.guildId === guildId);
        if (!linked) throw conflict('Canal de un servidor no vinculado');
        state.channels = state.channels.filter((c) => !(c.clubId === clubId && c.purpose === purpose));
        state.channels.push({ clubId, guildId, purpose, channelId });
      },
      async list(clubId) {
        return state.channels
          .filter((c) => c.clubId === clubId)
          .map((c) => ({ purpose: c.purpose, channelId: c.channelId }));
      },
    },

    seasons: {
      async create(clubId, name, makeCurrent) {
        if (state.seasons.some((s) => s.clubId === clubId && s.name === name)) {
          throw conflict('Ya existe una temporada con ese nombre.');
        }
        if (makeCurrent) {
          for (const s of state.seasons) if (s.clubId === clubId) s.isCurrent = false;
        }
        const s: Season = { id: id(), clubId, name, isCurrent: makeCurrent, startsOn: null, endsOn: null };
        state.seasons.push(s);
        return { ...s };
      },
      async list(clubId) {
        return state.seasons.filter((s) => s.clubId === clubId);
      },
      async setDates(clubId, seasonId, startsOn, endsOn) {
        const s = state.seasons.find((x) => x.clubId === clubId && x.id === seasonId);
        if (!s) throw notFound('Registro');
        const overlaps = state.seasons.some(
          (x) =>
            x.clubId === clubId &&
            x.id !== seasonId &&
            x.startsOn !== null &&
            x.startsOn <= (endsOn ?? '9999-12-31') &&
            (x.endsOn ?? '9999-12-31') >= startsOn,
        );
        if (overlaps) throw conflict('Esas fechas se cruzan con otra temporada del club.');
        s.startsOn = startsOn;
        s.endsOn = endsOn;
        // Reasignación por fecha: las filas de prueba con playedOn dentro del rango pasan a la temporada.
        let moved = 0;
        for (const r of state.sessionRows) {
          if (r.clubId !== clubId || !r.playedOn) continue;
          const inside = r.playedOn >= startsOn && (endsOn === null || r.playedOn <= endsOn);
          const target = inside ? seasonId : r.seasonId === seasonId ? null : r.seasonId;
          if (target !== r.seasonId) {
            r.seasonId = target;
            moved++;
          }
        }
        return moved;
      },
    },

    audit: {
      async log(entry) {
        state.audit.push(entry);
      },
    },

    stats: {
      async sessionRows(clubId, seasonId) {
        return state.sessionRows
          .filter((r) => r.clubId === clubId && (seasonId === null || r.seasonId === seasonId))
          .map(({ clubId: _c, playedOn: _p, ...r }) => r);
      },
    },

    externalPlayers: {
      async linkGamertag(clubId, playerId, gamertag) {
        const gt = gamertag.trim().toLowerCase();
        const mine = state.externalPlayers.filter((e) => e.clubId === clubId && e.gamertag.toLowerCase() === gt);
        if (mine.some((e) => e.playerId !== null && e.playerId !== playerId)) {
          throw conflict('Ese gamertag ya está vinculado a otro jugador del club');
        }
        for (const e of mine) e.playerId = playerId;
        for (const r of state.sessionRows) {
          if (r.clubId === clubId && r.name.toLowerCase() === gt) r.playerId = playerId;
        }
        return mine.length;
      },
    },

    sync: {
      async clubProvider(clubId) {
        return state.clubs.find((c) => c.id === clubId)?.statsProvider ?? null;
      },
      async lastRun(clubId, provider) {
        const runs = state.syncRuns.filter((r) => r.clubId === clubId && r.provider === provider);
        const last = runs.at(-1);
        return last ? (({ clubId: _c, provider: _p, ...summary }) => summary)(last) : null;
      },
      async lastCursor(clubId, provider) {
        const ok = state.syncRuns.filter((r) => r.clubId === clubId && r.provider === provider && r.status === 'ok');
        return ok.at(-1)?.cursorAfter ?? null;
      },
      async startRun(clubId, provider) {
        if (state.syncRuns.some((r) => r.clubId === clubId && r.provider === provider && r.status === 'en_curso')) {
          throw conflict('Ya hay una sincronización en curso.');
        }
        const run = {
          id: id(),
          clubId,
          provider,
          status: 'en_curso' as const,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          cursorAfter: null,
          rowsInserted: 0,
          rowsUpdated: 0,
          errorMessage: null,
        };
        state.syncRuns.push(run);
        return run.id;
      },
      async finishRun(clubId, runId, input) {
        const r = state.syncRuns.find((x) => x.clubId === clubId && x.id === runId);
        if (r) Object.assign(r, input, { finishedAt: new Date().toISOString() });
      },
      async applyPlayers(_clubId, _provider, players) {
        return players.length;
      },
      async applySession() {
        return 'insertada';
      },
      async applyDeletion() {
        return true;
      },
    },
  };

  /** Atajo de prueba: añade un miembro activo directamente. */
  function addMember(clubId: string, discordUserId: string, role: Membership['role']): Membership {
    const m = {
      id: id(),
      clubId,
      playerId: id(),
      role,
      positions: [],
      shirtNumber: null,
      displayName: `Usuario ${discordUserId.slice(-3)}`,
      discordUserId,
      active: true,
    };
    state.memberships.push(m);
    return strip(m);
  }

  return { repos, state, addMember };
}
