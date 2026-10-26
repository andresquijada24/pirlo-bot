import { describe, expect, it } from 'vitest';
import { MaritimoStatsProvider } from '../../src/providers/maritimo/provider.js';
import { ProviderError } from '../../src/providers/types.js';

/*
 * Servidor simulado de api_v1 (docs/integrations/maritimo-api-v1.md).
 * Los datos son ficticios y solo existen en estas pruebas.
 */
const BASE = 'https://maritimo.example.supabase.co/functions/v1/api_v1';
const KEY = 'clave-de-prueba-no-real';

const jugadorSesion = (over: Record<string, unknown> = {}) => ({
  jugador_id: 'jug-1',
  gamertag: 'Pirlo21',
  partidos_jugados: 4,
  nota: 7.4,
  goles: 3,
  asistencias: 1,
  goles_manuales: 1,
  asistencias_manuales: 0,
  tiros: 6,
  regates: 4,
  pases_ok: 52,
  pases_tot: 61,
  entradas_ok: 5,
  entradas_tot: 9,
  intercepciones: 2,
  bloqueos: 1,
  despejes: 0,
  paradas: 0,
  ...over,
});

const sesion = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  publicada_at: '2026-10-20T23:10:00Z',
  fecha_juego: '2026-10-20',
  partidos: 4,
  victorias: 3,
  empates: 0,
  derrotas: 1,
  duplicada_de: null,
  actualizado_at: '2026-10-20T23:10:00Z',
  jugadores: [jugadorSesion()],
  ...over,
});

interface Call {
  url: URL;
  auth: string | null;
}

function fakeServer(routes: Record<string, (url: URL) => { status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const fetchFn = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get('authorization');
    calls.push({ url, auth });
    const path = url.pathname.replace(new URL(BASE).pathname, '');
    const route = routes[path];
    if (!route) return new Response('{}', { status: 404 });
    const r = route(url);
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: r.headers ?? { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, fetchFn };
}

const provider = (fetchFn: typeof fetch, extra: Partial<ConstructorParameters<typeof MaritimoStatsProvider>[0]> = {}) =>
  new MaritimoStatsProvider({ baseUrl: BASE, apiKey: KEY, fetch: fetchFn, ...extra });

describe('MaritimoStatsProvider', () => {
  it('envía la clave como Bearer y comprueba la conexión', async () => {
    const { calls, fetchFn } = fakeServer({
      '/estado': () => ({ body: { version: '1', club: { nombre: 'Marítimo CF' }, server_time: '2026-10-24T15:00:00Z' } }),
    });
    expect(await provider(fetchFn).ping()).toEqual({ ok: true, serverTime: '2026-10-24T15:00:00Z' });
    expect(calls[0]!.auth).toBe(`Bearer ${KEY}`);
  });

  it('declara que informa por sesión y que no tiene porterías imbatidas', () => {
    const p = provider(fakeServer({}).fetchFn);
    expect(p.capabilities.granularity).toBe('sesion');
    expect(p.capabilities.cleanSheets).toBe('none');
  });

  it('recorre todas las páginas y usa el server_time de la primera como próximo since', async () => {
    const { calls, fetchFn } = fakeServer({
      '/sesiones': (url) =>
        url.searchParams.get('cursor') === 'c2'
          ? { body: { data: [sesion('msg-2')], next_cursor: null, server_time: '2026-10-24T15:00:05Z' } }
          : { body: { data: [sesion('msg-1')], next_cursor: 'c2', server_time: '2026-10-24T15:00:00Z' } },
    });
    const res = await provider(fetchFn, { pageSize: 1 }).sessionsSince('2026-10-01T00:00:00Z');
    expect(res.items.map((s) => s.externalId)).toEqual(['msg-1', 'msg-2']);
    expect(res.serverTime).toBe('2026-10-24T15:00:00Z');
    expect(calls[0]!.url.searchParams.get('updated_since')).toBe('2026-10-01T00:00:00Z');
    expect(calls[0]!.url.searchParams.get('limit')).toBe('1');
    expect(calls[1]!.url.searchParams.get('cursor')).toBe('c2');
  });

  it('traduce los campos y conserva null (no los convierte en 0)', async () => {
    const { fetchFn } = fakeServer({
      '/sesiones': () => ({
        body: {
          data: [sesion('msg-1', { jugadores: [jugadorSesion({ jugador_id: null, nota: null, paradas: null })] })],
          next_cursor: null,
          server_time: '2026-10-24T15:00:00Z',
        },
      }),
    });
    const [s] = (await provider(fetchFn).sessionsSince(null)).items;
    expect(s).toMatchObject({ externalId: 'msg-1', playedOn: '2026-10-20', wins: 3, duplicateOf: null });
    expect(s!.players[0]).toMatchObject({
      externalPlayerId: null,
      gamertag: 'Pirlo21',
      rating: null,
      saves: null,
      goals: 3,
      goalsManual: 1,
      passesMade: 52,
      passesAttempted: 61,
      tacklesMade: 5,
      tacklesAttempted: 9,
    });
  });

  it('marca las sesiones duplicadas para que no se cuenten', async () => {
    const { fetchFn } = fakeServer({
      '/sesiones': () => ({
        body: { data: [sesion('msg-1b', { duplicada_de: 'msg-1' })], next_cursor: null, server_time: '2026-10-24T15:00:00Z' },
      }),
    });
    expect((await provider(fetchFn).sessionsSince(null)).items[0]!.duplicateOf).toBe('msg-1');
  });

  it('jugadores: activo solo si está activo y en la plantilla', async () => {
    const base = {
      gamertag: 'X', plataforma: 'ps', pos1: 'MC', posiciones: ['MC'], dorsal: 8,
      foto_url: null, actualizado_at: '2026-10-20T00:00:00Z',
    };
    const { fetchFn } = fakeServer({
      '/jugadores': () => ({
        body: {
          data: [
            { ...base, id: 'a', estado: 'activo', en_plantilla: true },
            { ...base, id: 'b', estado: 'activo', en_plantilla: false },
            { ...base, id: 'c', estado: 'baja', en_plantilla: true },
          ],
          next_cursor: null,
          server_time: '2026-10-24T15:00:00Z',
        },
      }),
    });
    const res = await provider(fetchFn).playersSince(null);
    expect(res.items.map((j) => [j.externalId, j.active])).toEqual([['a', true], ['b', false], ['c', false]]);
  });

  it('calendario: competición y marcador; sin marcador queda null', async () => {
    const { fetchFn, calls } = fakeServer({
      '/partidos': () => ({
        body: {
          data: [
            { id: 'p1', competicion: 'liga', nombre: null, rival: 'Rival', inicio: '2026-10-20T23:00:00Z',
              estado: 'finalizado', goles_favor: 2, goles_contra: 0, actualizado_at: '2026-10-21T00:00:00Z' },
            { id: 'p2', competicion: 'relampago', nombre: 'Relámpago', rival: null, inicio: '2026-10-21T23:00:00Z',
              estado: 'abierto', goles_favor: null, goles_contra: null, actualizado_at: '2026-10-21T00:00:00Z' },
          ],
          next_cursor: null,
          server_time: '2026-10-24T15:00:00Z',
        },
      }),
    });
    const res = await provider(fetchFn).matchesSince('2026-10-01T00:00:00Z');
    expect(calls[0]!.url.searchParams.get('updated_since')).toBe('2026-10-01T00:00:00Z');
    expect(res.items[0]).toMatchObject({ externalId: 'p1', competition: 'liga', goalsFor: 2, goalsAgainst: 0 });
    expect(res.items[1]).toMatchObject({ competition: 'relampago', goalsFor: null, goalsAgainst: null });
  });

  it('rechaza respuestas con formato inesperado en vez de guardar datos dudosos', async () => {
    const { fetchFn } = fakeServer({
      '/sesiones': () => ({
        body: { data: [sesion('msg-1', { jugadores: [jugadorSesion({ goles: -1 })] })], next_cursor: null, server_time: '2026-10-24T15:00:00Z' },
      }),
    });
    await expect(provider(fetchFn).sessionsSince(null)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('rechaza estadísticas incoherentes (pases completados > intentados)', async () => {
    const { fetchFn } = fakeServer({
      '/sesiones': () => ({
        body: { data: [sesion('m', { jugadores: [jugadorSesion({ pases_ok: 70, pases_tot: 61 })] })], next_cursor: null, server_time: '2026-10-24T15:00:00Z' },
      }),
    });
    await expect(provider(fetchFn).sessionsSince(null)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('401/403 → error de autenticación sin revelar la clave', async () => {
    const { fetchFn } = fakeServer({ '/estado': () => ({ status: 401, body: { error: 'no_autorizado' } }) });
    try {
      await provider(fetchFn).ping();
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).kind).toBe('auth');
      expect((e as Error).message).not.toMatch(KEY);
    }
  });

  it('429 → respeta Retry-After', async () => {
    const { fetchFn } = fakeServer({
      '/estado': () => ({ status: 429, body: {}, headers: { 'retry-after': '30', 'content-type': 'application/json' } }),
    });
    await expect(provider(fetchFn).ping()).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 30 });
  });

  it('5xx o red caída → no disponible', async () => {
    const { fetchFn } = fakeServer({ '/estado': () => ({ status: 503, body: {} }) });
    await expect(provider(fetchFn).ping()).rejects.toMatchObject({ kind: 'unavailable' });
    const down = (async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    await expect(provider(down).ping()).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('se detiene si el servidor repite el cursor (evita bucles infinitos)', async () => {
    const { fetchFn } = fakeServer({
      '/sesiones': () => ({ body: { data: [], next_cursor: 'mismo', server_time: '2026-10-24T15:00:00Z' } }),
    });
    await expect(provider(fetchFn).sessionsSince(null)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('exige https y una clave', () => {
    expect(() => new MaritimoStatsProvider({ baseUrl: 'http://inseguro', apiKey: KEY })).toThrow(ProviderError);
    expect(() => new MaritimoStatsProvider({ baseUrl: BASE, apiKey: '' })).toThrow(ProviderError);
  });

  it('eliminados: traduce tipo e id', async () => {
    const { fetchFn } = fakeServer({
      '/eliminados': () => ({
        body: { data: [{ tipo: 'sesion', id: 'msg-9', eliminado_at: '2026-10-22T10:00:00Z' }], next_cursor: null, server_time: '2026-10-24T15:00:00Z' },
      }),
    });
    expect((await provider(fetchFn).deletionsSince!(null)).items).toEqual([
      { kind: 'sesion', externalId: 'msg-9', deletedAt: '2026-10-22T10:00:00Z' },
    ]);
  });
});
