import sharp from 'sharp';
import type { MatchResult, MatchResultPlayer } from '../../render/result-card.js';

/**
 * Lectura de la imagen de partido que publica Our Pro Club (1920×1080) con un lector de texto
 * (OCR). La imagen siempre tiene la misma composición: marcador arriba («LOCAL n VS. n VISITANTE»),
 * detalles del partido a la izquierda y la tabla de jugadores del club a la derecha, con columnas
 * fijas. Se lee cada celda por separado, en blanco y negro y ampliada, que es lo que da lecturas
 * exactas.
 *
 * Nada se inventa: si algo no se puede leer con seguridad (marcador, nombres de los equipos,
 * calificaciones) o los números no cuadran (más goles de jugadores que goles del club, pases
 * completados mayores que intentados…), devuelve null y no se publica tarjeta con esos datos.
 * En la imagen «-» significa 0 (convención de Our Pro Club).
 */

/** Motor de lectura: devuelve el texto de una imagen PNG de una sola línea. */
export interface Ocr {
  read(
    png: Uint8Array,
    opts: { chars?: string; mode: 'line' | 'word' | 'raw' | 'block' },
  ): Promise<string>;
}

const BASE_W = 1920;
const BASE_H = 1080;
/** Centro (x) de cada columna numérica de la tabla. */
const COLUMNS = {
  rating: 1015,
  goals: 1075,
  shots: 1135,
  assists: 1195,
  secondAssists: 1255,
  dribbles: 1315,
  passes: 1380,
  possession: 1470,
  tackles: 1560,
  interceptions: 1640,
  blocks: 1700,
  clearances: 1760,
  saves: 1840,
} as const;
const WIDE = new Set(['passes', 'possession', 'tackles']);
const FIRST_ROW_Y = 293;
const ROW_STEP = 52;
const MAX_ROWS = 11;
const DIGITS = '0123456789';

/** Imagen en escala de grises con el canal más brillante de cada píxel (el texto es blanco o de color). */
interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
  scale: number;
}

async function toGray(png: Uint8Array): Promise<Gray | null> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) return null;
  // Debe ser 16:9 (la composición de Our Pro Club); si la publican a otro tamaño, se escala.
  if (Math.abs(info.width / info.height - BASE_W / BASE_H) > 0.01 || info.width < 1280) return null;
  const gray = new Uint8Array(info.width * info.height);
  for (let i = 0, j = 0; i < gray.length; i++, j += 3)
    gray[i] = Math.max(data[j]!, data[j + 1]!, data[j + 2]!);
  return { width: info.width, height: info.height, data: gray, scale: info.width / BASE_W };
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function box(g: Gray, x0: number, y0: number, x1: number, y1: number): Box {
  const left = Math.max(0, Math.round(x0 * g.scale));
  const top = Math.max(0, Math.round(y0 * g.scale));
  const right = Math.min(g.width, Math.round(x1 * g.scale));
  const bottom = Math.min(g.height, Math.round(y1 * g.scale));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** Recorte → ampliado → texto negro sobre blanco (umbral) con margen blanco. */
async function cell(
  g: Gray,
  b: Box,
  opts: { scale?: number; height?: number; threshold: number },
): Promise<Uint8Array> {
  const width = opts.height
    ? Math.max(1, Math.round((b.width * opts.height) / b.height))
    : Math.round((b.width * (opts.scale ?? 3)) / g.scale);
  const height = opts.height ?? Math.round((b.height * (opts.scale ?? 3)) / g.scale);
  const scaled = await sharp(Buffer.from(g.data), {
    raw: { width: g.width, height: g.height, channels: 1 },
  })
    .extract(b)
    .resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
    .extractChannel(0)
    .raw()
    .toBuffer();
  // Umbral a mano (texto negro sobre blanco) y margen blanco de 20 px.
  const M = 20;
  const outW = width + 2 * M;
  const out = new Uint8Array(outW * (height + 2 * M)).fill(255);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (scaled[y * width + x]! > opts.threshold) out[(y + M) * outW + x + M] = 0;
  const png = await sharp(Buffer.from(out), {
    raw: { width: outW, height: height + 2 * M, channels: 1 },
  })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

/** Caja que encierra los píxeles más brillantes que el umbral (para los dígitos grandes). */
function brightBox(g: Gray, b: Box, threshold: number): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = b.top; y < b.top + b.height; y++)
    for (let x = b.left; x < b.left + b.width; x++)
      if (g.data[y * g.width + x]! > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

const clean = (s: string) => s.replace(/\s+/g, '').trim();

/** Marcador de un equipo: varias lecturas (tamaños y modos) y gana la más repetida. */
async function readScore(g: Gray, ocr: Ocr, x0: number, x1: number): Promise<number | null> {
  const b = brightBox(g, box(g, x0, 20, x1, 115), 225);
  if (!b || b.height < 20 * g.scale) return null;
  const votes = new Map<number, number>();
  for (const height of [40, 60, 90]) {
    const png = await cell(g, b, { height, threshold: 225 });
    for (const mode of ['line', 'word', 'raw'] as const) {
      const t = clean(await ocr.read(png, { chars: DIGITS, mode }));
      if (/^\d{1,2}$/.test(t)) votes.set(Number(t), (votes.get(Number(t)) ?? 0) + 1);
    }
  }
  const ranked = [...votes].sort((a, b2) => b2[1] - a[1]);
  if (ranked.length === 0) return null;
  // Empate entre dos lecturas distintas: no hay seguridad.
  if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) return null;
  return ranked[0]![0];
}

async function readTeamName(g: Gray, ocr: Ocr, x0: number, x1: number): Promise<string | null> {
  const t = (
    await ocr.read(await cell(g, box(g, x0, 40, x1, 110), { scale: 1, threshold: 200 }), {
      mode: 'line',
    })
  )
    .replace(/\s+/g, ' ')
    .trim();
  return t.length >= 2 ? t : null;
}

/** «-» = 0; «17/21» = [17, 21]; vacío o ilegible = undefined. */
function num(t: string): number | null | undefined {
  if (/^-+$/.test(t)) return 0;
  return /^\d{1,3}$/.test(t) ? Number(t) : undefined;
}
function pair(t: string): [number, number] | null | undefined {
  if (/^-+$/.test(t)) return null;
  const m = /^(\d{1,3})\/(\d{1,3})$/.exec(t);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/** Quita acentos y todo lo que no sea letra o número, en mayúsculas. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length]!;
}

/** Parecido entre 0 y 1 (1 = iguales tras normalizar). */
export function similarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  return 1 - distance(x, y) / Math.max(x.length, y.length);
}

/**
 * Nombre del jugador: el texto leído trae detrás los iconos de la fila (balón, guante…), que el
 * lector convierte en símbolos sueltos. Si coincide con un gamertag conocido del club (con una o
 * dos letras de diferencia, p. ej. «apirloS» por «apirlo5»), se usa el conocido; si no, la primera
 * palabra.
 */
export function resolvePlayerName(raw: string, known: readonly string[]): string | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const token = text.split(' ')[0]!.toLowerCase();
  // Distancia a cada gamertag conocido: la palabra entera o su comienzo (el lector a veces
  // duplica o añade una letra al final, p. ej. «apirloSs»).
  const scored = known
    .map((name) => {
      const n = name.toLowerCase();
      const d = Math.min(
        distance(n, token),
        distance(n, token.slice(0, n.length)) + (token.length > n.length ? 1 : 0),
      );
      const max = n.length <= 3 ? 0 : n.length <= 8 ? 2 : 3;
      return { name, d, ok: d <= max };
    })
    .filter((s) => s.ok)
    .sort((a, b) => a.d - b.d);
  // Solo si hay un único mejor candidato (sin empate que haga dudar).
  if (scored.length > 0 && (scored.length === 1 || scored[1]!.d > scored[0]!.d))
    return scored[0]!.name;
  const first = text.split(' ')[0]!.replace(/[^\p{L}\p{N}_.-]/gu, '');
  return first.length >= 2 ? first : null;
}

export interface MatchImageRead {
  home: { name: string; score: number };
  away: { name: string; score: number };
  /** «League Match…» → LIGA; null si no se reconoce. */
  competition: string | null;
  humans: { home: number; away: number } | null;
  players: MatchResultPlayer[];
}

/** Lee la imagen. null si no tiene la composición de Our Pro Club o algo esencial no se lee. */
export async function readMatchImage(
  png: Uint8Array,
  ocr: Ocr,
  knownPlayers: readonly string[] = [],
): Promise<MatchImageRead | null> {
  const g = await toGray(png);
  if (!g) return null;

  const [homeScore, awayScore] = [
    await readScore(g, ocr, 700, 870),
    await readScore(g, ocr, 1000, 1180),
  ];
  const homeName = await readTeamName(g, ocr, 40, 560);
  const awayName = await readTeamName(g, ocr, 1350, 1900);
  if (homeScore === null || awayScore === null || !homeName || !awayName) return null;

  const details = (
    await ocr.read(await cell(g, box(g, 60, 305, 580, 355), { threshold: 150 }), {
      mode: 'block',
    })
  ).replace(/\s+/g, ' ');
  const competition = /league/i.test(details)
    ? 'LIGA'
    : /friendly/i.test(details)
      ? 'AMISTOSO'
      : /cup|play\s*off/i.test(details)
        ? 'COPA'
        : null;
  const vs = /(\d{1,2})\s*vs\.?\s*(\d{1,2})\s*player/i.exec(details);
  const humans = vs ? { home: Number(vs[1]), away: Number(vs[2]) } : null;

  const players: MatchResultPlayer[] = [];
  for (let r = 0; r < MAX_ROWS; r++) {
    const y = FIRST_ROW_Y + ROW_STEP * r;
    if ((y + 30) * g.scale > g.height) break;
    const ratingText = clean(
      await ocr.read(await cell(g, box(g, 985, y - 14, 1045, y + 14), { threshold: 130 }), {
        chars: `${DIGITS}.`,
        mode: 'line',
      }),
    );
    // La calificación siempre existe (6.1, 10.0…): sin ella, la tabla terminó.
    if (!/^\d{1,2}\.\d$/.test(ratingText)) break;
    const rating = Number(ratingText);
    if (rating <= 0 || rating > 10) return null;

    const name = resolvePlayerName(
      await ocr.read(await cell(g, box(g, 645, y - 22, 975, y + 2), { threshold: 150 }), {
        mode: 'line',
      }),
      knownPlayers,
    );
    if (!name) return null;

    const values: Record<string, string> = {};
    for (const [key, x] of Object.entries(COLUMNS)) {
      if (key === 'rating') continue;
      const half = WIDE.has(key) ? 55 : 30;
      values[key] = clean(
        await ocr.read(
          await cell(g, box(g, x - half, y - 14, x + half, y + 14), { threshold: 130 }),
          {
            chars: `${DIGITS}/-`,
            mode: 'line',
          },
        ),
      );
    }
    const n = (k: string) => num(values[k] ?? '');
    const p = (k: string) => pair(values[k] ?? '');
    const passes = p('passes');
    const tackles = p('tackles');
    const single = [
      'goals',
      'shots',
      'assists',
      'dribbles',
      'interceptions',
      'blocks',
      'clearances',
      'saves',
    ];
    if (single.some((k) => n(k) === undefined) || passes === undefined || tackles === undefined)
      return null;
    // Completados nunca más que intentados.
    if ((passes && passes[0] > passes[1]) || (tackles && tackles[0] > tackles[1])) return null;
    players.push({
      name,
      rating,
      goals: n('goals')!,
      assists: n('assists')!,
      shots: n('shots')!,
      dribbles: n('dribbles')!,
      passesMade: passes ? passes[0] : 0,
      passesAttempted: passes ? passes[1] : 0,
      tacklesMade: tackles ? tackles[0] : 0,
      tacklesAttempted: tackles ? tackles[1] : 0,
      interceptions: n('interceptions')!,
      blocks: n('blocks')!,
      clearances: n('clearances')!,
      saves: n('saves')!,
    });
  }
  if (players.length === 0) return null;
  return {
    home: { name: homeName, score: homeScore },
    away: { name: awayName, score: awayScore },
    competition,
    humans,
    players,
  };
}

/**
 * Convierte la lectura al partido del club: decide si el club fue local o visitante por el nombre
 * (sin acentos ni mayúsculas) y comprueba que los números cuadren. null si no hay seguridad.
 */
export function toClubMatch(
  read: MatchImageRead,
  clubNames: readonly string[],
  playedOn: string | null,
): MatchResult | null {
  const score = (side: string) => Math.max(0, ...clubNames.map((n) => similarity(n, side)));
  const homeSim = score(read.home.name);
  const awaySim = score(read.away.name);
  const best = Math.max(homeSim, awaySim);
  if (best < 0.75 || Math.abs(homeSim - awaySim) < 0.2) return null;
  const home = homeSim > awaySim;
  const [us, them] = home ? [read.home, read.away] : [read.away, read.home];
  const sum = (f: (p: MatchResultPlayer) => number | null) =>
    read.players.reduce((a, p) => a + (f(p) ?? 0), 0);
  // Los goles de los jugadores del club nunca superan los del club (puede haber autogoles a favor).
  if (sum((p) => p.goals) > us.score || sum((p) => p.assists) > us.score) return null;
  return {
    playedOn,
    competition: read.competition,
    humans: read.humans
      ? home
        ? { club: read.humans.home, rival: read.humans.away }
        : { club: read.humans.away, rival: read.humans.home }
      : null,
    home,
    goalsFor: us.score,
    goalsAgainst: them.score,
    opponentName: them.name,
    players: read.players,
  };
}
