import { z } from 'zod';

/**
 * Captura de partidos de EA Pro Clubs que envía el puente (un equipo con conexión residencial,
 * porque EA bloquea las peticiones desde servidores en la nube).
 *
 * El puente reenvía la respuesta de EA tal cual. Aquí solo se valida lo imprescindible para
 * guardarla sin perder nada: el partido tiene id y fecha, y el club pedido jugó ese partido.
 * El procesamiento a estadísticas se hace después, a partir de esta copia.
 */

export const EA_PLATFORMS = ['common-gen5', 'common-gen4'] as const;
export const EA_MATCH_TYPES = ['leagueMatch', 'playoffMatch', 'friendlyMatch'] as const;
/** EA devuelve como mucho unos pocos partidos por tipo; se admite margen. */
const MAX_MATCHES = 25;

const digits = (max: number) => z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(new RegExp(`^\\d{1,${max}}$`)));

const eaMatch = z
  .object({
    matchId: digits(20),
    timestamp: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().int().positive()),
    clubs: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export const ingestSchema = z.object({
  platform: z.enum(EA_PLATFORMS),
  eaClubId: digits(12),
  matchType: z.enum(EA_MATCH_TYPES),
  matches: z.array(z.unknown()).max(MAX_MATCHES),
});

export interface CachedMatch {
  platform: (typeof EA_PLATFORMS)[number];
  eaClubId: string;
  matchId: string;
  matchType: (typeof EA_MATCH_TYPES)[number];
  playedAt: string;
  payload: Record<string, unknown>;
}

export interface ParsedIngest {
  matches: CachedMatch[];
  /** Partidos descartados por formato inesperado o porque el club no aparece en ellos. */
  rejected: number;
}

export function parseIngest(body: unknown): ParsedIngest {
  const input = ingestSchema.parse(body);
  const matches: CachedMatch[] = [];
  let rejected = 0;
  for (const raw of input.matches) {
    const m = eaMatch.safeParse(raw);
    if (!m.success || !(input.eaClubId in m.data.clubs)) {
      rejected++;
      continue;
    }
    matches.push({
      platform: input.platform,
      eaClubId: input.eaClubId,
      matchId: m.data.matchId,
      matchType: input.matchType,
      playedAt: new Date(m.data.timestamp * 1000).toISOString(),
      payload: raw as Record<string, unknown>,
    });
  }
  return { matches, rejected };
}
