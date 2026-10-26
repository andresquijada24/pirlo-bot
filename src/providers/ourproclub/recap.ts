import type { ExternalSessionPlayerStats } from '../types.js';

/**
 * Lector del «Session Recap» que Our Pro Club publica en Discord (embed con un campo por jugador).
 *
 * Campo de cada jugador: name «gamertag - 7.5», value «👕 GP: 9\n🥅 GLS: 2\n🤝 AST: 1\n🔗 ²AST: 3\n
 * 🛡️ TKL: 6/27\n🧤 GK SVS: 4…». Claves conocidas: GP, GLS, SHT, AST, ²AST, DRI, PAS a/b, TKL a/b,
 * INT, BLK, CLR, GK SVS. Convención de la fuente: nunca imprime un 0, así que una clave ausente vale 0
 * (es el dato de la fuente, no un invento). «²AST» (asistencia secundaria) nunca se toma como «AST».
 */

export interface DiscordEmbed {
  title?: string;
  description?: string;
  fields?: { name: string; value: string }[];
}

export interface OpcRecap {
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  players: ExternalSessionPlayerStats[];
}

const KEY = /(²?[A-Z]{2,4}(?: [A-Z]{2,4})?):\s*(\d+)(?:\s*\/\s*(\d+))?/g;

export function readPlayerValue(
  text: string,
): Omit<ExternalSessionPlayerStats, 'externalPlayerId' | 'gamertag' | 'rating'> {
  const v: Record<string, number> = {};
  const pairs: Record<string, [number, number]> = {};
  for (const [, key, a, b] of text.matchAll(KEY)) {
    if (key === 'PAS' || key === 'TKL')
      pairs[key] = [Number(a), b === undefined ? Number(a) : Number(b)];
    else v[key!] = Number(a);
  }
  const n = (k: string) => v[k] ?? 0;
  return {
    matchesPlayed: n('GP'),
    goals: n('GLS'),
    assists: n('AST'),
    goalsManual: null,
    assistsManual: null,
    shots: n('SHT'),
    dribbles: n('DRI'),
    passesMade: pairs.PAS?.[0] ?? 0,
    passesAttempted: pairs.PAS?.[1] ?? 0,
    tacklesMade: pairs.TKL?.[0] ?? 0,
    tacklesAttempted: pairs.TKL?.[1] ?? 0,
    interceptions: n('INT'),
    blocks: n('BLK'),
    clearances: n('CLR'),
    saves: v['GK SVS'] ?? v.SVS ?? v.SAV ?? 0,
  };
}

/** «gamertag - 7.5» → { gamertag, rating } */
export function readPlayerName(name: string): { gamertag: string; rating: number | null } {
  const m = name.trim().match(/^(.*?)\s+-\s+(\d+(?:[.,]\d+)?)\s*$/);
  return {
    gamertag: (m ? m[1]! : name).trim().slice(0, 40),
    rating: m ? Number(m[2]!.replace(',', '.')) : null,
  };
}

/** Embeds de un mensaje → resumen de sesión, o null si no es un «Session Recap». */
export function readSessionRecap(embeds: DiscordEmbed[] | undefined): OpcRecap | null {
  const e = (embeds ?? []).find((x) => /session recap/i.test(x.title ?? ''));
  if (!e) return null;
  const matchesPlayed = Number(
    (e.description ?? '').match(/played \*{0,2}(\d+)\*{0,2} match/i)?.[1] ?? 0,
  );
  const record = (e.fields ?? []).find((f) => /^record$/i.test(f.name.trim()))?.value ?? '';
  const count = (re: RegExp) => Number(record.match(re)?.[1] ?? 0);
  const players = (e.fields ?? [])
    .filter((f) => !/^record$/i.test(f.name.trim()))
    .map((f) => {
      const { gamertag, rating } = readPlayerName(f.name);
      return { externalPlayerId: null, gamertag, rating, ...readPlayerValue(f.value) };
    })
    .filter((p) => p.gamertag);
  return {
    matchesPlayed,
    wins: count(/(\d+)\s*wins?/i),
    draws: count(/(\d+)\s*draws?/i),
    losses: count(/(\d+)\s*loss(?:es)?/i),
    players,
  };
}
