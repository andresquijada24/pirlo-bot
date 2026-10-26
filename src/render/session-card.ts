import type { SessionRecap, SessionRecapPlayer } from '../db/repositories/types.js';
import { LOGO_PNG_BASE64 } from './assets/logo.js';
import { initials } from './match-card.js';
import { fit, measure, text } from './text.js';

/**
 * Tarjeta del resumen de una SESIÓN (varios partidos seguidos), con diseño propio de PIRLO BOT.
 *
 * Además de la tabla de jugadores incluye lo que un resumen normal no trae:
 * - balance de la sesión con porcentaje de victorias en anillo;
 * - destacados: MVP, goleador, asistente y muro defensivo;
 * - acierto de pase y de entrada en porcentaje con barra;
 * - calificación comparada con la media de temporada de cada jugador («vs media»);
 * - fila con el total del equipo.
 * Un dato que la fuente no da se dibuja como «—»: nunca se inventa.
 */

export const SESSION_CARD_WIDTH = 1200;
const W = SESSION_CARD_WIDTH;
const PAD = 52;
const HEADER = 352;
const HIGHLIGHTS = 156;
const TABLE_HEAD = 48;
const ROW = 60;
const TOTAL = 64;
const FOOTER = 104;

const C = {
  bg1: '#020617',
  bg2: '#0a1640',
  bg3: '#1e1b4b',
  neon: '#38bdf8',
  neon2: '#818cf8',
  silver: '#e5e7eb',
  muted: '#94a3b8',
  dim: '#64748b',
  line: '#1e293b',
  panel: '#0b1226',
  win: '#22c55e',
  draw: '#eab308',
  loss: '#ef4444',
  gold: '#facc15',
  violet: '#a78bfa',
};

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const show = (v: number | null) => (v === null ? '—' : String(v));
const pct = (made: number | null, att: number | null) =>
  made === null || att === null || att === 0 ? null : Math.round((100 * made) / att);
const sumOrNull = (...xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};

/** Acciones defensivas: entradas ganadas + intercepciones + bloqueos + despejes (lo que haya). */
export const defensive = (p: SessionRecapPlayer) =>
  sumOrNull(p.tacklesMade, p.interceptions, p.blocks, p.clearances);

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

function triangle(cx: number, cy: number, up: boolean, fill: string): string {
  const s = 7;
  return up
    ? `<polygon points="${cx - s},${cy + s * 0.6} ${cx + s},${cy + s * 0.6} ${cx},${cy - s * 0.8}" fill="${fill}"/>`
    : `<polygon points="${cx - s},${cy - s * 0.6} ${cx + s},${cy - s * 0.6} ${cx},${cy + s * 0.8}" fill="${fill}"/>`;
}

/** "2026-10-25" → "SÁB 25 OCT 2026". */
export function formatDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  const parts = new Intl.DateTimeFormat('es', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}`
    .replace(/\./g, '')
    .toUpperCase();
}

/** Jugador más valioso: mejor calificación entre quienes jugaron al menos la mitad de la sesión. */
export function sessionMvp(players: SessionRecapPlayer[]): number {
  const most = Math.max(0, ...players.map((p) => p.matchesPlayed ?? 0));
  let best = -1;
  players.forEach((p, i) => {
    if (p.rating === null || (p.matchesPlayed ?? 0) * 2 < most) return;
    if (best < 0 || p.rating > players[best]!.rating!) best = i;
  });
  return best;
}

/** Líder de una estadística; en caso de empate, todos los empatados (nombres unidos). */
function leader(players: SessionRecapPlayer[], value: (p: SessionRecapPlayer) => number | null) {
  let best: { names: string[]; v: number } | null = null;
  for (const p of players) {
    const v = value(p);
    if (v === null || v <= 0) continue;
    if (!best || v > best.v) best = { names: [p.name], v };
    else if (v === best.v) best.names.push(p.name);
  }
  if (!best) return null;
  const [first, second, ...rest] = best.names;
  const name =
    rest.length > 0
      ? `${first} y ${best.names.length - 1} más`
      : second
        ? `${first} · ${second}`
        : first!;
  return { name, v: best.v };
}

export interface SessionCardInput {
  recap: SessionRecap;
  clubName: string;
  clubCrestPng?: string | null;
  /** Origen de los datos, para el pie (p. ej. "maritimo.app"). */
  source?: string;
}

/** Orden de la tabla: más partidos, mejor calificación, nombre. */
export function orderPlayers(players: SessionRecapPlayer[]): SessionRecapPlayer[] {
  return [...players].sort(
    (a, b) =>
      (b.matchesPlayed ?? -1) - (a.matchesPlayed ?? -1) ||
      (b.rating ?? -1) - (a.rating ?? -1) ||
      a.name.localeCompare(b.name, 'es'),
  );
}

export function sessionCardHeight(players: number): number {
  return HEADER + HIGHLIGHTS + TABLE_HEAD + Math.max(players, 1) * ROW + TOTAL + FOOTER;
}

const COLS = {
  pj: 372,
  calif: 458,
  delta: 528,
  g: 592,
  a: 642,
  tir: 698,
  pases: 800,
  entr: 932,
  def: 1040,
  par: 1116,
} as const;

export function renderSessionCardSvg({
  recap: r,
  clubName,
  clubCrestPng,
  source,
}: SessionCardInput): string {
  const players = orderPlayers(r.players);
  const height = sessionCardHeight(players.length);
  const mvp = sessionMvp(players);
  const out: string[] = [];

  // --- Fondo: degradado profundo, rejilla fina y franjas de neón -------------------------------
  out.push(
    '<defs>' +
      `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.bg1}"/>` +
      `<stop offset="0.55" stop-color="${C.bg2}"/><stop offset="1" stop-color="${C.bg3}"/></linearGradient>` +
      `<linearGradient id="neon" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.neon}"/>` +
      `<stop offset="1" stop-color="${C.neon2}"/></linearGradient>` +
      `<linearGradient id="mvp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.gold}" stop-opacity="0.22"/>` +
      `<stop offset="1" stop-color="${C.gold}" stop-opacity="0.02"/></linearGradient>` +
      `<radialGradient id="glow" cx="0.85" cy="0.1" r="0.6"><stop offset="0" stop-color="${C.neon}" stop-opacity="0.22"/>` +
      `<stop offset="1" stop-color="${C.neon}" stop-opacity="0"/></radialGradient>` +
      `<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.04" stroke-width="1"/></pattern>` +
      '</defs>',
    `<rect width="${W}" height="${height}" fill="url(#bg)"/>`,
    `<rect width="${W}" height="${HEADER}" fill="url(#grid)"/>`,
    `<rect width="${W}" height="${height}" fill="url(#glow)"/>`,
  );
  for (const [x, w, o] of [
    [760, 90, 0.12],
    [880, 26, 0.18],
    [930, 10, 0.25],
  ] as const) {
    out.push(
      `<polygon points="${x},${HEADER} ${x + w},${HEADER} ${x + w + 300},0 ${x + 300},0" fill="${C.neon}" fill-opacity="${o}"/>`,
    );
  }
  // Línea de neón bajo la cabecera.
  out.push(`<rect x="0" y="${HEADER - 3}" width="${W}" height="3" fill="url(#neon)"/>`);

  // --- Barra superior -------------------------------------------------------------------------
  const label = 'RESUMEN DE SESIÓN';
  const chipW = measure(label, 16, 'bold') + 16 * 2 + 2 * 17;
  out.push(
    `<image href="data:image/png;base64,${LOGO_PNG_BASE64}" x="${PAD}" y="24" width="46" height="46"/>`,
    text('PIRLO BOT', PAD + 58, 56, { size: 21, weight: 'bold', fill: C.silver, tracking: 3 }),
    `<rect x="${W - PAD - chipW}" y="28" width="${chipW}" height="36" rx="18" fill="${C.neon}" fill-opacity="0.12" stroke="${C.neon}" stroke-width="1.5"/>`,
    text(label, W - PAD - chipW / 2, 52, {
      size: 16,
      weight: 'bold',
      fill: C.neon,
      anchor: 'middle',
      tracking: 2,
    }),
  );

  // --- Club, fecha y balance ------------------------------------------------------------------
  const crestX = PAD;
  const crestY = 104;
  const crestS = 132;
  if (clubCrestPng && /^[A-Za-z0-9+/]+=*$/.test(clubCrestPng)) {
    out.push(
      `<clipPath id="crest"><rect x="${crestX}" y="${crestY}" width="${crestS}" height="${crestS}" rx="26"/></clipPath>`,
      `<image href="data:image/png;base64,${clubCrestPng}" x="${crestX}" y="${crestY}" width="${crestS}" height="${crestS}" clip-path="url(#crest)"/>`,
    );
  } else {
    out.push(
      `<rect x="${crestX}" y="${crestY}" width="${crestS}" height="${crestS}" rx="26" fill="${C.panel}" stroke="${C.neon}" stroke-width="3"/>`,
      text(initials(clubName), crestX + crestS / 2, crestY + crestS / 2 + 16, {
        size: 46,
        weight: 'bold',
        anchor: 'middle',
        fill: C.silver,
      }),
    );
  }
  const infoX = crestX + crestS + 30;
  const matches = r.matchesPlayed;
  out.push(
    text(fit(clubName.toUpperCase(), 600, 44, 'bold'), infoX, 152, {
      size: 44,
      weight: 'bold',
      fill: '#ffffff',
      tracking: 1,
    }),
    text(
      `${formatDay(r.playedOn)}${matches !== null ? ` · ${matches} ${matches === 1 ? 'PARTIDO' : 'PARTIDOS'}` : ''}`,
      infoX,
      190,
      { size: 19, weight: 'medium', fill: C.muted, tracking: 2 },
    ),
  );
  // Balance V / E / D.
  const teamTotal = (f: (p: SessionRecapPlayer) => number | null) => sumOrNull(...r.players.map(f));
  const tiles: [string, number | null, string][] = [
    ['VICTORIAS', r.wins, C.win],
    ['EMPATES', r.draws, C.draw],
    ['DERROTAS', r.losses, C.loss],
    ['GOLES', teamTotal((p) => p.goals), C.neon],
    ['ASISTENCIAS', teamTotal((p) => p.assists), C.violet],
  ];
  // Porterías a cero solo si la fuente informa los goles recibidos (si no, no se inventan).
  if (r.cleanSheets !== undefined && r.cleanSheets !== null)
    tiles.push(['PORTERÍAS A CERO', r.cleanSheets, C.gold]);
  const tileGap = 12;
  const tileW = Math.min(136, (W - PAD - 92 - 74 - 30 - infoX + tileGap) / tiles.length - tileGap);
  tiles.forEach(([name, v, color], i) => {
    const x = infoX + i * (tileW + tileGap);
    const y = 222;
    out.push(
      `<rect x="${x}" y="${y}" width="${tileW}" height="96" rx="16" fill="${color}" fill-opacity="0.10" stroke="${color}" stroke-opacity="0.55" stroke-width="1.5"/>`,
      `<rect x="${x}" y="${y + 14}" width="4" height="68" rx="2" fill="${color}"/>`,
      text(show(v), x + tileW / 2, y + 56, {
        size: 40,
        weight: 'bold',
        anchor: 'middle',
        fill: '#ffffff',
      }),
      text(fit(name, tileW - 12, 12, 'bold'), x + tileW / 2, y + 82, {
        size: 12,
        weight: 'bold',
        anchor: 'middle',
        fill: color,
        tracking: 2,
      }),
    );
  });
  // Anillo con el porcentaje de victorias.
  const cx = W - PAD - 92;
  const cy = 226;
  const rad = 74;
  const winPct = r.wins !== null && matches ? Math.round((100 * r.wins) / matches) : null;
  const circ = 2 * Math.PI * rad;
  out.push(
    `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="14"/>`,
  );
  if (winPct !== null) {
    out.push(
      `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="url(#neon)" stroke-width="14" stroke-linecap="round" ` +
        `stroke-dasharray="${((circ * winPct) / 100).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`,
    );
  }
  out.push(
    text(winPct === null ? '—' : `${winPct}%`, cx, cy + 12, {
      size: 38,
      weight: 'bold',
      anchor: 'middle',
      fill: '#ffffff',
    }),
    text('DE VICTORIAS', cx, cy + 40, {
      size: 12,
      weight: 'bold',
      anchor: 'middle',
      fill: C.muted,
      tracking: 2,
    }),
  );

  // --- Destacados ---------------------------------------------------------------------------
  const hy = HEADER + 26;
  const gap = 16;
  const tw = (W - 2 * PAD - 3 * gap) / 4;
  const mvpP = mvp >= 0 ? players[mvp]! : null;
  const scorer = leader(players, (p) => p.goals);
  const assister = leader(players, (p) => p.assists);
  const wall = leader(players, defensive);
  const highlights: { title: string; color: string; name: string | null; value: string }[] = [
    {
      title: 'MVP DE LA SESIÓN',
      color: C.gold,
      name: mvpP?.name ?? null,
      value: mvpP?.rating != null ? mvpP.rating.toFixed(1) : '—',
    },
    {
      title: 'GOLEADOR',
      color: C.neon,
      name: scorer?.name ?? null,
      value: scorer ? `${scorer.v} ${scorer.v === 1 ? 'GOL' : 'GOLES'}` : '—',
    },
    {
      title: 'ASISTENTE',
      color: C.violet,
      name: assister?.name ?? null,
      value: assister ? `${assister.v} ${assister.v === 1 ? 'ASISTENCIA' : 'ASISTENCIAS'}` : '—',
    },
    {
      title: 'MURO DEFENSIVO',
      color: C.win,
      name: wall?.name ?? null,
      value: wall ? `${wall.v} ACCIONES` : '—',
    },
  ];
  highlights.forEach((h, i) => {
    const x = PAD + i * (tw + gap);
    out.push(
      `<rect x="${x}" y="${hy}" width="${tw}" height="${HIGHLIGHTS - 46}" rx="16" fill="${C.panel}" fill-opacity="0.85" stroke="${h.color}" stroke-opacity="0.35" stroke-width="1.5"/>`,
      `<rect x="${x}" y="${hy}" width="${tw}" height="4" rx="2" fill="${h.color}"/>`,
      text(h.title, x + 18, hy + 32, { size: 13, weight: 'bold', fill: h.color, tracking: 2 }),
      text(fit(h.name ?? 'Sin datos', tw - 36, 22, 'bold'), x + 18, hy + 64, {
        size: 22,
        weight: 'bold',
        fill: h.name ? '#ffffff' : C.dim,
      }),
      text(h.value, x + 18, hy + 94, {
        size: 18,
        weight: 'bold',
        fill: h.value === '—' ? C.dim : C.silver,
        tracking: 1,
      }),
    );
    if (i === 0 && h.name) out.push(star(x + tw - 28, hy + 28, 12, C.gold));
  });

  // --- Tabla ------------------------------------------------------------------------------------
  let y = HEADER + HIGHLIGHTS;
  out.push(
    `<rect x="${PAD - 16}" y="${y}" width="${W - 2 * (PAD - 16)}" height="${TABLE_HEAD}" rx="10" fill="${C.panel}"/>`,
  );
  const head: [string, number][] = [
    ['PJ', COLS.pj],
    ['CALIF.', COLS.calif],
    ['VS MEDIA', COLS.delta],
    ['G', COLS.g],
    ['A', COLS.a],
    ['TIROS', COLS.tir],
    ['PASES', COLS.pases],
    ['ENTRADAS', COLS.entr],
    ['DEFENSA', COLS.def],
    ['PARADAS', COLS.par],
  ];
  out.push(text('JUGADOR', PAD, y + 31, { size: 14, weight: 'bold', fill: C.muted, tracking: 2 }));
  for (const [t, x] of head)
    out.push(
      text(t, x, y + 31, {
        size: 13,
        weight: 'bold',
        fill: C.muted,
        anchor: 'middle',
        tracking: 1,
      }),
    );
  y += TABLE_HEAD;

  if (players.length === 0) {
    out.push(
      text('Sin datos de jugadores en esta sesión', W / 2, y + 38, {
        size: 20,
        fill: C.dim,
        anchor: 'middle',
      }),
    );
  }
  const bar = (x: number, top: number, value: number | null, color: string) => {
    const bw = 84;
    out.push(
      `<rect x="${x - bw / 2}" y="${top}" width="${bw}" height="5" rx="2.5" fill="#ffffff" fill-opacity="0.08"/>`,
    );
    if (value !== null) {
      out.push(
        `<rect x="${x - bw / 2}" y="${top}" width="${((bw * Math.min(value, 100)) / 100).toFixed(1)}" height="5" rx="2.5" fill="${color}"/>`,
      );
    }
  };
  const numCell = (v: number | null, x: number, mid: number, strong = false) =>
    out.push(
      text(show(v), x, mid, {
        size: 21,
        weight: strong && v ? 'bold' : 'medium',
        anchor: 'middle',
        fill: v === null ? C.dim : strong && v ? '#ffffff' : C.silver,
      }),
    );

  players.forEach((p, i) => {
    const top = y + i * ROW;
    const mid = top + ROW / 2 + 8;
    if (i === mvp) {
      out.push(
        `<rect x="${PAD - 16}" y="${top + 4}" width="${W - 2 * (PAD - 16)}" height="${ROW - 8}" rx="12" fill="url(#mvp)" stroke="${C.gold}" stroke-opacity="0.55" stroke-width="1.5"/>`,
      );
    } else if (i % 2 === 1) {
      out.push(
        `<rect x="${PAD - 16}" y="${top + 4}" width="${W - 2 * (PAD - 16)}" height="${ROW - 8}" rx="12" fill="#ffffff" fill-opacity="0.03"/>`,
      );
    }
    const nameW = i === mvp ? 250 : 280;
    const name = fit(p.name, nameW, 23, 'bold');
    out.push(text(name, PAD, mid, { size: 23, weight: 'bold', fill: '#ffffff' }));
    if (i === mvp) out.push(star(PAD + measure(name, 23, 'bold') + 20, mid - 8, 11, C.gold));
    numCell(p.matchesPlayed, COLS.pj, mid);
    if (p.rating !== null) {
      const col = ratingColor(p.rating);
      out.push(
        `<rect x="${COLS.calif - 34}" y="${top + 13}" width="68" height="34" rx="9" fill="${col}" fill-opacity="0.2" stroke="${col}" stroke-width="1.5"/>`,
        text(p.rating.toFixed(1), COLS.calif, mid, {
          size: 21,
          weight: 'bold',
          anchor: 'middle',
          fill: '#ffffff',
        }),
      );
    } else {
      numCell(null, COLS.calif, mid);
    }
    const delta = p.rating !== null && p.seasonRating !== null ? p.rating - p.seasonRating : null;
    if (delta !== null && Math.abs(delta) >= 0.05) {
      const up = delta > 0;
      const col = up ? C.win : C.loss;
      out.push(
        triangle(COLS.delta - 22, mid - 7, up, col),
        text(`${up ? '+' : '-'}${Math.abs(delta).toFixed(1)}`, COLS.delta + 8, mid, {
          size: 17,
          weight: 'bold',
          anchor: 'middle',
          fill: col,
        }),
      );
    } else {
      out.push(
        text(delta === null ? '—' : '=', COLS.delta, mid, {
          size: 17,
          weight: 'bold',
          anchor: 'middle',
          fill: C.dim,
        }),
      );
    }
    numCell(p.goals, COLS.g, mid, true);
    numCell(p.assists, COLS.a, mid, true);
    numCell(p.shots, COLS.tir, mid);
    const pp = pct(p.passesMade, p.passesAttempted);
    const tp = pct(p.tacklesMade, p.tacklesAttempted);
    out.push(
      text(pp === null ? '—' : `${pp}%`, COLS.pases, mid - 4, {
        size: 20,
        weight: 'bold',
        anchor: 'middle',
        fill: pp === null ? C.dim : '#ffffff',
      }),
      text(tp === null ? '—' : `${tp}%`, COLS.entr, mid - 4, {
        size: 20,
        weight: 'bold',
        anchor: 'middle',
        fill: tp === null ? C.dim : '#ffffff',
      }),
    );
    bar(COLS.pases, mid + 8, pp, C.neon);
    bar(COLS.entr, mid + 8, tp, C.violet);
    numCell(defensive(p), COLS.def, mid);
    numCell(p.saves, COLS.par, mid);
  });

  // --- Total del equipo -------------------------------------------------------------------------
  const ty = y + Math.max(players.length, 1) * ROW + 6;
  const tmid = ty + TOTAL / 2 + 4;
  const total = (f: (p: SessionRecapPlayer) => number | null) => sumOrNull(...players.map(f));
  const rated = players.filter((p) => p.rating !== null && p.matchesPlayed);
  const teamRating = rated.length
    ? rated.reduce((a, p) => a + p.rating! * p.matchesPlayed!, 0) /
      rated.reduce((a, p) => a + p.matchesPlayed!, 0)
    : null;
  const tpp = pct(
    total((p) => p.passesMade),
    total((p) => p.passesAttempted),
  );
  const ttp = pct(
    total((p) => p.tacklesMade),
    total((p) => p.tacklesAttempted),
  );
  out.push(
    `<rect x="${PAD - 16}" y="${ty}" width="${W - 2 * (PAD - 16)}" height="${TOTAL - 8}" rx="12" fill="${C.neon}" fill-opacity="0.08" stroke="${C.neon}" stroke-opacity="0.5" stroke-width="1.5"/>`,
    text('TOTAL DEL EQUIPO', PAD, tmid, { size: 18, weight: 'bold', fill: C.neon, tracking: 2 }),
    text(teamRating === null ? '—' : teamRating.toFixed(2), COLS.calif, tmid, {
      size: 21,
      weight: 'bold',
      anchor: 'middle',
      fill: '#ffffff',
    }),
  );
  const tcell = (v: number | null, x: number) =>
    out.push(
      text(show(v), x, tmid, {
        size: 21,
        weight: 'bold',
        anchor: 'middle',
        fill: v === null ? C.dim : '#ffffff',
      }),
    );
  tcell(
    total((p) => p.goals),
    COLS.g,
  );
  tcell(
    total((p) => p.assists),
    COLS.a,
  );
  tcell(
    total((p) => p.shots),
    COLS.tir,
  );
  out.push(
    text(tpp === null ? '—' : `${tpp}%`, COLS.pases, tmid, {
      size: 21,
      weight: 'bold',
      anchor: 'middle',
      fill: tpp === null ? C.dim : '#ffffff',
    }),
    text(ttp === null ? '—' : `${ttp}%`, COLS.entr, tmid, {
      size: 21,
      weight: 'bold',
      anchor: 'middle',
      fill: ttp === null ? C.dim : '#ffffff',
    }),
  );
  tcell(total(defensive), COLS.def);
  tcell(
    total((p) => p.saves),
    COLS.par,
  );

  // --- Pie ---------------------------------------------------------------------------------------
  const fy = height - FOOTER;
  out.push(
    `<line x1="${PAD}" y1="${fy + 20}" x2="${W - PAD}" y2="${fy + 20}" stroke="${C.line}" stroke-width="2"/>`,
    text(`Datos de la sesión${source ? ` vía ${source}` : ''} · — = sin dato`, PAD, fy + 52, {
      size: 14,
      fill: C.dim,
    }),
    text(
      fit(
        'Vs media = frente a su media de la temporada · Defensa = entradas ganadas, intercepciones, bloqueos y despejes',
        W - 2 * PAD,
        14,
      ),
      PAD,
      fy + 76,
      {
        size: 14,
        fill: C.dim,
      },
    ),
    text('PIRLO BOT', W - PAD, fy + 52, {
      size: 18,
      weight: 'bold',
      fill: C.neon,
      anchor: 'end',
      tracking: 3,
    }),
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">` +
    `<title>${esc(`${clubName} · sesión ${r.playedOn}`)}</title>` +
    out.join('') +
    '</svg>'
  );
}
