import { describe, expect, it } from 'vitest';
import { recapEmbed, recapHeader } from '../../src/discord/ea-recap.js';
import { DiscordPostError, type ChannelPoster } from '../../src/discord/poster.js';
import { runEaProcessing } from '../../src/jobs/ea-processing.js';
import { runEaRecaps } from '../../src/jobs/ea-recaps.js';
import { REFERENCE_GUILD_ID } from '../../src/jobs/reminders.js';
import type { EaRecap, EaRecapPlayer } from '../../src/db/repositories/types.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';

// Datos ficticios, solo para pruebas.
const ADMIN = '800000000000000001';
const GUILD = '900000000000000001';
const CHANNEL = '930000000000000007';

const player = (over: Partial<EaRecapPlayer> & { name: string }): EaRecapPlayer => ({
  position: null,
  goals: null,
  assists: null,
  rating: null,
  shots: null,
  passesMade: null,
  passesAttempted: null,
  tacklesMade: null,
  tacklesAttempted: null,
  saves: null,
  manOfTheMatch: null,
  ...over,
});
const recap = (over: Partial<EaRecap> = {}): EaRecap => ({
  matchId: '1',
  matchType: 'leagueMatch',
  playedAt: '2026-10-25T02:07:40.000Z',
  goalsFor: 3,
  goalsAgainst: 1,
  result: 'victoria',
  opponentName: 'Rival Ficticio',
  players: [
    player({ name: 'Ana', goals: 2, assists: 0, rating: 8.4, manOfTheMatch: true }),
    player({ name: 'Beto', goals: 1, assists: 2, rating: 7.1, manOfTheMatch: false }),
    player({ name: 'Caro' }),
  ],
  ...over,
});
const text = (e: ReturnType<typeof recapEmbed>) =>
  [e.title, e.description, ...(e.fields ?? []).map((f) => `${f.name}: ${f.value}`)].join('\n');

describe('mensaje de resumen', () => {
  it('marcador, goleadores, asistencias, MVP y notas; sin dato = —', () => {
    const t = text(recapEmbed(recap(), 'Club Prueba'));
    expect(t).toMatch('🟢 Club Prueba 3-1 Rival Ficticio');
    expect(t).toMatch('⚽ Goles: Ana ×2 · Beto');
    expect(t).toMatch('🅰️ Asistencias: Beto ×2');
    expect(t).toMatch('⭐ MVP: Ana (8.4)');
    expect(t).toMatch('— · Caro');
  });

  it('sin MVP de EA usa la mejor nota; sin goles muestra —', () => {
    const t = text(
      recapEmbed(
        recap({
          result: 'derrota',
          goalsFor: 0,
          players: [player({ name: 'Beto', goals: 0, rating: 6.5, manOfTheMatch: false })],
        }),
        'Club Prueba',
      ),
    );
    expect(t).toMatch('🔴');
    expect(t).toMatch('⚽ Goles: —');
    expect(t).toMatch('Beto (6.5, mejor nota)');
  });

  it('el encabezado resume el balance', () => {
    expect(recapHeader([recap(), recap({ result: 'empate' })], 'Club Prueba')).toMatch('2 partidos nuevos de EA · 1V 1E 0D');
  });
});

describe('publicación de resúmenes', () => {
  async function setup(guildId = GUILD) {
    const env = createMemoryRepos();
    const { clubId } = await env.repos.clubs.register({
      guildId,
      guildName: null,
      slug: 'club-ea',
      name: 'Club EA',
      adminDiscordId: ADMIN,
      adminDisplayName: 'Admin',
    });
    await env.repos.ea.link(clubId, 'common-gen5', '111', ADMIN);
    await env.repos.eaCapture.store([
      {
        platform: 'common-gen5',
        eaClubId: '111',
        matchId: '900001',
        matchType: 'leagueMatch',
        playedAt: '2026-10-25T02:07:40.000Z',
        payload: {
          clubs: { '111': { goals: '2' }, '222': { goals: '0', details: { name: 'Rival Ficticio' } } },
          players: {
            '111': { '1': { playername: 'JugadorFicticio', goals: '2', rating: '8.0', mom: '1' } },
            '222': { '2': { playername: 'GamertagRival', goals: '0', rating: '6.0' } },
          },
        },
      },
    ]);
    await runEaProcessing({ repos: env.repos });
    return { env, clubId };
  }
  const recorder = (fail?: Error) => {
    const sent: { channelId: string; body: Record<string, unknown> }[] = [];
    const poster: ChannelPoster = {
      async post(channelId, body) {
        if (fail) throw fail;
        sent.push({ channelId, body });
        return { id: '1' };
      },
      async edit() {},
    };
    return { sent, poster };
  };

  it('sin canal de resultados no publica ni gasta el partido', async () => {
    const { env, clubId } = await setup();
    const { sent, poster } = recorder();
    expect(await runEaRecaps({ repos: env.repos, poster, blockedGuilds: new Set() })).toEqual({ posted: 0, failed: 0 });
    env.state.channels.push({ clubId, guildId: GUILD, purpose: 'resultados', channelId: CHANNEL });
    expect((await runEaRecaps({ repos: env.repos, poster, blockedGuilds: new Set() })).posted).toBe(1);
    expect(sent[0]!.channelId).toBe(CHANNEL);
  });

  it('publica una sola vez, sin menciones ni gamertags rivales', async () => {
    const { env, clubId } = await setup();
    env.state.channels.push({ clubId, guildId: GUILD, purpose: 'resultados', channelId: CHANNEL });
    const { sent, poster } = recorder();
    await runEaRecaps({ repos: env.repos, poster, blockedGuilds: new Set() });
    await runEaRecaps({ repos: env.repos, poster, blockedGuilds: new Set() });
    expect(sent.length).toBe(1);
    const body = JSON.stringify(sent[0]!.body);
    expect(body).toMatch('JugadorFicticio');
    expect(body).toMatch('Rival Ficticio');
    expect(body).not.toMatch('GamertagRival');
    expect(sent[0]!.body.allowed_mentions).toEqual({ parse: [] });
  });

  it('nunca publica en el servidor de referencia ni en los bloqueados', async () => {
    for (const guild of [REFERENCE_GUILD_ID, '900000000000000099']) {
      const { env, clubId } = await setup(guild);
      env.state.channels.push({ clubId, guildId: guild, purpose: 'resultados', channelId: CHANNEL });
      const { sent, poster } = recorder();
      await runEaRecaps({ repos: env.repos, poster, blockedGuilds: new Set(['900000000000000099']) });
      expect(sent.length).toBe(0);
    }
  });

  it('un fallo temporal se reintenta; uno definitivo no', async () => {
    const { env, clubId } = await setup();
    env.state.channels.push({ clubId, guildId: GUILD, purpose: 'resultados', channelId: CHANNEL });
    const down = await runEaRecaps({ repos: env.repos, poster: recorder(new DiscordPostError(503)).poster, blockedGuilds: new Set() });
    expect(down.failed).toBe(1);
    const ok = recorder();
    expect((await runEaRecaps({ repos: env.repos, poster: ok.poster, blockedGuilds: new Set() })).posted).toBe(1);

    const second = await setup();
    second.env.state.channels.push({ clubId: second.clubId, guildId: GUILD, purpose: 'resultados', channelId: CHANNEL });
    await runEaRecaps({ repos: second.env.repos, poster: recorder(new DiscordPostError(403)).poster, blockedGuilds: new Set() });
    const after = recorder();
    await runEaRecaps({ repos: second.env.repos, poster: after.poster, blockedGuilds: new Set() });
    expect(after.sent.length).toBe(0);
  });
});

describe('imágenes en el resumen', () => {
  it('con renderizador publica una imagen por partido; si falla, vuelve al texto', async () => {
    for (const fails of [false, true]) {
      const env = createMemoryRepos();
      const { clubId } = await env.repos.clubs.register({
        guildId: GUILD,
        guildName: null,
        slug: 'club-ea',
        name: 'Club EA',
        adminDiscordId: ADMIN,
        adminDisplayName: 'Admin',
      });
      await env.repos.ea.link(clubId, 'common-gen5', '111', ADMIN);
      env.state.eaMatches.push({
        clubId,
        matchId: '900001',
        platform: 'common-gen5',
        eaClubId: '111',
        matchType: 'leagueMatch',
        playedAt: '2026-10-25T02:07:40.000Z',
        goalsFor: 1,
        goalsAgainst: 0,
        result: 'victoria',
        opponentEaClubId: '222',
        opponentName: 'Rival Ficticio',
        players: [],
      });
      env.state.channels.push({ clubId, guildId: GUILD, purpose: 'resultados', channelId: CHANNEL });
      const calls: { body: Record<string, unknown>; files?: unknown[] }[] = [];
      const poster: ChannelPoster = {
        async post(_c, body, files) {
          calls.push({ body, ...(files ? { files } : {}) });
          return { id: '1' };
        },
        async edit() {},
      };
      const render = async () => {
        if (fails) throw new Error('sin sharp');
        return new Uint8Array([0x89, 0x50]);
      };
      const r = await runEaRecaps({ repos: env.repos, poster, blockedGuilds: new Set(), render });
      expect(r.posted).toBe(1);
      if (fails) {
        expect(calls[0]!.files).toBeUndefined();
        expect(Array.isArray(calls[0]!.body.embeds)).toBe(true);
      } else {
        expect(calls[0]!.files!.length).toBe(1);
        expect(calls[0]!.body.embeds).toBeUndefined();
      }
    }
  });
});
