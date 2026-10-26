import type { Hono } from 'hono';
import {
  GAMING_CONNECTIONS,
  type GamingAccount,
  type GamingPlatform,
} from '../core/account-link.js';
import type { DiscordAccountMembership, Repositories } from '../db/repositories/types.js';
import {
  ACCOUNT_PATH,
  ACCOUNTS_SEEN,
  cookies,
  readSession,
  USER_SESSION,
  userSessionKey,
} from './panel.js';
import { currentVersion, updateTags } from './version.js';

/**
 * «Mi cuenta»: el jugador entra con Discord y PIRLO vincula solo su gamertag.
 *
 * Al iniciar sesión se piden las cuentas conectadas en Discord (PlayStation, Xbox, Steam, Epic);
 * el inicio de sesión (/panel/callback) vincula el gamertag en cada club de la plantilla del
 * jugador cuyo nombre el club ya conoce. Esta página muestra el resultado y enlaza sus fichas.
 */

export interface AccountDeps {
  repos: Repositories | null;
  clientSecret: string | undefined;
  now?: () => number;
  log?: { error: (obj: object, msg: string) => void };
}

const HEADERS = {
  'content-security-policy':
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'cache-control': 'no-store',
};

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

/** Cuentas detectadas en el último inicio de sesión (cookie de 10 min). null = no se pudieron leer. */
export function parseSeen(value: string | undefined): GamingAccount[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === 'x') return null;
  try {
    const raw = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(raw)) return null;
    return raw
      .filter(
        (a): a is GamingAccount =>
          typeof a === 'object' &&
          a !== null &&
          typeof (a as GamingAccount).name === 'string' &&
          Object.hasOwn(GAMING_CONNECTIONS, (a as GamingAccount).platform),
      )
      .slice(0, 10);
  } catch {
    return null;
  }
}

export function registerAccountRoutes(app: Hono, deps: AccountDeps): void {
  const now = () => deps.now?.() ?? Date.now();

  app.get(ACCOUNT_PATH, async (c) => {
    if (!deps.clientSecret || !deps.repos) {
      return c.html(
        page(notice('El inicio de sesión no está disponible ahora mismo.')),
        503,
        HEADERS,
      );
    }
    const jar = cookies(c.req.header('cookie'));
    const userId = readSession(userSessionKey(deps.clientSecret), jar[USER_SESSION], now());
    if (!userId) return c.html(page(loginBody()), 200, HEADERS);
    let rows: DiscordAccountMembership[];
    try {
      rows = await deps.repos.externalPlayers.accountsOf(userId);
    } catch (err) {
      deps.log?.error({ err }, 'No se pudo cargar «Mi cuenta»');
      return c.html(
        page(notice('No se pudieron cargar tus clubes. Inténtalo de nuevo en unos minutos.')),
        500,
        HEADERS,
      );
    }
    return c.html(page(accountBody(rows, parseSeen(jar[ACCOUNTS_SEEN]))), 200, HEADERS);
  });
}

function loginBody(): string {
  return (
    '<h1>Mi cuenta</h1>' +
    '<p>Entra con tu cuenta de Discord y PIRLO vincula solo tu gamertag de EA SPORTS FC: tus estadísticas pasan a tu ficha sin escribir ningún comando.</p>' +
    '<ol class="guide"><li>En Discord abre <b>Ajustes → Conexiones</b> y conecta tu cuenta de <b>PlayStation</b>, <b>Xbox</b>, <b>Steam</b> o <b>Epic Games</b> (la que usas en FC 27).</li>' +
    '<li>Pulsa el botón y acepta que PIRLO vea tus conexiones.</li>' +
    '<li>Listo: en cada club donde estés en la plantilla, PIRLO usa el nombre de esa cuenta si el club ya lo tiene en sus estadísticas.</li></ol>' +
    `<p><a class="btn discord" href="/entrar?volver=${encodeURIComponent(ACCOUNT_PATH)}">Entrar con Discord</a></p>` +
    '<p class="meta">PIRLO solo lee tu nombre de usuario y las cuentas de juego verificadas. No publica nada ni guarda tu correo.</p>'
  );
}

function accountBody(
  rows: DiscordAccountMembership[],
  seen: GamingAccount[] | null | undefined,
): string {
  const accounts =
    seen === undefined
      ? ''
      : seen === null
        ? '<p class="warn">No pudimos leer tus conexiones de Discord. Vuelve a entrar y acepta «Conexiones».</p>'
        : seen.length === 0
          ? '<p class="warn">Tu Discord no tiene ninguna cuenta de PlayStation, Xbox, Steam o Epic conectada y verificada. Conéctala en <b>Ajustes → Conexiones</b> y vuelve a entrar.</p>'
          : `<p>Cuentas de juego en tu Discord: ${seen
              .map(
                (a) =>
                  `<span class="chip">${esc(GAMING_CONNECTIONS[a.platform as GamingPlatform])} · ${esc(a.name)}</span>`,
              )
              .join(' ')}</p>`;
  const list = rows.length
    ? `<ul class="clubs">${rows
        .map((r) => {
          const ficha = r.clubPublic
            ? ` <a href="/club/${esc(r.clubSlug)}/jugador/${r.playerId}">Ver mi ficha</a>`
            : '';
          const state = r.gamertag
            ? `<span class="ok">Gamertag: <b>${esc(r.gamertag)}</b></span>`
            : '<span class="warn-inline">Sin gamertag: tu nombre aún no aparece en las estadísticas de este club. Juega un partido con el club o pide a un DT que use <code>/plantilla gamertag</code>.</span>';
          return `<li><b>${esc(r.clubName)}</b><br>${state}${ficha}</li>`;
        })
        .join('')}</ul>`
    : '<p class="warn">Todavía no estás en la plantilla de ningún club con PIRLO BOT. En el Discord de tu club escribe <code>/vincular</code> y, cuando te aprueben, vuelve aquí.</p>';
  return `<h1>Mi cuenta</h1>${accounts}<h2>Mis clubes</h2>${list}<p><a class="btn" href="/entrar?volver=${encodeURIComponent(ACCOUNT_PATH)}">Volver a comprobar</a></p>`;
}

const notice = (text: string) => `<h1>Mi cuenta</h1><p>${esc(text)}</p>`;

function page(body: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Mi cuenta · PIRLO BOT</title><meta name="theme-color" content="#020617">
<link rel="icon" href="/favicon.png"><style>
:root{--bg:#020617;--bg2:#0b1a4a;--card:#0f172acc;--line:#1e293b;--text:#f8fafc;--muted:#94a3b8;--accent:#38bdf8;--discord:#5865f2;--ok:#4ade80;--warn:#fbbf24}
*{box-sizing:border-box}html{color-scheme:dark;min-height:100%;background:linear-gradient(160deg,var(--bg),var(--bg2)) var(--bg)}
body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--text);line-height:1.55}
a{color:var(--accent)}.wrap{max-width:640px;margin:0 auto;padding:24px 16px 48px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px}
h1{font-size:26px;margin:4px 0 12px}h2{font-size:15px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin:22px 0 10px}
.meta{color:var(--muted);font-size:14px}.guide{padding-left:20px}
.btn{font:inherit;font-weight:800;font-size:16px;padding:12px 20px;border-radius:12px;border:0;background:var(--accent);color:#020617;cursor:pointer;text-decoration:none;display:inline-block}
.btn.discord{background:var(--discord);color:#fff}
.chip{display:inline-block;padding:3px 10px;border-radius:999px;border:1px solid var(--line);background:#ffffff0d;margin:2px 0}
.clubs{list-style:none;padding:0;margin:0}.clubs li{padding:12px 0;border-top:1px solid var(--line)}.clubs li:first-child{border-top:0}
.ok{color:var(--ok)}.warn{background:#fbbf241a;border:1px solid #fbbf2455;border-radius:12px;padding:10px 14px}.warn-inline{color:var(--warn)}
.nav{display:flex;justify-content:space-between;margin-bottom:16px}
code{background:#ffffff14;padding:1px 6px;border-radius:6px}
</style>${updateTags(currentVersion()).meta}</head>
<body><main class="wrap"><nav class="nav"><a href="/clubes">← Clubes</a><a href="/">Inicio</a></nav><div class="card">${body}</div></main></body></html>`;
}
