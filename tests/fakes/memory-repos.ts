import { conflict, notFound } from '../../src/core/errors.js';
import type {
  ChannelPurpose,
  Club,
  LinkRequest,
  Membership,
  Season,
} from '../../src/core/types.js';
import type { AuditEntry, EaLink, Repositories } from '../../src/db/repositories/types.js';
import type { CachedMatch } from '../../src/providers/ea/ingest.js';
import type { ProcessedEaMatch } from '../../src/providers/ea/matches.js';
import type { SessionStatRow } from '../../src/core/stats/service.js';
import type { ProviderId } from '../../src/providers/types.js';
import type { SyncRunSummary } from '../../src/sync/types.js';
import type { Callup, CallupResponse, Lineup } from '../../src/core/types.js';

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
    callups: [] as Callup[],
    callupResponses: [] as (CallupResponse & { clubId: string; callupId: string })[],
    lineups: [] as Lineup[],
    remindedCallups: new Set<string>(),
    callupMessages: [] as { clubId: string; callupId: string; channelId: string; messageId: string }[],
    eaCache: new Map<string, CachedMatch>(),
    eaLinks: [] as EaLink[],
    eaMatches: [] as (ProcessedEaMatch & { clubId: string; recapPosted?: boolean })[],
    /** Gamertag de cada ficha por club ("clubId:playerId"), como club_memberships.gamertag. */
    memberGamertags: new Map<string, string>(),
    crests: new Map<string, string>(),
    webPublic: new Set<string>(),
  };

  const activeIn = (clubId: string) => state.memberships.filter((m) => m.clubId === clubId && m.active);
  const strip = ({ active: _active, ...m }: Membership & { active: boolean }): Membership => m;

  const repos: Repositories = {
    clubs: {
      async listByGuild(guildId) {
        const ids = state.clubGuilds.filter((cg) => cg.guildId === guildId).map((cg) => cg.clubId);
        return state.clubs.filter((c) => ids.includes(c.id));
      },
      async setReminderMinutes(clubId, minutes) {
        const c = state.clubs.find((x) => x.id === clubId);
        if (c) c.reminderMinutes = minutes;
      },
      async findById(clubId) {
        const c = state.clubs.find((x) => x.id === clubId);
        return c ? { ...c } : null;
      },
      async listPublic() {
        return state.clubs
          .filter((c) => state.webPublic.has(c.id) && c.status === 'activo')
          .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
          .map((c) => ({ slug: c.slug, name: c.name, hasCrest: state.crests.has(c.id) }));
      },
      async findPublic(slug) {
        const c = state.clubs.find((x) => x.slug === slug && state.webPublic.has(x.id) && x.status === 'activo');
        return c ? { ...c } : null;
      },
      async setStatus(clubId, status) {
        const c = state.clubs.find((x) => x.id === clubId);
        if (!c) throw conflict('Club no encontrado.');
        c.status = status;
      },
      async setWebPublic(clubId, isPublic, actorDiscordId) {
        const isAdmin = activeIn(clubId).some((m) => m.discordUserId === actorDiscordId && m.role === 'admin');
        if (!isAdmin) throw conflict('Solo un admin del club puede activar o desactivar la página web.');
        if (isPublic) state.webPublic.add(clubId);
        else state.webPublic.delete(clubId);
      },
      async webPublic(clubId) {
        return state.webPublic.has(clubId);
      },
      async crest(clubId) {
        return state.crests.get(clubId) ?? null;
      },
      async setCrest(clubId, pngBase64, actorDiscordId) {
        const isAdmin = activeIn(clubId).some((m) => m.discordUserId === actorDiscordId && m.role === 'admin');
        if (!isAdmin) throw conflict('Solo un admin del club puede cambiar el escudo.');
        if (pngBase64 === null) state.crests.delete(clubId);
        else state.crests.set(clubId, pngBase64);
      },
      async disconnectGuild(clubId, guildId, actorDiscordId) {
        const isAdmin = activeIn(clubId).some((m) => m.discordUserId === actorDiscordId && m.role === 'admin');
        if (!isAdmin) throw conflict('Solo un admin del club puede desconectarlo de un servidor.');
        const links = state.clubGuilds.filter((cg) => cg.clubId === clubId);
        if (!links.some((cg) => cg.guildId === guildId)) throw conflict('El club no está conectado a ese servidor.');
        if (links.length <= 1) throw conflict('Es el único servidor del club: no se puede desconectar.');
        state.clubGuilds = state.clubGuilds.filter((cg) => !(cg.clubId === clubId && cg.guildId === guildId));
        state.channels = state.channels.filter((ch) => !(ch.clubId === clubId && ch.guildId === guildId));
      },
      async setTimezone(clubId, timezone) {
        const c = state.clubs.find((x) => x.id === clubId);
        if (c) c.timezone = timezone;
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
          timezone: 'America/Caracas',
          reminderMinutes: null,
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
      async connectGuild(input) {
        const club = state.clubs.find((c) => c.slug === input.slug.trim().toLowerCase());
        if (!club) throw conflict('No existe un club con ese identificador.');
        const isAdmin = state.memberships.some(
          (m) => m.clubId === club.id && m.active && m.role === 'admin' && m.discordUserId === input.actorDiscordId,
        );
        if (!isAdmin) throw conflict('Solo un admin del club puede conectarlo a otro servidor.');
        const other = state.clubGuilds.some((cg) => cg.guildId === input.guildId && cg.clubId !== club.id);
        if (other && !state.multiClubGuilds.has(input.guildId)) {
          throw conflict(`El servidor ${input.guildId} no tiene habilitada la modalidad multiclub`);
        }
        if (!state.clubGuilds.some((cg) => cg.clubId === club.id && cg.guildId === input.guildId)) {
          state.clubGuilds.push({ clubId: club.id, guildId: input.guildId });
        }
        state.audit.push({ clubId: club.id, actorDiscordId: input.actorDiscordId, action: 'club.connect_guild' });
        return club.id;
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
          .map((c) => ({ purpose: c.purpose, channelId: c.channelId, guildId: c.guildId }));
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
        const sessions = state.sessionRows
          .filter((r) => r.clubId === clubId && (seasonId === null || r.seasonId === seasonId))
          .map(({ clubId: _c, playedOn: _p, ...r }) => r);
        // Como v_ea_player_season_stats: solo el lado propio, vinculado por el gamertag de la ficha.
        // Simplificación: aquí los partidos de EA cuentan en cualquier temporada que se pida.
        void seasonId;
        const byPlayer = new Map<string, SessionStatRow>();
        const sum = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);
        for (const m of state.eaMatches.filter((x) => x.clubId === clubId)) {
          for (const p of m.players.filter((x) => x.side === 'propio')) {
            const owners = [...state.memberGamertags.entries()].filter(
              ([k, gt]) => k.startsWith(`${clubId}:`) && gt.toLowerCase() === p.gamertag.toLowerCase(),
            );
            const playerId = owners.length === 1 ? owners[0]![0].split(':')[1]! : null;
            const key = `${playerId}:${p.eaPlayerId}`;
            const r = byPlayer.get(key) ?? {
              seasonId: null, playerId, source: 'ea', sourcePlayerId: p.eaPlayerId, name: p.gamertag,
              sessions: 1, matchesPlayed: 0, goals: null, assists: null, shots: null, dribbles: null,
              passesMade: null, passesAttempted: null, tacklesMade: null, tacklesAttempted: null,
              interceptions: null, blocks: null, clearances: null, saves: null, ratingPoints: null,
              ratedMatches: null,
            };
            r.matchesPlayed = (r.matchesPlayed ?? 0) + 1;
            r.goals = sum(r.goals, p.goals);
            r.assists = sum(r.assists, p.assists);
            r.shots = sum(r.shots, p.shots);
            r.passesMade = sum(r.passesMade, p.passesMade);
            r.passesAttempted = sum(r.passesAttempted, p.passesAttempted);
            r.tacklesMade = sum(r.tacklesMade, p.tacklesMade);
            r.tacklesAttempted = sum(r.tacklesAttempted, p.tacklesAttempted);
            r.saves = sum(r.saves, p.saves);
            r.ratingPoints = sum(r.ratingPoints, p.rating);
            r.ratedMatches = sum(r.ratedMatches, p.rating === null ? null : 1);
            byPlayer.set(key, r);
          }
        }
        return [...sessions, ...byPlayer.values()];
      },
    },

    externalPlayers: {
      async linkGamertag(clubId, playerId, gamertag) {
        state.memberGamertags.set(`${clubId}:${playerId}`, gamertag.trim());
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

    callups: {
      async create(clubId, input) {
        const c: Callup = {
          id: id(),
          clubId,
          title: input.title,
          opponent: input.opponent,
          startsAt: input.startsAt.toISOString(),
          closesAt: input.closesAt ? input.closesAt.toISOString() : null,
          status: 'abierta',
        };
        state.callups.push(c);
        return c.id;
      },
      async findById(clubId, callupId) {
        const c = state.callups.find((x) => x.clubId === clubId && x.id === callupId);
        return c ? { ...c } : null;
      },
      async listUpcoming(clubId, limit) {
        return state.callups
          .filter((c) => c.clubId === clubId && c.status === 'abierta')
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          .slice(0, limit);
      },
      async next(clubId) {
        const c = state.callups
          .filter((x) => x.clubId === clubId && x.status !== 'cancelada')
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
        return c ? { ...c } : null;
      },
      async responses(clubId, callupId) {
        return state.callupResponses
          .filter((r) => r.clubId === clubId && r.callupId === callupId)
          .map((r) => ({ playerId: r.playerId, answer: r.answer }));
      },
      async respond(clubId, callupId, playerId, answer) {
        const c = state.callups.find((x) => x.clubId === clubId && x.id === callupId);
        if (!c) throw notFound('Convocatoria');
        if (c.status !== 'abierta') throw conflict('Esta convocatoria está cerrada.');
        if (Date.now() >= Date.parse(c.closesAt ?? c.startsAt)) throw conflict('El plazo para responder ya terminó.');
        const prev = state.callupResponses.find((r) => r.callupId === callupId && r.playerId === playerId);
        if (prev) prev.answer = answer;
        else state.callupResponses.push({ clubId, callupId, playerId, answer });
      },
      async cancel(clubId, callupId) {
        const c = state.callups.find((x) => x.clubId === clubId && x.id === callupId);
        if (!c) throw notFound('Convocatoria');
        if (c.status === 'cancelada') throw conflict('La convocatoria ya estaba cancelada.');
        c.status = 'cancelada';
      },
      async recordMessage(clubId, callupId, channelId, messageId) {
        if (!state.callups.some((c) => c.clubId === clubId && c.id === callupId)) throw notFound('Convocatoria');
        if (!state.callupMessages.some((m) => m.callupId === callupId && m.messageId === messageId)) {
          state.callupMessages.push({ clubId, callupId, channelId, messageId });
        }
      },
      async messages(clubId, callupId) {
        return state.callupMessages
          .filter((m) => m.clubId === clubId && m.callupId === callupId)
          .map(({ channelId, messageId }) => ({ channelId, messageId }));
      },
      async close(clubId, callupId) {
        const c = state.callups.find((x) => x.clubId === clubId && x.id === callupId);
        if (!c) throw notFound('Convocatoria');
        if (c.status !== 'abierta') throw conflict('La convocatoria ya estaba cerrada.');
        c.status = 'cerrada';
      },
    },

    lineups: {
      async create(clubId, input) {
        const prev = state.lineups.findIndex((l) => l.clubId === clubId && l.callupId === input.callupId);
        if (prev >= 0) {
          if (!input.replace) throw conflict('Esta convocatoria ya tiene alineación.');
          state.lineups.splice(prev, 1);
        }
        const l: Lineup = {
          id: id(),
          clubId,
          callupId: input.callupId,
          formation: input.formation,
          status: 'borrador',
          slots: input.positions.map((position, i) => ({ slot: i + 1, position, playerId: null, substitute: false })),
        };
        state.lineups.push(l);
        return l.id;
      },
      async findByCallup(clubId, callupId) {
        const l = state.lineups.find((x) => x.clubId === clubId && x.callupId === callupId);
        return l ? structuredClone(l) : null;
      },
      async assign(clubId, lineupId, playerId, target) {
        const l = state.lineups.find((x) => x.clubId === clubId && x.id === lineupId);
        if (!l) throw notFound('Alineación');
        if (!activeIn(clubId).some((m) => m.playerId === playerId)) {
          throw conflict('Ese jugador no forma parte de la plantilla.');
        }
        for (const s of l.slots) if (!s.substitute && s.playerId === playerId) s.playerId = null;
        l.slots = l.slots.filter((s) => !(s.substitute && s.playerId === playerId));
        if ('substitute' in target) {
          const used = new Set(l.slots.map((s) => s.slot));
          const free = [...Array(12).keys()].map((i) => i + 12).find((n) => !used.has(n));
          if (!free) throw conflict('El banquillo está lleno (12 suplentes).');
          l.slots.push({ slot: free, position: null, playerId, substitute: true });
          return free;
        }
        const slot = l.slots.find((s) => !s.substitute && s.position === target.position && !s.playerId);
        if (!slot) {
          throw conflict(
            l.slots.some((s) => s.position === target.position)
              ? `Todas las posiciones ${target.position} ya están ocupadas. Quita antes a alguien.`
              : `La formación no tiene la posición ${target.position}.`,
          );
        }
        slot.playerId = playerId;
        return slot.slot;
      },
      async remove(clubId, lineupId, playerId) {
        const l = state.lineups.find((x) => x.clubId === clubId && x.id === lineupId);
        if (!l) return false;
        const before = JSON.stringify(l.slots);
        for (const s of l.slots) if (!s.substitute && s.playerId === playerId) s.playerId = null;
        l.slots = l.slots.filter((s) => !(s.substitute && s.playerId === playerId));
        return JSON.stringify(l.slots) !== before;
      },
      async publish(clubId, lineupId) {
        const l = state.lineups.find((x) => x.clubId === clubId && x.id === lineupId);
        if (!l) throw notFound('Alineación');
        l.status = 'publicada';
      },
    },

    eaCapture: {
      async store(matches) {
        let added = 0;
        for (const m of matches) {
          const key = `${m.platform}:${m.eaClubId}:${m.matchId}`;
          if (!state.eaCache.has(key)) {
            state.eaCache.set(key, m);
            added++;
          }
        }
        return added;
      },
    },

    ea: {
      async link(clubId, platform, eaClubId, actorDiscordId) {
        const isAdmin = activeIn(clubId).some((m) => m.discordUserId === actorDiscordId && m.role === 'admin');
        if (!isAdmin) throw conflict('Solo un admin del club puede vincular su club de EA.');
        if (state.eaLinks.some((l) => l.platform === platform && l.eaClubId === eaClubId && l.clubId !== clubId)) {
          throw conflict('Ese club de EA ya está vinculado a otro club de PIRLO.');
        }
        state.eaLinks = state.eaLinks.filter((l) => l.clubId !== clubId);
        state.eaLinks.push({ clubId, platform, eaClubId, consentedBy: actorDiscordId, consentedAt: new Date().toISOString() });
        state.audit.push({ clubId, actorDiscordId, action: 'club.ea_link', entity: 'ea_club', entityId: eaClubId });
      },
      async unlink(clubId, actorDiscordId) {
        const isAdmin = activeIn(clubId).some((m) => m.discordUserId === actorDiscordId && m.role === 'admin');
        if (!isAdmin) throw conflict('Solo un admin del club puede retirar el consentimiento de EA.');
        const before = state.eaLinks.length;
        state.eaLinks = state.eaLinks.filter((l) => l.clubId !== clubId);
        return state.eaLinks.length < before;
      },
      async getLink(clubId) {
        return state.eaLinks.find((l) => l.clubId === clubId) ?? null;
      },
      async consented(platform, eaClubId) {
        return state.eaLinks.some((l) => l.platform === platform && l.eaClubId === eaClubId);
      },
      async listLinks() {
        return [...state.eaLinks];
      },
      async pending(clubId, limit) {
        const link = state.eaLinks.find((l) => l.clubId === clubId);
        if (!link) return [];
        return [...state.eaCache.values()]
          .filter((m) => m.platform === link.platform && m.eaClubId === link.eaClubId)
          .filter((m) => !state.eaMatches.some((x) => x.clubId === clubId && x.matchId === m.matchId))
          .sort((a, b) => a.playedAt.localeCompare(b.playedAt))
          .slice(0, limit);
      },
      async apply(clubId, match) {
        const link = state.eaLinks.find((l) => l.clubId === clubId);
        if (!link || link.platform !== match.platform || link.eaClubId !== match.eaClubId) {
          throw conflict('El partido no pertenece al club de EA vinculado a este club.');
        }
        if (state.eaMatches.some((x) => x.clubId === clubId && x.matchId === match.matchId)) return false;
        state.eaMatches.push({ ...match, clubId });
        return true;
      },
      async claimRecaps(clubId, limit) {
        const ids: string[] = [];
        for (const m of state.eaMatches
          .filter((x) => x.clubId === clubId && !x.recapPosted)
          .sort((a, b) => a.playedAt.localeCompare(b.playedAt))
          .slice(0, Math.min(limit, 10))) {
          m.recapPosted = true;
          ids.push(m.matchId);
        }
        return ids;
      },
      async releaseRecaps(clubId, matchIds) {
        for (const m of state.eaMatches) {
          if (m.clubId === clubId && matchIds.includes(m.matchId)) m.recapPosted = false;
        }
      },
      async recaps(clubId, matchIds) {
        return state.eaMatches
          .filter((m) => m.clubId === clubId && matchIds.includes(m.matchId))
          .sort((a, b) => a.playedAt.localeCompare(b.playedAt))
          .map((m) => ({
            matchId: m.matchId,
            matchType: m.matchType,
            playedAt: m.playedAt,
            goalsFor: m.goalsFor,
            goalsAgainst: m.goalsAgainst,
            result: m.result,
            opponentName: m.opponentName,
            opponentColors: m.opponentColors ?? null,
            players: m.players
              .filter((p) => p.side === 'propio')
              .map((p) => {
                const owner = [...state.memberGamertags.entries()].find(
                  ([k, gt]) => k.startsWith(`${clubId}:`) && gt.toLowerCase() === p.gamertag.toLowerCase(),
                );
                const member = owner && state.memberships.find((x) => x.clubId === clubId && x.playerId === owner[0].split(':')[1]);
                return {
                  name: member?.displayName ?? p.gamertag,
                  position: p.position,
                  goals: p.goals,
                  assists: p.assists,
                  rating: p.rating,
                  shots: p.shots,
                  passesMade: p.passesMade,
                  passesAttempted: p.passesAttempted,
                  tacklesMade: p.tacklesMade,
                  tacklesAttempted: p.tacklesAttempted,
                  saves: p.saves,
                  manOfTheMatch: p.manOfTheMatch,
                };
              })
              .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.name.localeCompare(b.name)),
          }));
      },
      async recent(clubId, limit) {
        return state.eaMatches
          .filter((m) => m.clubId === clubId)
          .sort((a, b) => b.playedAt.localeCompare(a.playedAt))
          .slice(0, limit)
          .map(({ matchId, matchType, playedAt, goalsFor, goalsAgainst, result, opponentName, opponentColors }) => ({
            matchId,
            matchType,
            playedAt,
            goalsFor,
            goalsAgainst,
            result,
            opponentName,
            opponentColors: opponentColors ?? null,
          }));
      },
    },

    reminders: {
      async release(_clubId, callupId) {
        state.remindedCallups.delete(callupId);
      },
      async due(limit, blockedGuilds) {
        const now = Date.now();
        const out = [];
        for (const c of state.callups) {
          const club = state.clubs.find((x) => x.id === c.clubId);
          if (!club || club.reminderMinutes === null || c.status !== 'abierta' || state.remindedCallups.has(c.id)) continue;
          const start = Date.parse(c.startsAt);
          if (now < start - club.reminderMinutes * 60_000 || now >= start) continue;
          const channels = state.channels.filter((ch) => ch.clubId === c.clubId);
          const ch = channels.find((x) => x.purpose === 'recordatorios') ?? channels.find((x) => x.purpose === 'convocatorias');
          if (ch && (blockedGuilds.includes(ch.guildId) || ch.guildId === '853894813169614848')) continue;
          if (ch) out.push({ clubId: c.clubId, callupId: c.id, guildId: ch.guildId, channelId: ch.channelId });
        }
        return out.slice(0, limit);
      },
      async claim(_clubId, callupId) {
        if (state.remindedCallups.has(callupId)) return false;
        state.remindedCallups.add(callupId);
        return true;
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
