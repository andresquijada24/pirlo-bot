import type { EaRecap, EaRecapPlayer } from '../db/repositories/types.js';
import { LOGO_PNG_BASE64 } from './assets/logo.js';
import { fit, measure, text } from './text.js';

/**
 * Tarjeta de un partido de EA en SVG (diseño propio de PIRLO BOT, con su logo original).
 * Solo jugadores propios; el rival aparece por nombre y marcador. Lo que EA no ofrece se dibuja
 * como "—": nunca se inventa un dato. Sin imágenes ni escudos de terceros.
 */

export const CARD_WIDTH = 1200;
const PAD = 56;
const HEADER = 300;
const TABLE_HEAD = 46;
const ROW = 56;
const FOOTER = 78;

const C = {
  bg1: '#020617',
  bg2: '#0b1a4a',
  streak: '#1d4ed8',
  accent: '#38bdf8',
  silver: '#e5e7eb',
  muted: '#94a3b8',
  dim: '#64748b',
  line: '#1e293b',
  win: '#22c55e',
  draw: '#eab308',
  loss: '#ef4444',
};

const RESULT = {
  victoria: { label: 'VICTORIA', color: C.win },
  empate: { label: 'EMPATE', color: C.draw },
  derrota: { label: 'DERROTA', color: C.loss },
} as const;

const TYPE = { leagueMatch: 'LIGA', playoffMatch: 'PLAYOFF', friendlyMatch: 'AMISTOSO' } as const;

const POSITION: Record<string, string> = {
  goalkeeper: 'POR',
  defender: 'DEF',
  midfielder: 'MED',
  forward: 'DEL',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (v: number | null) => (v === null ? '—' : String(v));
const pair = (a: number | null, b: number | null) => (a === null || b === null ? '—' : `${a}/${b}`);

/** Iniciales para el escudo genérico: "LACRITAS FC" → "LF". */
export function initials(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.length >= 2 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

function ratingColor(r: number): string {
  if (r >= 8) return C.win;
  if (r >= 7) return '#3b82f6';
  if (r >= 6) return C.draw;
  return C.loss;
}

function star(cx: number, cy: number, r: number, fill: string): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
}

/** Blanco o casi negro, según lo que se lea mejor sobre el color de fondo. */
function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#0b1020' : '#ffffff';
}

const HEX = /^#[0-9a-f]{6}$/;

function crest(
  cx: number,
  cy: number,
  label: string,
  own: boolean,
  png?: string | null,
  colors?: { primary: string; secondary: string } | null,
): string {
  if (png && /^[A-Za-z0-9+/]+=*$/.test(png)) {
    // Escudo subido por el club (PNG cuadrado de 256 px, normalizado al guardarlo).
    const s = 120;
    const x = cx - s / 2;
    const y = cy - s / 2 + 4;
    return (
      `<clipPath id="crest-own"><rect x="${x}" y="${y}" width="${s}" height="${s}" rx="22"/></clipPath>` +
      `<image href="data:image/png;base64,${png}" x="${x}" y="${y}" width="${s}" height="${s}" clip-path="url(#crest-own)"/>`
    );
  }
  const shield = `M${cx - 40} ${cy - 46} H${cx + 40} V${cy + 4} Q${cx + 40} ${cy + 38} ${cx} ${cy + 54} Q${cx - 40} ${cy + 38} ${cx - 40} ${cy + 4} Z`;
  // Con los colores de la equipación (datos del partido); si no hay, el estilo neutro de PIRLO.
  const kit = colors && HEX.test(colors.primary) && HEX.test(colors.secondary) ? colors : null;
  const fill = kit?.primary ?? '#0f172a';
  const stroke = kit ? (kit.secondary === kit.primary ? C.silver : kit.secondary) : own ? C.accent : C.muted;
  return (
    `<path d="${shield}" fill="${fill}" stroke="${stroke}" stroke-width="5"/>` +
    text(label, cx, cy + 14, { size: 34, weight: 'bold', anchor: 'middle', fill: kit ? readableOn(fill) : C.silver })
  );
}

function formatWhen(iso: string, timeZone: string): string {
  const d = new Date(iso);
  try {
    const parts = new Intl.DateTimeFormat('es', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')} · ${get('hour')}:${get('minute')}`
      .replace(/\./g, '')
      .toUpperCase();
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

const COLUMNS = [
  { key: 'pos', label: 'POS', x: 520 },
  { key: 'rating', label: 'CALIF.', x: 612 },
  { key: 'goals', label: 'G', x: 690 },
  { key: 'assists', label: 'A', x: 748 },
  { key: 'shots', label: 'TIR', x: 812 },
  { key: 'passes', label: 'PASES', x: 900 },
  { key: 'tackles', label: 'ENTR', x: 1000 },
  { key: 'saves', label: 'PAR', x: 1080 },
] as const;

function cell(p: EaRecapPlayer, key: (typeof COLUMNS)[number]['key']): string {
  switch (key) {
    case 'pos':
      return p.position ? (POSITION[p.position] ?? p.position.slice(0, 3).toUpperCase()) : '—';
    case 'rating':
      return p.rating === null ? '—' : p.rating.toFixed(1);
    case 'goals':
      return num(p.goals);
    case 'assists':
      return num(p.assists);
    case 'shots':
      return num(p.shots);
    case 'passes':
      return pair(p.passesMade, p.passesAttempted);
    case 'tackles':
      return pair(p.tacklesMade, p.tacklesAttempted);
    case 'saves':
      return num(p.saves);
  }
}

export interface MatchCardInput {
  recap: EaRecap;
  clubName: string;
  timeZone: string;
  /** Escudo del club (PNG en base64), si lo subió con /club escudo. */
  clubCrestPng?: string | null;
}

export function cardHeight(players: number): number {
  return HEADER + TABLE_HEAD + Math.max(players, 1) * ROW + FOOTER;
}

export function renderMatchCardSvg({ recap: r, clubName, timeZone, clubCrestPng }: MatchCardInput): string {
  const players = r.players;
  const height = cardHeight(players.length);
  const res = r.result ? RESULT[r.result] : null;
  const mvpIndex = (() => {
    const chosen = players.findIndex((p) => p.manOfTheMatch);
    if (chosen >= 0) return chosen;
    let best = -1;
    players.forEach((p, i) => {
      if (p.rating !== null && (best < 0 || p.rating > players[best]!.rating!)) best = i;
    });
    return best;
  })();
  const out: string[] = [];

  // Fondo con las franjas diagonales del logo.
  out.push(
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.bg1}"/>` +
      `<stop offset="1" stop-color="${C.bg2}"/></linearGradient>` +
      `<linearGradient id="hl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.streak}" stop-opacity="0.45"/>` +
      `<stop offset="1" stop-color="${C.streak}" stop-opacity="0.05"/></linearGradient></defs>`,
    `<rect width="${CARD_WIDTH}" height="${height}" fill="url(#bg)"/>`,
  );
  for (const [x, w, o] of [
    [-120, 70, 0.18],
    [-20, 26, 0.12],
    [880, 90, 0.14],
    [1010, 30, 0.1],
  ] as const) {
    out.push(
      `<polygon points="${x},${HEADER} ${x + w},${HEADER} ${x + w + 260},0 ${x + 260},0" fill="${C.streak}" fill-opacity="${o}"/>`,
    );
  }

  // Barra superior: logo de PIRLO y datos del partido.
  out.push(
    `<image href="data:image/png;base64,${LOGO_PNG_BASE64}" x="${PAD}" y="24" width="48" height="48"/>`,
    text('PIRLO BOT', PAD + 62, 58, { size: 22, weight: 'bold', fill: C.silver, tracking: 2 }),
    text(`${TYPE[r.matchType]} · ${formatWhen(r.playedAt, timeZone)}`, CARD_WIDTH - PAD, 58, {
      size: 20,
      weight: 'medium',
      fill: C.muted,
      anchor: 'end',
      tracking: 1,
    }),
  );

  // Marcador.
  const score = r.goalsFor !== null && r.goalsAgainst !== null ? `${r.goalsFor} – ${r.goalsAgainst}` : 'VS';
  out.push(text(score, 600, 200, { size: 96, weight: 'bold', anchor: 'middle', fill: '#ffffff' }));
  if (res) {
    const w = measure(res.label, 20, 'bold') + 2 * 7 + 40;
    out.push(
      `<rect x="${600 - w / 2}" y="226" width="${w}" height="38" rx="19" fill="${res.color}" fill-opacity="0.18" stroke="${res.color}" stroke-width="2"/>`,
      text(res.label, 600, 252, { size: 20, weight: 'bold', anchor: 'middle', fill: res.color, tracking: 2 }),
    );
  }
  const own = clubName.toUpperCase();
  const rival = (r.opponentName ?? 'Rival').toUpperCase();
  out.push(
    crest(396, 150, initials(clubName), true, clubCrestPng),
    crest(804, 150, initials(r.opponentName ?? 'Rival'), false, null, r.opponentColors),
    text(fit(own, 280, 30, 'bold'), 330, 162, { size: 30, weight: 'bold', anchor: 'end', fill: C.silver }),
    text(fit(rival, 280, 30, 'bold'), 870, 162, { size: 30, weight: 'bold', anchor: 'start', fill: C.silver }),
  );

  // Tabla de jugadores propios.
  let y = HEADER;
  out.push(`<rect x="${PAD - 16}" y="${y}" width="${CARD_WIDTH - 2 * (PAD - 16)}" height="${TABLE_HEAD}" rx="10" fill="#0f172a" fill-opacity="0.9"/>`);
  out.push(text('JUGADOR', PAD, y + 30, { size: 16, weight: 'bold', fill: C.muted, tracking: 2 }));
  for (const col of COLUMNS) {
    out.push(text(col.label, col.x, y + 30, { size: 16, weight: 'bold', fill: C.muted, anchor: 'middle', tracking: 1 }));
  }
  out.push(text('MVP', 1140, y + 30, { size: 16, weight: 'bold', fill: C.muted, anchor: 'middle', tracking: 1 }));
  y += TABLE_HEAD;

  if (players.length === 0) {
    out.push(text('Sin datos de jugadores en este partido', 600, y + 36, { size: 20, fill: C.dim, anchor: 'middle' }));
  }
  players.forEach((p, i) => {
    const top = y + i * ROW;
    const mid = top + ROW / 2 + 8;
    if (i === mvpIndex) {
      out.push(`<rect x="${PAD - 16}" y="${top + 4}" width="${CARD_WIDTH - 2 * (PAD - 16)}" height="${ROW - 8}" rx="10" fill="url(#hl)" stroke="${C.accent}" stroke-opacity="0.6" stroke-width="2"/>`);
    } else if (i % 2 === 1) {
      out.push(`<rect x="${PAD - 16}" y="${top + 4}" width="${CARD_WIDTH - 2 * (PAD - 16)}" height="${ROW - 8}" rx="10" fill="#ffffff" fill-opacity="0.03"/>`);
    }
    out.push(text(fit(p.name, 380, 24, 'bold'), PAD, mid, { size: 24, weight: 'bold', fill: '#ffffff' }));
    for (const col of COLUMNS) {
      const value = cell(p, col.key);
      if (col.key === 'rating' && p.rating !== null) {
        out.push(
          `<rect x="${col.x - 34}" y="${top + 12}" width="68" height="32" rx="8" fill="${ratingColor(p.rating)}" fill-opacity="0.22" stroke="${ratingColor(p.rating)}" stroke-width="1.5"/>`,
          text(value, col.x, mid, { size: 22, weight: 'bold', anchor: 'middle', fill: '#ffffff' }),
        );
        continue;
      }
      const strong = (col.key === 'goals' || col.key === 'assists') && value !== '—' && value !== '0';
      out.push(
        text(value, col.x, mid, {
          size: 22,
          weight: strong ? 'bold' : 'medium',
          anchor: 'middle',
          fill: value === '—' ? C.dim : strong ? '#ffffff' : C.silver,
        }),
      );
    }
    if (i === mvpIndex) out.push(star(1140, top + ROW / 2, 15, '#facc15'));
  });

  // Pie.
  const footY = height - FOOTER;
  out.push(
    `<line x1="${PAD}" y1="${footY + 18}" x2="${CARD_WIDTH - PAD}" y2="${footY + 18}" stroke="${C.line}" stroke-width="2"/>`,
    text('Datos de EA SPORTS FC Pro Clubs · importados por el club · — = sin dato', PAD, footY + 54, {
      size: 16,
      fill: C.dim,
    }),
    text('PIRLO BOT', CARD_WIDTH - PAD, footY + 54, { size: 18, weight: 'bold', fill: C.accent, anchor: 'end', tracking: 3 }),
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${height}" viewBox="0 0 ${CARD_WIDTH} ${height}">` +
    `<title>${esc(`${clubName} ${score} ${r.opponentName ?? ''}`)}</title>` +
    out.join('') +
    `</svg>`
  );
}

/** Convierte el SVG a PNG con sharp (se carga solo cuando hace falta). */
export async function svgToPng(svg: string): Promise<Uint8Array> {
  const { default: sharp } = await import('sharp');
  const png = await sharp(Buffer.from(svg), { density: 96 }).png({ compressionLevel: 9 }).toBuffer();
  return new Uint8Array(png);
}
