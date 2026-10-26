import { describe, expect, it } from 'vitest';
import type { ChannelReader, DiscordMessage } from '../../src/discord/channel-reader.js';
import { DiscordPostError, type ChannelPoster, type PosterFile } from '../../src/discord/poster.js';
import { runOurProClub } from '../../src/jobs/ourproclub.js';
import { REFERENCE_GUILD_ID } from '../../src/jobs/reminders.js';
import {
  readPlayerName,
  readPlayerValue,
  readSessionRecap,
} from '../../src/providers/ourproclub/recap.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';

// Textos con el formato real del «Session Recap» de Our Pro Club (gamertags ficticios).
describe('lector del Session Recap de Our Pro Club', () => {
  it('«²AST» nunca pisa la asistencia real; claves de dos palabras y pares', () => {
    const v = readPlayerValue(
      '👕 GP: 7\n🥅 GLS: 12\n🎯 SHT: 25\n🤝 AST: 3\n🔗 ²AST: 6\n👟 PAS: 68/93\n🛡️ TKL: 8/26\n🧠 INT: 4\n🧤 GK SVS: 2',
    );
    expect([
      v.matchesPlayed,
      v.goals,
      v.assists,
      v.shots,
      v.passesMade,
      v.passesAttempted,
      v.tacklesMade,
      v.tacklesAttempted,
      v.interceptions,
      v.saves,
    ]).toEqual([7, 12, 3, 25, 68, 93, 8, 26, 4, 2]);
    const solo2 = readPlayerValue('👕 GP: 3\n🔗 ²AST: 2');
    expect(solo2.assists).toBe(0);
    expect(readPlayerName('Jugador Uno - 7,4')).toEqual({ gamertag: 'Jugador Uno', rating: 7.4 });
  });

  it('un mensaje completo: récord, partidos y jugadores; otro embed → null', () => {
    const r = readSessionRecap([
      {
        title: 'Session Recap for Club Ficticio',
        description: 'You played **3** matches.\nPassing Direction: 1 backwards',
        fields: [
          { name: 'Record', value: '2 wins • 0 draws • 1 losses' },
          { name: 'Uno - 8.6', value: '👕 GP: 3\n🥅 GLS: 6\n🎯 SHT: 13' },
          { name: 'Dos - 7.8', value: '👕 GP: 3\n🤝 AST: 11' },
        ],
      },
    ])!;
    expect([r.matchesPlayed, r.wins, r.draws, r.losses]).toEqual([3, 2, 0, 1]);
    expect(r.players.map((p) => [p.gamertag, p.rating, p.goals, p.assists])).toEqual([
      ['Uno', 8.6, 6, 0],
      ['Dos', 7.8, 0, 11],
    ]);
    expect(readSessionRecap([{ title: 'Otra cosa' }])).toBeNull();
  });
});

const ADMIN = '800000000000000001';
const GUILD = '900000000000000001';
const OPC_CHANNEL = '930000000000000001';
const RESULTS = '930000000000000002';
const NOW = Date.parse('2026-10-26T20:00:00Z');

const opc = (
  id: string,
  minutesAgo: number,
  over: Partial<DiscordMessage> = {},
): DiscordMessage => ({
  id,
  timestamp: new Date(NOW - minutesAgo * 60_000).toISOString(),
  author: { id: '700000000000000001', username: 'OurProClub', bot: true },
  embeds: [],
  attachments: [
    {
      url: 'https://cdn.discordapp.com/attachments/1/2/partido.png',
      filename: 'partido.png',
      contentType: 'image/png',
      size: 10,
    },
  ],
  ...over,
});
const recapMsg = (id: string, minutesAgo: number) =>
  opc(id, minutesAgo, {
    attachments: [],
    embeds: [
      {
        title: 'Session Recap for Club Ficticio',
        description: 'You played **2** matches.',
        fields: [
          { name: 'Record', value: '1 wins • 0 draws • 1 losses' },
          { name: 'Uno - 7.5', value: '👕 GP: 2\n🥅 GLS: 1' },
        ],
      },
    ],
  });

async function setup(opts: { guild?: string; provider?: 'maritimo' } = {}) {
  const env = createMemoryRepos();
  const guild = opts.guild ?? GUILD;
  const { clubId } = await env.repos.clubs.register({
    guildId: guild,
    guildName: null,
    slug: 'club-opc',
    name: 'Club OPC',
    adminDiscordId: ADMIN,
    adminDisplayName: 'Admin',
  });
  if (opts.provider) env.state.clubs[0]!.statsProvider = opts.provider;
  env.state.channels.push(
    { clubId, guildId: guild, purpose: 'ourproclub', channelId: OPC_CHANNEL },
    { clubId, guildId: guild, purpose: 'resultados', channelId: RESULTS },
  );
  return { env, clubId };
}

function fakes(channel: DiscordMessage[], fail?: Error) {
  const sent: { channelId: string; body: Record<string, unknown>; files?: PosterFile[] }[] = [];
  const reads: (string | undefined)[] = [];
  const reader: ChannelReader = {
    async messages(_c, { after }) {
      reads.push(after);
      return channel.filter((m) => !after || BigInt(m.id) > BigInt(after));
    },
    async image() {
      return new Uint8Array([137, 80, 78, 71]);
    },
  };
  const poster: ChannelPoster = {
    async post(channelId, body, files) {
      if (fail) throw fail;
      sent.push({ channelId, body, ...(files ? { files } : {}) });
      return { id: '1' };
    },
    async edit() {},
  };
  return { sent, reads, reader, poster };
}

describe('espejo de Our Pro Club', () => {
  it('cada partido nuevo se avisa al momento con su imagen, una sola vez; ignora otros autores y el historial', async () => {
    const { env } = await setup();
    const channel = [
      opc('1000000000000000001', 120), // historial: no se repite
      opc('1000000000000000002', 2),
      opc('1000000000000000003', 1, { author: { id: '1', username: 'Alguien', bot: false } }),
    ];
    const f = fakes(channel);
    const deps = {
      repos: env.repos,
      reader: f.reader,
      poster: f.poster,
      blockedGuilds: new Set<string>(),
      now: () => NOW,
    };
    expect(await runOurProClub(deps)).toMatchObject({ clubs: 1, matches: 1 });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.channelId).toBe(RESULTS);
    expect(String(f.sent[0]!.body.content)).toMatch('Partido terminado · Club OPC');
    expect(f.sent[0]!.files![0]!.name).toBe('partido-1000000000000000002.png');
    // Siguiente pasada: lee desde el último procesado y no repite.
    channel.push(opc('1000000000000000004', 0));
    await runOurProClub(deps);
    expect(f.reads.at(-1)).toBe('1000000000000000002');
    expect(f.sent).toHaveLength(2);
    await runOurProClub(deps);
    expect(f.sent).toHaveLength(2);
  });

  it('el Session Recap se guarda como sesión del club (no en clubes que ya reciben sesiones de Marítimo)', async () => {
    const own = await setup();
    const f = fakes([recapMsg('1000000000000000010', 3)]);
    await runOurProClub({
      repos: own.env.repos,
      reader: f.reader,
      poster: f.poster,
      blockedGuilds: new Set(),
      now: () => NOW,
    });
    expect(own.env.state.appliedSessions).toHaveLength(1);
    const s = own.env.state.appliedSessions[0]!;
    expect([
      s.provider,
      s.session.externalId,
      s.session.wins,
      s.session.losses,
      s.session.players[0]!.goals,
    ]).toEqual(['ourproclub', '1000000000000000010', 1, 1, 1]);
    expect(f.sent).toHaveLength(0); // la tarjeta la publica la tarea de resúmenes

    const maritimo = await setup({ provider: 'maritimo' });
    const g = fakes([recapMsg('1000000000000000011', 3)]);
    await runOurProClub({
      repos: maritimo.env.repos,
      reader: g.reader,
      poster: g.poster,
      blockedGuilds: new Set(),
      now: () => NOW,
    });
    expect(maritimo.env.state.appliedSessions).toHaveLength(0);
  });

  it('nunca publica en el servidor de referencia ni en los bloqueados; un error definitivo no se repite', async () => {
    for (const guild of [REFERENCE_GUILD_ID, '900000000000000099']) {
      const { env } = await setup({ guild });
      const f = fakes([opc('1000000000000000020', 1)]);
      await runOurProClub({
        repos: env.repos,
        reader: f.reader,
        poster: f.poster,
        blockedGuilds: new Set(['900000000000000099']),
        now: () => NOW,
      });
      expect(f.sent).toHaveLength(0);
    }
    const { env } = await setup();
    const f = fakes([opc('1000000000000000030', 1)], new DiscordPostError(403));
    const r = await runOurProClub({
      repos: env.repos,
      reader: f.reader,
      poster: f.poster,
      blockedGuilds: new Set(),
      now: () => NOW,
    });
    expect(r.errors?.[0]).toMatch('HTTP 403');
    expect(await env.repos.ourproclub.latest(env.state.clubs[0]!.id)).toBe('1000000000000000030');
  });
});
