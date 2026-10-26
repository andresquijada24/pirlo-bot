import { aggregate, rank, type PlayerTotals, type RankingEntry } from '../core/stats/service.js';
import type { Club, Season } from '../core/types.js';
import type { EaMatchSummary, Repositories } from '../db/repositories/types.js';
import { initials } from '../render/match-card.js';
import { currentVersion, updateTags } from './version.js';

/**
 * Página web pública de un club (/club/<identificador>). Solo existe si un admin la activó.
 * Muestra lo que el propio club ya ve en Discord: resultados, líderes y estadísticas de su
 * plantilla. Los rivales solo aparecen por nombre, colores y marcador (nunca sus gamertags).
 * HTML generado en el servidor, sin JavaScript ni recursos externos.
 */

export interface ClubPageData {
  club: Club;
  hasCrest: boolean;
  /** Sitio oficial del club (https) o null. */
  website: string | null;
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

  const [seasons, allMatches, crest, roster, website] = await Promise.all([
    repos.seasons.list(club.id),
    repos.ea.recent(club.id, 200),
    repos.clubs.crest(club.id),
    repos.memberships.listActive(club.id),
    repos.clubs.website(club.id).catch(() => null),
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
    website: website && /^https:\/\//.test(website) ? website : null,
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
.nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.navbtn{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:12px;background:var(--card);border:1px solid var(--line);color:var(--text);text-decoration:none;font-weight:600;font-size:15px}
.navbtn:hover,.navbtn:focus-visible{border-color:var(--accent);color:var(--accent)}
.navbtn.home{padding:9px 11px}
.site{display:inline-block;margin-top:12px;font-weight:600;text-decoration:none}
.site:hover{text-decoration:underline}
@media (max-width:560px){header.hero{flex-direction:column;text-align:center}.chips{justify-content:center}.crest,.crest img{width:88px;height:88px}}
`;

const HOME_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 3.2 2.5 11.1a1 1 0 0 0 1.3 1.5l.7-.6V20a1 1 0 0 0 1 1h4.5v-5.5h4V21h4.5a1 1 0 0 0 1-1v-8l.7.6a1 1 0 1 0 1.3-1.5L12 3.2Z"/></svg>';

/** Barra superior: "Volver" al nivel anterior y la casita para el menú principal (sin JavaScript). */
function navBar(back: { href: string; label: string }): string {
  return (
    `<nav class="nav"><a class="navbtn" href="${back.href}"><span aria-hidden="true">←</span> ${esc(back.label)}</a>` +
    `<a class="navbtn home" href="/" aria-label="Menú principal de PIRLO BOT" title="Menú principal">${HOME_ICON}</a></nav>`
  );
}

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
<link rel="icon" href="/favicon.png"><style>${CSS}</style>${updateTags(currentVersion()).meta}</head>
<body><main class="wrap">
${navBar({ href: '/clubes', label: 'Volver a clubes' })}
<header class="hero">${crest}<div><h1>${esc(club.name)}</h1>
<div class="sub">${esc(d.season?.name ?? 'Historial')} · EA SPORTS FC Pro Clubs</div>
<div class="chips"><span class="chip">${r.played} PJ</span><span class="chip w">${r.wins} V</span><span class="chip d">${r.draws} E</span><span class="chip l">${r.losses} D</span><span class="chip">${r.goalsFor}:${r.goalsAgainst} goles</span></div>${
    d.website
      ? `<a class="site" href="${esc(d.website)}" rel="noopener noreferrer nofollow" target="_blank">🔗 ${esc(d.website.replace(/^https:\/\//, '').replace(/\/$/, ''))} ↗</a>`
      : ''
  }</div></header>
<h2>Últimos partidos</h2><div class="card">${matches}</div>
<h2>Líderes</h2><div class="leaders">${leaders}</div>
<h2>Plantilla</h2>${players}
<footer><img src="/logo.png" alt="">Página de ${esc(club.name)} en <a href="/">PIRLO BOT</a> · datos de EA SPORTS FC Pro Clubs importados por el club · — = sin dato</footer>
</main>${updateTags(currentVersion()).script}</body></html>`;
}

/** Directorio de clubes con la página publicada. */
export function renderClubsDirectory(clubs: { slug: string; name: string; hasCrest: boolean }[]): string {
  const items = clubs.length
    ? clubs
        .map((c) => {
          const href = `/club/${encodeURIComponent(c.slug)}`;
          const crest = c.hasCrest
            ? `<img src="${href}/escudo.png" alt="" width="56" height="56">`
            : `<span>${esc(initials(c.name))}</span>`;
          return `<a class="club" href="${href}"><span class="mini">${crest}</span><span class="cname">${esc(c.name)}</span><span class="go">›</span></a>`;
        })
        .join('')
    : '<div class="empty">Todavía ningún club ha publicado su página. Un admin puede hacerlo con <code>/club web</code>.</div>';
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Clubes · PIRLO BOT</title>
<meta name="description" content="Clubes de EA SPORTS FC Pro Clubs con su página en PIRLO BOT.">
<meta name="theme-color" content="#020617"><link rel="icon" href="/favicon.png"><style>${CSS}
.clubs{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.club{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:16px;background:var(--card);border:1px solid var(--line);color:var(--text);text-decoration:none}
.club:hover{border-color:var(--accent)}
.mini{width:56px;height:56px;flex:none;border-radius:14px;display:grid;place-items:center;font-weight:800;background:#0f172a;border:2px solid var(--line)}
.mini img{width:56px;height:56px;object-fit:contain}
.cname{flex:1;font-weight:700;font-size:17px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.go{color:var(--accent);font-size:24px}
.top{display:flex;align-items:center;gap:10px;color:var(--text);text-decoration:none;font-weight:800;letter-spacing:2px}
.top img{width:40px;height:40px;border-radius:10px}
code{background:#ffffff14;padding:2px 6px;border-radius:6px}
</style></head>
<body><main class="wrap">
${navBar({ href: '/', label: 'Volver' })}
<a class="top" href="/"><img src="/logo.png" alt="">PIRLO BOT</a>
<h1 style="margin-top:28px">Clubes</h1>
<div class="sub">Clubes de EA SPORTS FC Pro Clubs que publicaron su página en PIRLO BOT.</div>
<h2>Páginas publicadas</h2><div class="clubs">${items}</div>
<footer>Cada club decide si publica su página. <a href="/">Volver a PIRLO BOT</a></footer>
</main>${updateTags(currentVersion()).script}</body></html>`;
}

export function notFoundPage(): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Club no encontrado · PIRLO BOT</title><style>${CSS}</style></head><body><main class="wrap">${navBar({ href: '/clubes', label: 'Ver clubes' })}<div style="text-align:center;padding-top:60px"><h1>Club no encontrado</h1><p class="sub">Esta página no existe o el club no la ha publicado.</p><p><a href="/">Volver a PIRLO BOT</a></p></div></main>${updateTags(currentVersion()).script}</body></html>`;
}

// ---------------------------------------------------------------------------
// Goleadores reales para la página principal (se incrusta en un iframe; sin JavaScript)
// ---------------------------------------------------------------------------

export interface TopScorer {
  name: string;
  clubName: string;
  slug: string;
  goals: number;
  matches: number | null;
}

/** Máximo de clubes públicos consultados por petición (la respuesta se cachea 5 minutos). */
const MAX_CLUBS = 20;

/** Máximos goleadores de la temporada actual entre los clubes con la página publicada. */
export async function loadTopScorers(repos: Repositories, limit = 5): Promise<TopScorer[]> {
  const clubs = (await repos.clubs.listPublic()).slice(0, MAX_CLUBS);
  const pages = await Promise.all(clubs.map((c) => loadClubPage(repos, c.slug)));
  const all: (TopScorer & { assists: number })[] = [];
  for (const page of pages) {
    if (!page) continue;
    for (const p of page.players) {
      if (p.goals === null || p.goals <= 0) continue;
      all.push({
        name: p.name,
        clubName: page.club.name,
        slug: page.club.slug,
        goals: p.goals,
        matches: p.matchesPlayed,
        assists: p.assists ?? 0,
      });
    }
  }
  return all
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name, 'es'))
    .slice(0, limit)
    .map(({ assists: _assists, ...s }) => s);
}

export function renderScorersWidget(scorers: TopScorer[]): string {
  const rows = scorers.length
    ? scorers
        .map(
          (s, i) =>
            `<a class="row" href="/club/${encodeURIComponent(s.slug)}" target="_top"><b>${i + 1}</b>` +
            `<span class="who"><span class="n">${esc(s.name)}</span><span class="c">${esc(s.clubName)}` +
            `${s.matches ? ` · ${s.matches} PJ` : ''}</span></span><span class="g">${s.goals}</span></a>`,
        )
        .join('')
    : `<p class="empty">Todavía no hay goles registrados esta temporada. <a href="/clubes" target="_top">Ver clubes</a></p>`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Goleadores · PIRLO BOT</title>
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}html,body{margin:0;background:transparent;color:#e8eef7;font-family:Rajdhani,system-ui,sans-serif}
h3{font-size:17px;margin:0 0 6px;font-weight:700}
.row{display:grid;grid-template-columns:26px 1fr auto;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #ffffff0f;color:inherit;text-decoration:none;font-size:16px}
.row:last-child{border-bottom:0}.row:hover .n{color:#5fb0ff}
.row b{color:#5fb0ff}.who{min-width:0;display:flex;flex-direction:column;line-height:1.15}
.n{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.c{font-size:13px;color:#8a99b0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.g{font-weight:700;font-size:20px}
.empty{color:#8a99b0;font-size:15px;margin:8px 0}.empty a{color:#5fb0ff}
</style></head><body><h3>Ranking de goleadores</h3>${rows}</body></html>`;
}
