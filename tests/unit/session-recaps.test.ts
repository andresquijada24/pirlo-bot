import { describe, expect, it } from 'vitest';
import type { SessionRecap, SessionRecapPlayer } from '../../src/db/repositories/types.js';
import { DiscordPostError, type ChannelPoster, type PosterFile } from '../../src/discord/poster.js';
import { REFERENCE_GUILD_ID } from '../../src/jobs/reminders.js';
import { runSessionRecaps, sessionMessage } from '../../src/jobs/session-recaps.js';
import {
  formatDay,
  orderPlayers,
  renderSessionCardSvg,
  sessionMvp,
} from '../../src/render/session-card.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';

// Datos ficticios, solo para pruebas.
const ADMIN = '800000000000000001';
const GUILD = '900000000000000001';
const CHANNEL = '930000000000000007';

const player = (over: Partial<SessionRecapPlayer> & { name: string }): SessionRecapPlayer => ({
  playerId: null,
  matchesPlayed: 4,
  rating: null,
  goals: null,
  assists: null,
  shots: null,
  dribbles: null,
  passesMade: null,
  passesAttempted: null,
  tacklesMade: null,
  tacklesAttempted: null,
  interceptions: null,
  blocks: null,
  clearances: null,
  saves: null,
  seasonRating: null,
  ...over,
});
const recap = (over: Partial<SessionRecap> = {}): SessionRecap => ({
  sessionId: 'aa000000-0000-4000-8000-000000000001',
  playedOn: '2026-10-25',
  publishedAt: '2026-10-26T01:28:48Z',
  matchesPlayed: 4,
  wins: 3,
  draws: 0,
  losses: 1,
  players: [
    player({
      name: 'Ana',
      rating: 8.1,
      goals: 3,
      assists: 1,
      passesMade: 50,
      passesAttempted: 60,
      seasonRating: 7.6,
    }),
    player({ name: 'Beto', rating: 8.9, matchesPlayed: 1, goals: 0 }),
    player({
      name: 'Caro',
      rating: 7.2,
      goals: 3,
      tacklesMade: 6,
      interceptions: 9,
      seasonRating: 7.5,
    }),
    player({ name: 'Dani <x>' }),
  ],
  ...over,
});

describe('tarjeta del resumen de sesión', () => {
  it('MVP: mejor calificación entre quienes jugaron al menos media sesión', () => {
    const players = orderPlayers(recap().players);
    expect(players[sessionMvp(players)]!.name).toBe('Ana'); // Beto tiene 8.9 pero jugó 1 de 4.
  });

  it('balance, destacados, empates, comparación con la media y sin inventar datos', () => {
    const svg = renderSessionCardSvg({
      recap: recap(),
      clubName: 'Club <Prueba>',
      source: 'maritimo.app',
    });
    expect(svg).toMatch('<title>Club &lt;Prueba&gt; · sesión 2026-10-25</title>');
    expect(svg).not.toMatch('<x>'); // los nombres van como trazos, nunca como HTML
    expect(svg).toMatch('<svg');
    expect(formatDay('2026-10-25')).toBe('DOM 25 OCT 2026');
    // 3 victorias de 4: anillo al 75 %.
    const circ = 2 * Math.PI * 74;
    expect(svg).toMatch(`stroke-dasharray="${(circ * 0.75).toFixed(1)} ${circ.toFixed(1)}"`);
  });

  it('el mensaje resume la sesión y enlaza la web solo si está publicada', () => {
    const club = { name: 'Club Prueba', slug: 'club-prueba' };
    expect(sessionMessage(recap(), club, true)).toBe(
      '**Resumen de sesión · Club Prueba** · dom 25 oct 2026 · 3V 0E 1D\nEstadísticas completas: https://pirlo-bot.vercel.app/club/club-prueba',
    );
    expect(sessionMessage(recap({ wins: null }), club, false)).toBe(
      '**Resumen de sesión · Club Prueba** · dom 25 oct 2026',
    );
  });
});

describe('publicación del resumen de sesión', () => {
  async function setup(guildId = GUILD) {
    const env = createMemoryRepos();
    const { clubId } = await env.repos.clubs.register({
      guildId,
      guildName: null,
      slug: 'club-sesion',
      name: 'Club Sesión',
      adminDiscordId: ADMIN,
      adminDisplayName: 'Admin',
    });
    env.state.sessionRecaps.push({ clubId, posted: false, recap: recap() });
    return { env, clubId };
  }
  const recorder = (fail?: Error) => {
    const sent: { channelId: string; body: Record<string, unknown>; files?: PosterFile[] }[] = [];
    const poster: ChannelPoster = {
      async post(channelId, body, files) {
        if (fail) throw fail;
        sent.push({ channelId, body, ...(files ? { files } : {}) });
        return { id: '1' };
      },
      async edit() {},
    };
    return { sent, poster };
  };
  const render = async () => new Uint8Array([137, 80, 78, 71]);

  it('sin canal de resultados no publica ni gasta la sesión; luego publica una sola vez con la imagen', async () => {
    const { env, clubId } = await setup();
    const { sent, poster } = recorder();
    expect(
      await runSessionRecaps({ repos: env.repos, poster, blockedGuilds: new Set(), render }),
    ).toEqual({ posted: 0, failed: 0 });
    env.state.channels.push({ clubId, guildId: GUILD, purpose: 'resultados', channelId: CHANNEL });
    await runSessionRecaps({ repos: env.repos, poster, blockedGuilds: new Set(), render });
    await runSessionRecaps({ repos: env.repos, poster, blockedGuilds: new Set(), render });
    expect(sent.length).toBe(1);
    expect(sent[0]!.channelId).toBe(CHANNEL);
    expect(sent[0]!.files![0]!.name).toBe('sesion-2026-10-25.png');
    expect(sent[0]!.body.allowed_mentions).toEqual({ parse: [] });
    expect(String(sent[0]!.body.content)).toMatch('/club/club-sesion');
  });

  it('nunca publica en el servidor de referencia ni en los bloqueados', async () => {
    for (const guild of [REFERENCE_GUILD_ID, '900000000000000099']) {
      const { env, clubId } = await setup(guild);
      env.state.channels.push({
        clubId,
        guildId: guild,
        purpose: 'resultados',
        channelId: CHANNEL,
      });
      const { sent, poster } = recorder();
      await runSessionRecaps({
        repos: env.repos,
        poster,
        blockedGuilds: new Set(['900000000000000099']),
        render,
      });
      expect(sent.length).toBe(0);
    }
  });

  it('un fallo temporal se reintenta; uno definitivo no', async () => {
    const { env, clubId } = await setup();
    env.state.channels.push({ clubId, guildId: GUILD, purpose: 'resultados', channelId: CHANNEL });
    const down = await runSessionRecaps({
      repos: env.repos,
      poster: recorder(new DiscordPostError(503)).poster,
      blockedGuilds: new Set(),
      render,
    });
    expect(down.failed).toBe(1);
    const ok = recorder();
    expect(
      (
        await runSessionRecaps({
          repos: env.repos,
          poster: ok.poster,
          blockedGuilds: new Set(),
          render,
        })
      ).posted,
    ).toBe(1);

    const second = await setup();
    second.env.state.channels.push({
      clubId: second.clubId,
      guildId: GUILD,
      purpose: 'resultados',
      channelId: CHANNEL,
    });
    await runSessionRecaps({
      repos: second.env.repos,
      poster: recorder(new DiscordPostError(403)).poster,
      blockedGuilds: new Set(),
      render,
    });
    const after = recorder();
    await runSessionRecaps({
      repos: second.env.repos,
      poster: after.poster,
      blockedGuilds: new Set(),
      render,
    });
    expect(after.sent.length).toBe(0);
  });
});
