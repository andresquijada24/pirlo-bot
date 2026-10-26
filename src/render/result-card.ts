import { LOGO_PNG_BASE64 } from './assets/logo.js';
import { initials } from './match-card.js';
import {
  C,
  defensive,
  esc,
  formatDay,
  pct,
  ratingColor,
  show,
  star,
  sumOrNull,
} from './session-card.js';
import { fit, measure, text } from './text.js';

/**
 * Tarjeta de UN PARTIDO, con el mismo diseño propio de PIRLO BOT que la tarjeta de sesión.
 *
 * Marcador con el club siempre a la izquierda (sea local o visitante), resultado, destacados del
 * partido (MVP, goleador, asistente y muro defensivo), tabla por jugador con acierto de pase y de
 * entrada en porcentaje, y el total del equipo. Un dato que la fuente no da se dibuja como «—».
 */

export interface MatchResultPlayer {
  name: string;
  rating: number | null;
  goals: number | null;
  assists: number | null;
  shots: number | null;
  dribbles: number | null;
  passesMade: number | null;
  passesAttempted: number | null;
  tacklesMade: number | null;
  tacklesAttempted: number | null;
  interceptions: number | null;
  blocks: number | null;
  clearances: number | null;
  saves: number | null;
}

export interface MatchResult {
  /** Día del partido (AAAA-MM-DD) o null si no se conoce. */
  playedOn: string | null;
  /** Competición en texto para la tarjeta (p. ej. «LIGA»), o null. */
  competition: string | null;
  /** Jugadores humanos de cada lado, si la fuente lo da. */
  humans: { club: number; rival: number } | null;
  /** El club jugó de local. */
  home: boolean;
  goalsFor: number;
  goalsAgainst: number;
  opponentName: string;
  players: MatchResultPlayer[];
}

export interface ResultCardInput {
  match: MatchResult;
  clubName: string;
  clubCrestPng?: string | null;
  /** Origen de los datos, para el pie. */
  source?: string;
}

export const RESULT_CARD_WIDTH = 1200;
const W = RESULT_CARD_WIDTH;
const PAD = 52;
const HEADER = 352;
const HIGHLIGHTS = 156;
const TABLE_HEAD = 48;
const ROW = 60;
const TOTAL = 64;
const FOOTER = 104;

const COLS = {
  calif: 440,
  g: 512,
  a: 562,
  tir: 622,
  reg: 704,
  pases: 818,
  entr: 954,
  def: 1046,
  par: 1122,
} as const;

export function resultCardHeight(players: number): number {
  return HEADER + HIGHLIGHTS + TABLE_HEAD + Math.max(players, 1) * ROW + TOTAL + FOOTER;
}

export function resultOf(m: Pick<MatchResult, 'goalsFor' | 'goalsAgainst'>) {
  return m.goalsFor > m.goalsAgainst
    ? { label: 'VICTORIA', color: C.win }
    : m.goalsFor < m.goalsAgainst
      ? { label: 'DERROTA', color: C.loss }
      : { label: 'EMPATE', color: C.draw };
}

/** Orden de la tabla: mejor calificación, más goles, nombre. */
export function orderMatchPlayers(players: MatchResultPlayer[]): MatchResultPlayer[] {
  return [...players].sort(
    (a, b) =>
      (b.rating ?? -1) - (a.rating ?? -1) ||
      (b.goals ?? -1) - (a.goals ?? -1) ||
      a.name.localeCompare(b.name, 'es'),
  );
}

function leader(players: MatchResultPlayer[], value: (p: MatchResultPlayer) => number | null) {
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

export function renderResultCardSvg({
  match: m,
  clubName,
  clubCrestPng,
  source,
}: ResultCardInput): string {
  const players = orderMatchPlayers(m.players);
  const height = resultCardHeight(players.length);
  // MVP: la mejor calificación (la tabla ya está ordenada así).
  const mvp = players.length > 0 && players[0]!.rating !== null ? 0 : -1;
  const res = resultOf(m);
  const out: string[] = [];

  // --- Fondo ---------------------------------------------------------------------------------
  out.push(
    '<defs>' +
      `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.bg1}"/>` +
      `<stop offset="0.55" stop-color="${C.bg2}"/><stop offset="1" stop-color="${C.bg3}"/></linearGradient>` +
      `<linearGradient id="neon" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.neon}"/>` +
      `<stop offset="1" stop-color="${C.neon2}"/></linearGradient>` +
      `<linearGradient id="mvp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.gold}" stop-opacity="0.22"/>` +
      `<stop offset="1" stop-color="${C.gold}" stop-opacity="0.02"/></linearGradient>` +
      `<radialGradient id="glow" cx="0.5" cy="0.15" r="0.6"><stop offset="0" stop-color="${res.color}" stop-opacity="0.20"/>` +
      `<stop offset="1" stop-color="${res.color}" stop-opacity="0"/></radialGradient>` +
      `<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.04" stroke-width="1"/></pattern>` +
      '</defs>',
    `<rect width="${W}" height="${height}" fill="url(#bg)"/>`,
    `<rect width="${W}" height="${HEADER}" fill="url(#grid)"/>`,
    `<rect width="${W}" height="${height}" fill="url(#glow)"/>`,
  );
  for (const [x, w, o] of [
    [760, 90, 0.1],
    [880, 26, 0.15],
    [930, 10, 0.22],
  ] as const) {
    out.push(
      `<polygon points="${x},${HEADER} ${x + w},${HEADER} ${x + w + 300},0 ${x + 300},0" fill="${C.neon}" fill-opacity="${o}"/>`,
    );
  }
  out.push(`<rect x="0" y="${HEADER - 3}" width="${W}" height="3" fill="url(#neon)"/>`);

  // --- Barra superior -------------------------------------------------------------------------
  const label = 'RESULTADO DEL PARTIDO';
  const chipW = measure(label, 16, 'bold') + 16 * 2 + 2 * label.length;
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

  // --- Marcador: el club a la izquierda, el rival a la derecha --------------------------------
  const crestS = 112;
  const crestY = 112;
  if (clubCrestPng && /^[A-Za-z0-9+/]+=*$/.test(clubCrestPng)) {
    out.push(
      `<clipPath id="crest"><rect x="${PAD}" y="${crestY}" width="${crestS}" height="${crestS}" rx="24"/></clipPath>`,
      `<image href="data:image/png;base64,${clubCrestPng}" x="${PAD}" y="${crestY}" width="${crestS}" height="${crestS}" clip-path="url(#crest)"/>`,
    );
  } else {
    out.push(
      `<rect x="${PAD}" y="${crestY}" width="${crestS}" height="${crestS}" rx="24" fill="${C.panel}" stroke="${C.neon}" stroke-width="3"/>`,
      text(initials(clubName), PAD + crestS / 2, crestY + crestS / 2 + 14, {
        size: 40,
        weight: 'bold',
        anchor: 'middle',
        fill: C.silver,
      }),
    );
  }
  const rivalX = W - PAD - crestS;
  out.push(
    `<rect x="${rivalX}" y="${crestY}" width="${crestS}" height="${crestS}" rx="24" fill="${C.panel}" stroke="#ffffff" stroke-opacity="0.25" stroke-width="2"/>`,
    text(initials(m.opponentName), rivalX + crestS / 2, crestY + crestS / 2 + 14, {
      size: 40,
      weight: 'bold',
      anchor: 'middle',
      fill: C.muted,
    }),
  );
  const nameW = 250;
  out.push(
    text(fit(clubName.toUpperCase(), nameW, 28, 'bold'), PAD + crestS + 22, 166, {
      size: 28,
      weight: 'bold',
      fill: '#ffffff',
      tracking: 1,
    }),
    text(m.home ? 'LOCAL' : 'VISITANTE', PAD + crestS + 22, 194, {
      size: 13,
      weight: 'bold',
      fill: C.muted,
      tracking: 2,
    }),
    text(fit(m.opponentName.toUpperCase(), nameW, 28, 'bold'), rivalX - 22, 166, {
      size: 28,
      weight: 'bold',
      fill: C.silver,
      anchor: 'end',
      tracking: 1,
    }),
    text(m.home ? 'VISITANTE' : 'LOCAL', rivalX - 22, 194, {
      size: 13,
      weight: 'bold',
      fill: C.muted,
      anchor: 'end',
      tracking: 2,
    }),
  );
  // Goles en grande, con guion fino en el centro.
  const cx = W / 2;
  out.push(
    text(String(m.goalsFor), cx - 64, 206, {
      size: 104,
      weight: 'bold',
      anchor: 'middle',
      fill: '#ffffff',
    }),
    `<rect x="${cx - 16}" y="164" width="32" height="7" rx="3.5" fill="${C.muted}"/>`,
    text(String(m.goalsAgainst), cx + 64, 206, {
      size: 104,
      weight: 'bold',
      anchor: 'middle',
      fill: C.silver,
    }),
  );
  // Resultado.
  const resW = measure(res.label, 16, 'bold') + 2 * res.label.length + 48;
  out.push(
    `<rect x="${cx - resW / 2}" y="232" width="${resW}" height="36" rx="18" fill="${res.color}" fill-opacity="0.16" stroke="${res.color}" stroke-width="1.5"/>`,
    text(res.label, cx, 256, {
      size: 16,
      weight: 'bold',
      anchor: 'middle',
      fill: res.color,
      tracking: 2,
    }),
  );
  // Día, competición y jugadores humanos.
  const details = [
    m.playedOn ? formatDay(m.playedOn) : null,
    m.competition,
    m.humans ? `${m.humans.club} CONTRA ${m.humans.rival} JUGADORES` : null,
  ].filter((x): x is string => x !== null);
  if (details.length)
    out.push(
      text(fit(details.join('  ·  '), W - 2 * PAD, 17, 'medium'), cx, 314, {
        size: 17,
        weight: 'medium',
        anchor: 'middle',
        fill: C.muted,
        tracking: 2,
      }),
    );

  // --- Destacados -----------------------------------------------------------------------------
  const hy = HEADER + 26;
  const gap = 16;
  const tw = (W - 2 * PAD - 3 * gap) / 4;
  const mvpP = mvp >= 0 ? players[mvp]! : null;
  const scorer = leader(players, (p) => p.goals);
  const assister = leader(players, (p) => p.assists);
  const wall = leader(players, defensive);
  const highlights: { title: string; color: string; name: string | null; value: string }[] = [
    {
      title: 'MVP DEL PARTIDO',
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
      value: wall ? `${wall.v} ${wall.v === 1 ? 'ACCIÓN' : 'ACCIONES'}` : '—',
    },
  ];
  highlights.forEach((h, i) => {
    const x = PAD + i * (tw + gap);
    out.push(
      `<rect x="${x}" y="${hy}" width="${tw}" height="${HIGHLIGHTS - 46}" rx="16" fill="${C.panel}" fill-opacity="0.85" stroke="${h.color}" stroke-opacity="0.35" stroke-width="1.5"/>`,
      `<rect x="${x}" y="${hy}" width="${tw}" height="4" rx="2" fill="${h.color}"/>`,
      text(h.title, x + 18, hy + 32, { size: 13, weight: 'bold', fill: h.color, tracking: 2 }),
      text(fit(h.name ?? 'Nadie', tw - 36, 22, 'bold'), x + 18, hy + 64, {
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

  // --- Tabla --------------------------------------------------------------------------------------
  let y = HEADER + HIGHLIGHTS;
  out.push(
    `<rect x="${PAD - 16}" y="${y}" width="${W - 2 * (PAD - 16)}" height="${TABLE_HEAD}" rx="10" fill="${C.panel}"/>`,
    text('JUGADOR', PAD, y + 31, { size: 14, weight: 'bold', fill: C.muted, tracking: 2 }),
  );
  const head: [string, number][] = [
    ['CALIF.', COLS.calif],
    ['G', COLS.g],
    ['A', COLS.a],
    ['TIROS', COLS.tir],
    ['REGATES', COLS.reg],
    ['PASES', COLS.pases],
    ['ENTRADAS', COLS.entr],
    ['DEFENSA', COLS.def],
    ['PARADAS', COLS.par],
  ];
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

  if (players.length === 0)
    out.push(
      text('Sin datos de jugadores en este partido', W / 2, y + 38, {
        size: 20,
        fill: C.dim,
        anchor: 'middle',
      }),
    );
  const bar = (x: number, top: number, value: number | null, color: string) => {
    const bw = 116;
    out.push(
      `<rect x="${x - bw / 2}" y="${top}" width="${bw}" height="5" rx="2.5" fill="#ffffff" fill-opacity="0.08"/>`,
    );
    if (value !== null)
      out.push(
        `<rect x="${x - bw / 2}" y="${top}" width="${((bw * Math.min(value, 100)) / 100).toFixed(1)}" height="5" rx="2.5" fill="${color}"/>`,
      );
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
  const ratioText = (made: number | null, att: number | null) =>
    made === null || att === null ? '' : `${made}/${att}`;

  players.forEach((p, i) => {
    const top = y + i * ROW;
    const mid = top + ROW / 2 + 8;
    if (i === mvp)
      out.push(
        `<rect x="${PAD - 16}" y="${top + 4}" width="${W - 2 * (PAD - 16)}" height="${ROW - 8}" rx="12" fill="url(#mvp)" stroke="${C.gold}" stroke-opacity="0.55" stroke-width="1.5"/>`,
      );
    else if (i % 2 === 1)
      out.push(
        `<rect x="${PAD - 16}" y="${top + 4}" width="${W - 2 * (PAD - 16)}" height="${ROW - 8}" rx="12" fill="#ffffff" fill-opacity="0.03"/>`,
      );
    const name = fit(p.name, i === mvp ? 290 : 320, 23, 'bold');
    out.push(text(name, PAD, mid, { size: 23, weight: 'bold', fill: '#ffffff' }));
    if (i === mvp) out.push(star(PAD + measure(name, 23, 'bold') + 20, mid - 8, 11, C.gold));
    if (p.rating !== null) {
      const col = ratingColor(p.rating);
      out.push(
        `<rect x="${COLS.calif - 36}" y="${top + 13}" width="72" height="34" rx="9" fill="${col}" fill-opacity="0.2" stroke="${col}" stroke-width="1.5"/>`,
        text(p.rating.toFixed(1), COLS.calif, mid, {
          size: 21,
          weight: 'bold',
          anchor: 'middle',
          fill: '#ffffff',
        }),
      );
    } else numCell(null, COLS.calif, mid);
    numCell(p.goals, COLS.g, mid, true);
    numCell(p.assists, COLS.a, mid, true);
    numCell(p.shots, COLS.tir, mid);
    numCell(p.dribbles, COLS.reg, mid);
    const pp = pct(p.passesMade, p.passesAttempted);
    const tp = pct(p.tacklesMade, p.tacklesAttempted);
    for (const [v, x, ratio, color] of [
      [pp, COLS.pases, ratioText(p.passesMade, p.passesAttempted), C.neon],
      [tp, COLS.entr, ratioText(p.tacklesMade, p.tacklesAttempted), C.violet],
    ] as const) {
      out.push(
        text(v === null ? '—' : `${v}%`, ratio ? x - 58 : x, mid - 4, {
          size: 20,
          weight: 'bold',
          anchor: ratio ? 'start' : 'middle',
          fill: v === null ? C.dim : '#ffffff',
        }),
      );
      if (ratio)
        out.push(
          text(ratio, x + 58, mid - 4, {
            size: 13,
            weight: 'medium',
            anchor: 'end',
            fill: C.muted,
          }),
        );
      bar(x, mid + 8, v, color);
    }
    numCell(defensive(p), COLS.def, mid);
    numCell(p.saves, COLS.par, mid);
  });

  // --- Total del equipo ------------------------------------------------------------------------
  const ty = y + Math.max(players.length, 1) * ROW + 6;
  const tmid = ty + TOTAL / 2 + 4;
  const total = (f: (p: MatchResultPlayer) => number | null) => sumOrNull(...players.map(f));
  const rated = players.filter((p) => p.rating !== null);
  const teamRating = rated.length ? rated.reduce((a, p) => a + p.rating!, 0) / rated.length : null;
  out.push(
    `<rect x="${PAD - 16}" y="${ty}" width="${W - 2 * (PAD - 16)}" height="${TOTAL - 8}" rx="12" fill="${C.neon}" fill-opacity="0.08" stroke="${C.neon}" stroke-opacity="0.5" stroke-width="1.5"/>`,
    text('TOTAL DEL EQUIPO', PAD, tmid, { size: 18, weight: 'bold', fill: C.neon, tracking: 2 }),
  );
  const tcell = (v: string, x: number, dim = false) =>
    out.push(
      text(v, x, tmid, {
        size: 21,
        weight: 'bold',
        anchor: 'middle',
        fill: dim ? C.dim : '#ffffff',
      }),
    );
  tcell(teamRating === null ? '—' : teamRating.toFixed(2), COLS.calif, teamRating === null);
  for (const [f, x] of [
    [(p: MatchResultPlayer) => p.goals, COLS.g],
    [(p: MatchResultPlayer) => p.assists, COLS.a],
    [(p: MatchResultPlayer) => p.shots, COLS.tir],
    [(p: MatchResultPlayer) => p.dribbles, COLS.reg],
    [defensive, COLS.def],
    [(p: MatchResultPlayer) => p.saves, COLS.par],
  ] as const) {
    const v = total(f);
    tcell(show(v), x, v === null);
  }
  const tpp = pct(
    total((p) => p.passesMade),
    total((p) => p.passesAttempted),
  );
  const ttp = pct(
    total((p) => p.tacklesMade),
    total((p) => p.tacklesAttempted),
  );
  tcell(tpp === null ? '—' : `${tpp}%`, COLS.pases, tpp === null);
  tcell(ttp === null ? '—' : `${ttp}%`, COLS.entr, ttp === null);

  // --- Pie -------------------------------------------------------------------------------------
  const fy = height - FOOTER;
  out.push(
    `<line x1="${PAD}" y1="${fy + 20}" x2="${W - PAD}" y2="${fy + 20}" stroke="${C.line}" stroke-width="2"/>`,
    text(`Datos del partido${source ? ` vía ${source}` : ''} · — = sin dato`, PAD, fy + 52, {
      size: 14,
      fill: C.dim,
    }),
    text(
      fit(
        'Pases y entradas: acierto (completados / intentados) · Defensa = entradas ganadas, intercepciones, bloqueos y despejes',
        W - 2 * PAD,
        14,
      ),
      PAD,
      fy + 76,
      { size: 14, fill: C.dim },
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
    `<title>${esc(`${clubName} ${m.goalsFor}–${m.goalsAgainst} ${m.opponentName}`)}</title>` +
    out.join('') +
    '</svg>'
  );
}
