import { aggregate, rank, type PlayerTotals, type RankingEntry } from '../core/stats/service.js';
import type { Club, Season } from '../core/types.js';
import type { EaMatchSummary, Repositories } from '../db/repositories/types.js';
import { initials } from '../render/match-card.js';

/**
 * Página web pública de un club (/club/<identificador>). Solo existe si un admin la activó.
 * Muestra lo que el propio club ya ve en Discord: resultados, líderes y estadísticas de su
 * plantilla. Los rivales solo aparecen por nombre, colores y marcador (nunca sus gamertags).
 * HTML generado en el servidor, sin JavaScript ni recursos externos.
 */

export interface ClubPageData {
  club: Club;
  hasCrest: boolean;
  season: Season | null;
  record: { played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number };
  matches: EaMatchSummary[];
  players: PlayerTotals[];
  leaders: { label: string; entries: RankingEntry[]; format?: (n: number) => string }[];
}

/** Fecha local (AAAA-MM-DD) de un instante en la zona del club. */
function localDay(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(iso),
    );
  } catch {
    return iso.slice(0, 10);
  }
}

function inSeason(m: EaMatchSummary, season: Season | null, timeZone: string): boolean {
  if (!season?.startsOn) return true;
  const day = localDay(m.playedAt, timeZone);
  return day >= season.startsOn && (season.endsOn === null || day <= season.endsOn);
}

export async function loadClubPage(
  repos: Pick<Repositories, 'clubs' | 'seasons' | 'ea' | 'stats' | 'memberships'>,
  slug: string,
): Promise<ClubPageData | null> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const club = await repos.clubs.findPublic(slug);
  if (!club) return null;

  const [seasons, allMatches, crest, roster] = await Promise.all([
    repos.seasons.list(club.id),
    repos.ea.recent(club.id, 200),
    repos.clubs.crest(club.id),
    repos.memberships.listActive(club.id),
  ]);
  const season = seasons.find((s) => s.isCurrent) ?? null;
  const matches = allMatches.filter((m) => inSeason(m, season, club.timezone));

  const record = { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
  for (const m of matches) {
    if (!m.result) continue;
    record.played++;
    if (m.result === 'victoria') record.wins++;
    else if (m.result === 'empate') record.draws++;
    else record.losses++;
    record.goalsFor += m.goalsFor ?? 0;
    record.goalsAgainst += m.goalsAgainst ?? 0;
  }

  const names = new Map(roster.map((m) => [m.playerId, m.displayName]));
  const rows = await repos.stats.sessionRows(club.id, season?.id ?? null);
  const players = aggregate(rows, names)
    .filter((t) => (t.matchesPlayed ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.goals ?? -1) - (a.goals ?? -1) ||
        (b.assists ?? -1) - (a.assists ?? -1) ||
        a.name.localeCompare(b.name, 'es'),
    );

  return {
    club,
    hasCrest: crest !== null,
    season,
    record,
    matches: matches.slice(0, 10),
    players,
    leaders: [
      { label: 'Goles', entries: rank(players, 'goles', 3) },
      { label: 'Asistencias', entries: rank(players, 'asistencias', 3) },
      { label: 'Nota media', entries: rank(players, 'nota', 3), format: (n) => n.toFixed(2) },
    ],
  };
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const HEX = /^#[0-9a-f]{6}$/;

const RESULT = {
  victoria: { label: 'V', cls: 'w' },
  empate: { label: 'E', cls: 'd' },
  derrota: { label: 'D', cls: 'l' },
} as const;
const TYPE = { leagueMatch: 'Liga', playoffMatch: 'Playoff', friendlyMatch: 'Amistoso' } as const;

function when(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('es', {
      timeZone,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(new Date(iso))
      .replace(/\./g, '');
  } catch {
    return iso.slice(0, 10);
  }
}

/** Blanco o casi negro, según lo que se lea mejor sobre el color de fondo. */
function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#0b1020' : '#ffffff';
}

function rivalBadge(m: EaMatchSummary): string {
  const c = m.opponentColors;
  const ok = c && HEX.test(c.primary) && HEX.test(c.secondary);
  const style = ok
    ? ` style="background:${c.primary};border-color:${c.secondary};color:${readableOn(c.primary)}"`
    : '';
  return `<span class="badge"${style}>${esc(initials(m.opponentName ?? 'Rival'))}</span>`;
}

const CSS = `
:root{--bg:#020617;--bg2:#0b1a4a;--card:#0f172acc;--line:#1e293b;--text:#f8fafc;--muted:#94a3b8;--accent:#38bdf8;--blue:#2563eb;--w:#22c55e;--d:#eab308;--l:#ef4444}
*{box-sizing:border-box}html{color-scheme:dark;min-height:100%;background:linear-gradient(160deg,var(--bg),var(--bg2)) var(--bg)}
body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--text)}
a{color:var(--accent)}
.wrap{max-width:1040px;margin:0 auto;padding:24px 16px 48px}
header.hero{display:flex;align-items:center;gap:20px;padding:24px;border-radius:20px;background:linear-gradient(120deg,#1d4ed833,#0f172acc 60%);border:1px solid var(--line)}
.crest{width:104px;height:104px;flex:none;border-radius:22px;display:grid;place-items:center;font-weight:800;font-size:34px;background:#0f172a;border:3px solid var(--accent)}
.crest img{width:104px;height:104px;object-fit:contain}
h1{margin:0;font-size:clamp(26px,5vw,40px);letter-spacing:.5px}
.sub{color:var(--muted);margin-top:4px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.chip{padding:6px 12px;border-radius:999px;background:#ffffff0d;border:1px solid var(--line);font-weight:600;font-size:14px}
.chip.w{color:var(--w)}.chip.d{color:var(--d)}.chip.l{color:var(--l)}
h2{font-size:15px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin:32px 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.match{display:grid;grid-template-columns:44px 1fr auto;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--line)}
.match:first-child{border-top:0}
.res{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-weight:800}
.res.w{background:#22c55e26;color:var(--w)}.res.d{background:#eab30826;color:var(--d)}.res.l{background:#ef444426;color:var(--l)}
.vs{display:flex;align-items:center;gap:10px;min-width:0}
.vs .name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.badge{flex:none;width:30px;height:30px;border-radius:8px;display:grid;place-items:center;font-size:11px;font-weight:800;background:#1e293b;border:2px solid #475569;color:#fff}
.meta{color:var(--muted);font-size:13px}
.score{font-weight:800;font-size:20px;text-align:right;white-space:nowrap}
.leaders{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.leaders .card{padding:16px}
.leaders h3{margin:0 0 10px;font-size:14px;color:var(--muted)}
.leaders ol{margin:0;padding:0;list-style:none}
.leaders li{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid var(--line)}
.leaders li:first-child{border-top:0}
.leaders b{color:var(--accent)}
.table{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px;min-width:560px}
th,td{padding:10px 12px;text-align:center;border-top:1px solid var(--line)}
th{color:var(--muted);font-size:12px;letter-spacing:1px;text-transform:uppercase;border-top:0;background:#0b1225}
td:first-child,th:first-child{text-align:left}
td.nd{color:#64748b}
.empty{padding:20px;color:var(--muted);text-align:center}
footer{margin-top:40px;color:var(--muted);font-size:13px;text-align:center}
footer img{width:22px;height:22px;vertical-align:middle;border-radius:6px;margin-right:6px}
@media (max-width:560px){header.hero{flex-direction:column;text-align:center}.chips{justify-content:center}.crest,.crest img{width:88px;height:88px}}
`;

export function renderClubPage(d: ClubPageData): string {
  const { club, record: r } = d;
  const base = `/club/${encodeURIComponent(club.slug)}`;
  const crest = d.hasCrest
    ? `<div class="crest" style="border:0;background:none"><img src="${base}/escudo.png" alt="Escudo de ${esc(club.name)}"></div>`
    : `<div class="crest">${esc(initials(club.name))}</div>`;

  const matches = d.matches.length
    ? d.matches
        .map((m) => {
          const res = m.result ? RESULT[m.result] : null;
          const score = m.goalsFor !== null && m.goalsAgainst !== null ? `${m.goalsFor} – ${m.goalsAgainst}` : '—';
          return (
            `<div class="match"><span class="res ${res?.cls ?? ''}">${res?.label ?? '·'}</span>` +
            `<div><div class="vs">${rivalBadge(m)}<span class="name">${esc(m.opponentName ?? 'Rival')}</span></div>` +
            `<div class="meta">${TYPE[m.matchType]} · ${esc(when(m.playedAt, club.timezone))}</div></div>` +
            `<span class="score">${score}</span></div>`
          );
        })
        .join('')
    : '<div class="empty">Todavía no hay partidos.</div>';

  const leaders = d.leaders
    .map(
      (l) =>
        `<div class="card"><h3>${esc(l.label)}</h3>` +
        (l.entries.length
          ? `<ol>${l.entries
              .map(
                (e) =>
                  `<li><span>${e.position}. ${esc(e.totals.name)}</span><b>${esc(l.format ? l.format(e.value) : String(e.value))}</b></li>`,
              )
              .join('')}</ol>`
          : '<div class="meta">Sin datos suficientes.</div>') +
        `</div>`,
    )
    .join('');

  const cell = (v: number | null, digits?: number) =>
    v === null ? '<td class="nd">—</td>' : `<td>${digits !== undefined ? v.toFixed(digits) : v}</td>`;
  const players = d.players.length
    ? `<div class="card table"><table><thead><tr><th>Jugador</th><th>PJ</th><th>G</th><th>A</th><th>Tiros</th><th>Pases</th><th>Entradas</th><th>Nota</th></tr></thead><tbody>${d.players
        .map(
          (p) =>
            `<tr><td>${esc(p.name)}</td>${cell(p.matchesPlayed)}${cell(p.goals)}${cell(p.assists)}${cell(p.shots)}` +
            `${p.passPct === null ? '<td class="nd">—</td>' : `<td>${p.passPct.toFixed(0)}%</td>`}` +
            `${cell(p.tacklesMade)}${cell(p.avgRating, 2)}</tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<div class="card empty">Todavía no hay estadísticas de jugadores.</div>';

  const title = `${club.name} · PIRLO BOT`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(`Resultados y estadísticas de ${club.name} en EA SPORTS FC Pro Clubs.`)}">
<meta property="og:title" content="${esc(title)}"><meta name="theme-color" content="#020617">
<link rel="icon" href="/favicon.png"><style>${CSS}</style></head>
<body><main class="wrap">
<header class="hero">${crest}<div><h1>${esc(club.name)}</h1>
<div class="sub">${esc(d.season?.name ?? 'Historial')} · EA SPORTS FC Pro Clubs</div>
<div class="chips"><span class="chip">${r.played} PJ</span><span class="chip w">${r.wins} V</span><span class="chip d">${r.draws} E</span><span class="chip l">${r.losses} D</span><span class="chip">${r.goalsFor}:${r.goalsAgainst} goles</span></div></div></header>
<h2>Últimos partidos</h2><div class="card">${matches}</div>
<h2>Líderes</h2><div class="leaders">${leaders}</div>
<h2>Plantilla</h2>${players}
<footer><img src="/logo.png" alt="">Página de ${esc(club.name)} en <a href="/">PIRLO BOT</a> · datos de EA SPORTS FC Pro Clubs importados por el club · — = sin dato</footer>
</main></body></html>`;
}

export function notFoundPage(): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Club no encontrado · PIRLO BOT</title><style>${CSS}</style></head><body><main class="wrap" style="text-align:center;padding-top:80px"><h1>Club no encontrado</h1><p class="sub">Esta página no existe o el club no la ha publicado.</p><p><a href="/">Volver a PIRLO BOT</a></p></main></body></html>`;
}
