import { describe, expect, it } from 'vitest';
import { conflict } from '../../src/core/errors.js';
import { MARITIMO_CAPABILITIES } from '../../src/providers/maritimo/provider.js';
import {
  ProviderError,
  type ExternalDeletion,
  type ExternalPlayer,
  type ExternalSession,
  type Pull,
  type StatsProvider,
} from '../../src/providers/types.js';
import { runSync } from '../../src/sync/engine.js';
import type { FinishRunInput, SessionApplyResult, SyncRepository } from '../../src/sync/types.js';

// Datos ficticios: solo existen en estas pruebas.
const CLUB = '11111111-1111-4111-8111-111111111111';

const session = (externalId: string, updatedAt: string): ExternalSession => ({
  externalId,
  publishedAt: updatedAt,
  playedOn: updatedAt.slice(0, 10),
  matchesPlayed: 3,
  wins: 2,
  draws: 0,
  losses: 1,
  duplicateOf: null,
  updatedAt,
  players: [],
});
const player = (externalId: string): ExternalPlayer => ({
  externalId,
  gamertag: externalId.toUpperCase(),
  platform: 'ps',
  positions: [],
  shirtNumber: null,
  active: true,
  updatedAt: '2026-10-01T00:00:00Z',
});

function fakeProvider(data: {
  players?: ExternalPlayer[];
  sessions?: ExternalSession[];
  deletions?: ExternalDeletion[];
  serverTimes?: [string, string, string];
  fail?: Error;
}) {
  const since: (string | null)[] = [];
  const [tp, ts, td] = data.serverTimes ?? ['2026-10-24T15:00:00Z', '2026-10-24T15:00:01Z', '2026-10-24T15:00:02Z'];
  const pull = <T>(items: T[], serverTime: string) => async (s: string | null): Promise<Pull<T>> => {
    since.push(s);
    if (data.fail) throw data.fail;
    return { items, serverTime };
  };
  const provider: StatsProvider = {
    id: 'maritimo',
    capabilities: MARITIMO_CAPABILITIES,
    ping: async () => ({ ok: true, serverTime: tp }),
    playersSince: pull(data.players ?? [], tp),
    sessionsSince: pull(data.sessions ?? [], ts),
    deletionsSince: pull(data.deletions ?? [], td),
  };
  return { provider, since };
}

function fakeRepo(opts: { provider?: 'maritimo' | 'manual' | null; cursor?: string | null; busy?: boolean } = {}) {
  const calls: string[] = [];
  const finished: FinishRunInput[] = [];
  const seen = new Map<string, string>();
  const repo: SyncRepository = {
    clubProvider: async () => (opts.provider === undefined ? 'maritimo' : opts.provider),
    lastRun: async () => null,
    lastCursor: async () => opts.cursor ?? null,
    startRun: async () => {
      if (opts.busy) throw conflict('Ya hay una sincronización en curso.');
      return 'run-1';
    },
    finishRun: async (_c, _r, input) => {
      finished.push(input);
    },
    applyPlayers: async (clubId, _p, players) => {
      calls.push(`players:${clubId}:${players.length}`);
      return players.length;
    },
    applySession: async (clubId, _p, s): Promise<SessionApplyResult> => {
      calls.push(`session:${clubId}:${s.externalId}`);
      const prev = seen.get(s.externalId);
      seen.set(s.externalId, s.updatedAt);
      return prev === undefined ? 'insertada' : prev === s.updatedAt ? 'sin_cambios' : 'actualizada';
    },
    applyDeletion: async (clubId, _p, d) => {
      calls.push(`delete:${clubId}:${d.kind}:${d.externalId}`);
      return true;
    },
    lastMatchVersion: async () => null,
    schedulerKeyHash: async () => null,
    applyMatch: async (clubId, _p, m) => {
      calls.push(`match:${clubId}:${m.externalId}`);
      return 'insertada';
    },
  };
  return { repo, calls, finished, seen };
}

describe('runSync', () => {
  it('aplica jugadores, luego borrados y luego sesiones en orden de versión, todo en su club', async () => {
    const { provider } = fakeProvider({
      players: [player('a')],
      sessions: [session('s2', '2026-10-21T00:00:00Z'), session('s1', '2026-10-20T00:00:00Z')],
      deletions: [{ kind: 'sesion', externalId: 's0', deletedAt: '2026-10-22T00:00:00Z' }],
    });
    const { repo, calls, finished } = fakeRepo();
    const res = await runSync({ repo, provider, clubId: CLUB });
    expect(calls).toEqual([
      `players:${CLUB}:1`,
      `delete:${CLUB}:sesion:s0`,
      `session:${CLUB}:s1`,
      `session:${CLUB}:s2`,
    ]);
    expect(res).toMatchObject({ status: 'ok', players: 1, inserted: 2, updated: 0, deleted: 1 });
    expect(finished[0]).toMatchObject({ status: 'ok', rowsInserted: 2, rowsUpdated: 1, errorMessage: null });
  });

  it('el próximo cursor es la hora de servidor más antigua de las descargas', async () => {
    const { provider } = fakeProvider({
      serverTimes: ['2026-10-24T15:00:05Z', '2026-10-24T15:00:01Z', '2026-10-24T15:00:09Z'],
    });
    const { repo, finished } = fakeRepo();
    await runSync({ repo, provider, clubId: CLUB });
    expect(finished[0]!.cursorAfter).toBe('2026-10-24T15:00:01Z');
  });

  it('pide solo lo cambiado desde el último cursor', async () => {
    const { provider, since } = fakeProvider({});
    const { repo } = fakeRepo({ cursor: '2026-10-23T00:00:00Z' });
    await runSync({ repo, provider, clubId: CLUB });
    expect(since).toEqual(['2026-10-23T00:00:00Z', '2026-10-23T00:00:00Z', '2026-10-23T00:00:00Z']);
  });

  it('deduplica registros repetidos entre páginas y conserva la versión más reciente', async () => {
    const { provider } = fakeProvider({
      sessions: [
        session('s1', '2026-10-20T00:00:00Z'),
        session('s1', '2026-10-20T05:00:00Z'),
      ],
    });
    const { repo, calls, seen } = fakeRepo();
    await runSync({ repo, provider, clubId: CLUB });
    expect(calls.filter((c) => c.startsWith('session'))).toHaveLength(1);
    expect(seen.get('s1')).toBe('2026-10-20T05:00:00Z');
  });

  it('si se agota el tiempo, guarda como cursor la última sesión aplicada', async () => {
    const { provider } = fakeProvider({
      sessions: [
        session('s1', '2026-10-20T00:00:00Z'),
        session('s2', '2026-10-21T00:00:00Z'),
        session('s3', '2026-10-22T00:00:00Z'),
      ],
    });
    const { repo, finished, calls } = fakeRepo();
    let t = 0;
    const res = await runSync({ repo, provider, clubId: CLUB, budgetMs: 15, now: () => (t += 10) });
    expect(res.status).toBe('parcial');
    expect(calls.filter((c) => c.startsWith('session'))).toEqual([`session:${CLUB}:s1`]);
    expect(finished[0]).toMatchObject({ status: 'ok', cursorAfter: '2026-10-20T00:00:00Z' });
  });

  it('no sincroniza si el club no usa ese proveedor (aislamiento)', async () => {
    const { provider, since } = fakeProvider({ sessions: [session('s1', '2026-10-20T00:00:00Z')] });
    const { repo, calls, finished } = fakeRepo({ provider: 'manual' });
    const res = await runSync({ repo, provider, clubId: CLUB });
    expect(res.status).toBe('omitida');
    expect(since).toEqual([]);
    expect(calls).toEqual([]);
    expect(finished).toEqual([]);
  });

  it('no sincroniza si el club no existe', async () => {
    const { provider } = fakeProvider({});
    const res = await runSync({ repo: fakeRepo({ provider: null }).repo, provider, clubId: CLUB });
    expect(res).toMatchObject({ status: 'omitida', message: 'El club configurado no existe.' });
  });

  it('un error del proveedor cierra la ejecución como error y no avanza el cursor', async () => {
    const { provider } = fakeProvider({ fail: new ProviderError('auth', 'La API de Marítimo rechazó la clave') });
    const { repo, finished, calls } = fakeRepo();
    const res = await runSync({ repo, provider, clubId: CLUB });
    expect(res).toEqual({ status: 'error', message: 'La API de Marítimo rechazó la clave' });
    expect(finished[0]).toMatchObject({ status: 'error', cursorAfter: null });
    expect(calls).toEqual([]);
  });

  it('un error inesperado no expone detalles internos', async () => {
    const { provider } = fakeProvider({ fail: new Error('connection string postgres://secreto@host') });
    const { repo, finished } = fakeRepo();
    const res = await runSync({ repo, provider, clubId: CLUB });
    expect(res.message).toBe('Error interno durante la sincronización.');
    expect(finished[0]!.errorMessage).not.toMatch('secreto');
  });

  it('si ya hay otra ejecución en curso, no empieza otra', async () => {
    const { provider, since } = fakeProvider({});
    await expect(runSync({ repo: fakeRepo({ busy: true }).repo, provider, clubId: CLUB })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(since).toEqual([]);
  });

  it('importa el calendario desde su propia versión; si falla, las sesiones siguen valiendo', async () => {
    const match = {
      externalId: 'p1',
      competition: 'liga' as const,
      name: null,
      opponent: 'Rival',
      startsAt: '2026-10-01T23:00:00Z',
      state: 'finalizado',
      goalsFor: 2,
      goalsAgainst: 0,
      updatedAt: '2026-10-02T00:00:00Z',
    };
    const asked: (string | null)[] = [];
    const { provider } = fakeProvider({ sessions: [session('s1', '2026-10-01T00:00:00Z')] });
    provider.matchesSince = async (since) => {
      asked.push(since);
      return { items: [match, match], serverTime: '2026-10-24T15:00:00Z' };
    };
    const ok = fakeRepo({ cursor: '2026-10-20T00:00:00Z' });
    ok.repo.lastMatchVersion = async () => '2026-09-30T00:00:00Z';
    const res = await runSync({ repo: ok.repo, provider, clubId: CLUB });
    expect(res).toMatchObject({ status: 'ok', inserted: 1, matches: 1 });
    expect(asked).toEqual(['2026-09-30T00:00:00Z']);
    expect(ok.calls).toContain(`match:${CLUB}:p1`);

    provider.matchesSince = async () => {
      throw new ProviderError('request', 'Marítimo rechazó la consulta a /partidos (404).');
    };
    const bad = fakeRepo();
    const res2 = await runSync({ repo: bad.repo, provider, clubId: CLUB });
    expect(res2).toMatchObject({ status: 'ok', inserted: 1, matchesError: 'Marítimo rechazó la consulta a /partidos (404).' });
    expect(bad.finished[0]).toMatchObject({ status: 'ok' });
  });
});
