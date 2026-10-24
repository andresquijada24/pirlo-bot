import type { z } from 'zod';
import {
  ProviderError,
  type ExternalDeletion,
  type ExternalPlayer,
  type ExternalSession,
  type ProviderCapabilities,
  type Pull,
  type StatsProvider,
} from '../types.js';
import { eliminadoSchema, estadoSchema, jugadorSchema, pageSchema, sesionSchema } from './schema.js';

/**
 * MaritimoStatsProvider — consume la API de SOLO LECTURA api_v1 de maritimo.app.
 *
 * - Nunca accede a la base de datos de Marítimo: solo HTTP con su clave de lectura.
 * - La clave solo se usa en la cabecera Authorization; nunca aparece en errores ni logs.
 * - Las estadísticas son por SESIÓN (resúmenes de OurProClub), no por partido.
 */
export interface MaritimoConfig {
  baseUrl: string;
  apiKey: string;
  /** Inyectable para pruebas. */
  fetch?: typeof fetch;
  pageSize?: number;
  /** Límite de páginas por consulta, como salvaguarda ante bucles. */
  maxPages?: number;
  timeoutMs?: number;
}

export const MARITIMO_CAPABILITIES: ProviderCapabilities = {
  granularity: 'sesion',
  goals: true,
  assists: true,
  tackles: true,
  passes: true,
  rating: true,
  cleanSheets: 'none',
  deletions: true,
};

export class MaritimoStatsProvider implements StatsProvider {
  readonly id = 'maritimo' as const;
  readonly capabilities = MARITIMO_CAPABILITIES;
  private readonly base: string;
  private readonly http: typeof fetch;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly timeoutMs: number;

  constructor(private readonly config: MaritimoConfig) {
    if (!/^https:\/\//.test(config.baseUrl)) {
      throw new ProviderError('request', 'La URL de la API de Marítimo debe empezar por https://');
    }
    if (!config.apiKey) throw new ProviderError('auth', 'Falta la clave de la API de Marítimo.');
    this.base = config.baseUrl.replace(/\/+$/, '');
    this.http = config.fetch ?? fetch;
    this.pageSize = Math.min(Math.max(config.pageSize ?? 200, 1), 200);
    this.maxPages = config.maxPages ?? 100;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async ping() {
    const body = estadoSchema.parse(await this.get('/estado', {}));
    return { ok: true as const, serverTime: body.server_time };
  }

  async playersSince(since: string | null): Promise<Pull<ExternalPlayer>> {
    const { items, serverTime } = await this.pullAll('/jugadores', jugadorSchema, since);
    return {
      serverTime,
      items: items.map((j) => ({
        externalId: j.id,
        gamertag: j.gamertag,
        platform: j.plataforma,
        positions: j.posiciones,
        shirtNumber: j.dorsal,
        active: j.estado === 'activo' && j.en_plantilla,
        updatedAt: j.actualizado_at,
      })),
    };
  }

  async sessionsSince(since: string | null): Promise<Pull<ExternalSession>> {
    const { items, serverTime } = await this.pullAll('/sesiones', sesionSchema, since);
    return {
      serverTime,
      items: items.map((s) => ({
        externalId: s.id,
        publishedAt: s.publicada_at,
        playedOn: s.fecha_juego,
        matchesPlayed: s.partidos,
        wins: s.victorias,
        draws: s.empates,
        losses: s.derrotas,
        duplicateOf: s.duplicada_de,
        updatedAt: s.actualizado_at,
        players: s.jugadores.map((j) => ({
          externalPlayerId: j.jugador_id,
          gamertag: j.gamertag,
          matchesPlayed: j.partidos_jugados,
          rating: j.nota,
          goals: j.goles,
          assists: j.asistencias,
          goalsManual: j.goles_manuales,
          assistsManual: j.asistencias_manuales,
          shots: j.tiros,
          dribbles: j.regates,
          passesMade: j.pases_ok,
          passesAttempted: j.pases_tot,
          tacklesMade: j.entradas_ok,
          tacklesAttempted: j.entradas_tot,
          interceptions: j.intercepciones,
          blocks: j.bloqueos,
          clearances: j.despejes,
          saves: j.paradas,
        })),
      })),
    };
  }

  async deletionsSince(since: string | null): Promise<Pull<ExternalDeletion>> {
    const { items, serverTime } = await this.pullAll('/eliminados', eliminadoSchema, since);
    return {
      serverTime,
      items: items.map((e) => ({ kind: e.tipo, externalId: e.id, deletedAt: e.eliminado_at })),
    };
  }

  /** Recorre todas las páginas. El serverTime de la PRIMERA página es el próximo `since`. */
  private async pullAll<S extends z.ZodTypeAny>(
    path: string,
    item: S,
    since: string | null,
  ): Promise<{ items: z.infer<S>[]; serverTime: string }> {
    const schema = pageSchema(item);
    const items: z.infer<S>[] = [];
    let cursor: string | null = null;
    let serverTime: string | null = null;

    for (let page = 0; page < this.maxPages; page++) {
      const params: Record<string, string> = { limit: String(this.pageSize) };
      if (since) params.updated_since = since;
      if (cursor) params.cursor = cursor;

      const parsed = schema.safeParse(await this.get(path, params));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ProviderError(
          'invalid_response',
          `Respuesta de Marítimo con formato inesperado en ${path} (${issue?.path.join('.') || 'raíz'}: ${issue?.message}).`,
        );
      }
      serverTime ??= parsed.data.server_time;
      items.push(...parsed.data.data);
      if (!parsed.data.next_cursor) return { items, serverTime };
      if (parsed.data.next_cursor === cursor) {
        throw new ProviderError('invalid_response', `Marítimo repitió el mismo cursor en ${path}.`);
      }
      cursor = parsed.data.next_cursor;
    }
    throw new ProviderError('invalid_response', `Demasiadas páginas en ${path}; se detuvo por seguridad.`);
  }

  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    let res: Response;
    try {
      res = await this.http(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ProviderError('unavailable', 'No se pudo conectar con la API de Marítimo.');
    }

    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('auth', `Marítimo rechazó la clave de acceso (${res.status}).`);
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after'));
      throw new ProviderError(
        'rate_limited',
        'Marítimo pidió esperar antes de volver a consultar.',
        Number.isFinite(retry) && retry > 0 ? retry : 60,
      );
    }
    if (res.status >= 500) {
      throw new ProviderError('unavailable', `La API de Marítimo no está disponible (${res.status}).`);
    }
    if (!res.ok) {
      throw new ProviderError('request', `Marítimo rechazó la consulta a ${path} (${res.status}).`);
    }
    try {
      return await res.json();
    } catch {
      throw new ProviderError('invalid_response', `Marítimo devolvió una respuesta que no es JSON en ${path}.`);
    }
  }
}
