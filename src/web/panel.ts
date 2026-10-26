import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import type { Club } from '../core/types.js';
import type { AdminClubRow, Repositories } from '../db/repositories/types.js';
import type { GuildApi } from '../discord/onboarding.js';

/**
 * Panel interno de PIRLO BOT (/panel): solo para los dueños del proyecto.
 *
 * - Inicio de sesión con Discord (OAuth2, scope "identify"). Solo entran los IDs de
 *   PIRLO_OWNER_DISCORD_IDS; cualquier otra cuenta recibe 403.
 * - Sesión en una cookie firmada (HMAC-SHA256), HttpOnly, Secure, SameSite=Lax, 12 horas.
 *   La clave se deriva del Client Secret: nunca sale del servidor ni aparece en la página.
 * - Las acciones son formularios POST con token anti-CSRF y comprobación de origen.
 * - Sin JavaScript. CSP estricta.
 */

export interface PanelDeps {
  repos: Repositories | null;
  ownerIds: ReadonlySet<string>;
  clientId: string;
  clientSecret: string | undefined;
  /** Origen público, p. ej. https://pirlo-bot.vercel.app */
  origin: string;
  /** Avisar por DM al club cuando se aprueba o rechaza desde el panel. */
  api?: GuildApi;
  fetch?: typeof fetch;
  now?: () => number;
  log?: { error: (obj: object, msg: string) => void };
}

const SESSION = 'pirlo_panel';
const STATE = 'pirlo_oauth_state';
const SESSION_HOURS = 12;
const SNOWFLAKE = /^\d{17,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const HEADERS = {
  'content-security-policy':
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

// ---------------------------------------------------------------------------
// Sesión firmada
// ---------------------------------------------------------------------------

function key(secret: string): Buffer {
  return createHmac('sha256', secret).update('pirlo-panel-session-v1').digest();
}
function mac(secret: string, data: string): string {
  return createHmac('sha256', key(secret)).update(data).digest('base64url');
}
function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function signSession(secret: string, userId: string, expiresAt: number): string {
  const data = `v1.${userId}.${expiresAt}`;
  return `${data}.${mac(secret, data)}`;
}

/** Devuelve el ID de Discord de la sesión válida o null. */
export function readSession(secret: string, token: string | undefined, now: number): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [, userId = '', exp = '', sig = ''] = parts;
  if (!SNOWFLAKE.test(userId) || !/^\d{1,15}$/.test(exp)) return null;
  if (!same(sig, mac(secret, `v1.${userId}.${exp}`))) return null;
  return Number(exp) > now ? userId : null;
}

/** Token anti-CSRF ligado a la sesión. */
export function csrfFor(secret: string, session: string): string {
  return mac(secret, `csrf.${session}`);
}

function cookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const cookie = (name: string, value: string, maxAge: number, path = '/panel') =>
  `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export function registerPanelRoutes(app: Hono, deps: PanelDeps): void {
  const now = () => deps.now?.() ?? Date.now();
  const doFetch = deps.fetch ?? fetch;
  const redirectUri = `${deps.origin}/panel/callback`;

  const session = (cookieHeader: string | undefined) => {
    if (!deps.clientSecret) return null;
    const token = cookies(cookieHeader)[SESSION];
    const userId = readSession(deps.clientSecret, token, now());
    return userId && token && deps.ownerIds.has(userId) ? { userId, token } : null;
  };

  app.get('/panel', async (c) => {
    if (!deps.clientSecret) {
      return c.html(
        page('Panel', notice('Falta configurar DISCORD_CLIENT_SECRET en Vercel.')),
        503,
        HEADERS,
      );
    }
    const s = session(c.req.header('cookie'));
    if (!s) return c.html(loginPage(c.req.query('error') ?? null), 200, HEADERS);
    if (!deps.repos)
      return c.html(page('Panel', notice('Base de datos no configurada.')), 503, HEADERS);
    try {
      const clubs = await deps.repos.clubs.listAdmin();
      const msg = c.req.query('ok') ?? null;
      return c.html(renderPanel(clubs, csrfFor(deps.clientSecret, s.token), msg), 200, HEADERS);
    } catch (err) {
      deps.log?.error({ err }, 'No se pudo cargar el panel');
      return c.html(
        page('Panel', notice('No se pudieron cargar los clubes. Inténtalo de nuevo.')),
        500,
        HEADERS,
      );
    }
  });

  app.get('/panel/login', (c) => {
    if (!deps.clientSecret) return c.redirect('/panel', 303);
    const state = randomBytes(24).toString('base64url');
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: deps.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'identify',
      state,
      prompt: 'none',
    }).toString();
    c.header('set-cookie', cookie(STATE, state, 600));
    c.header('cache-control', 'no-store');
    return c.redirect(url.toString(), 302);
  });

  app.get('/panel/callback', async (c) => {
    const secret = deps.clientSecret;
    if (!secret) return c.redirect('/panel', 303);
    const expected = cookies(c.req.header('cookie'))[STATE] ?? '';
    const state = c.req.query('state') ?? '';
    const code = c.req.query('code') ?? '';
    c.header('set-cookie', cookie(STATE, '', 0));
    if (!expected || !same(state, expected) || !/^[\w-]{10,100}$/.test(code)) {
      return c.redirect('/panel?error=sesion', 303);
    }
    let userId: string | null = null;
    try {
      const tokenRes = await doFetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: deps.clientId,
          client_secret: secret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }).toString(),
        signal: AbortSignal.timeout(5_000),
      });
      const tok = (await tokenRes.json().catch(() => ({}))) as { access_token?: unknown };
      if (tokenRes.ok && typeof tok.access_token === 'string') {
        const me = await doFetch('https://discord.com/api/v10/users/@me', {
          headers: { authorization: `Bearer ${tok.access_token}` },
          signal: AbortSignal.timeout(5_000),
        });
        const user = (await me.json().catch(() => ({}))) as { id?: unknown };
        if (me.ok && typeof user.id === 'string' && SNOWFLAKE.test(user.id)) userId = user.id;
      }
    } catch (err) {
      deps.log?.error({ err }, 'Fallo en el inicio de sesión del panel');
    }
    if (!userId) return c.redirect('/panel?error=discord', 303);
    if (!deps.ownerIds.has(userId)) {
      return c.html(
        page('Sin acceso', notice('Esta cuenta de Discord no tiene acceso al panel de PIRLO BOT.')),
        403,
        HEADERS,
      );
    }
    const exp = now() + SESSION_HOURS * 3600_000;
    // Dos cookies: se borra la del estado y se crea la de sesión.
    c.header(
      'set-cookie',
      cookie(SESSION, signSession(secret, userId, exp), SESSION_HOURS * 3600),
      { append: true },
    );
    return c.redirect('/panel', 303);
  });

  app.post('/panel/logout', async (c) => {
    c.header('set-cookie', cookie(SESSION, '', 0));
    return c.redirect('/panel', 303);
  });

  app.post('/panel/clubs/:id/estado', async (c) => {
    const secret = deps.clientSecret;
    const s = session(c.req.header('cookie'));
    if (!secret || !s || !deps.repos) return c.text('No autorizado', 401);
    const origin = c.req.header('origin');
    if (origin && origin !== deps.origin) return c.text('Origen no permitido', 403);
    const form = await c.req.parseBody();
    const csrf = typeof form.csrf === 'string' ? form.csrf : '';
    if (!same(csrf, csrfFor(secret, s.token))) return c.text('Token inválido', 403);
    const clubId = c.req.param('id');
    const estado = typeof form.estado === 'string' ? form.estado : '';
    if (!UUID.test(clubId) || !['activo', 'rechazado', 'inactivo'].includes(estado)) {
      return c.text('Petición inválida', 400);
    }
    const club = await deps.repos.clubs.findById(clubId);
    if (!club) return c.redirect('/panel?ok=no-existe', 303);
    const prev = club.status;
    await deps.repos.clubs.setStatus(clubId, estado as Club['status'], s.userId);
    // Al decidir sobre un pendiente se avisa a sus admins (igual que con los botones del DM).
    if (prev === 'pendiente' && deps.api) await notifyAdmins(deps, clubId, club.name, estado);
    return c.redirect(`/panel?ok=${estado}`, 303);
  });
}

async function notifyAdmins(
  deps: PanelDeps,
  clubId: string,
  name: string,
  estado: string,
): Promise<void> {
  if (!deps.repos || !deps.api) return;
  const admins = (await deps.repos.memberships.listActive(clubId).catch(() => [])).filter(
    (m) => m.role === 'admin',
  );
  for (const a of admins) {
    if (!a.discordUserId || !SNOWFLAKE.test(a.discordUserId)) continue;
    await deps.api
      .dm(a.discordUserId, {
        content:
          estado === 'activo'
            ? `✅ **${name}** fue aprobado. Ya puedes usar PIRLO BOT en tu servidor: empieza con \`/club info\`.`
            : `**${name}** no fue aprobado en PIRLO BOT. Si crees que es un error, contacta con el equipo.`,
        allowed_mentions: { parse: [] },
      })
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

const CSS = `
:root{--bg:#020617;--bg2:#0b1a4a;--card:#0f172acc;--line:#1e293b;--text:#f8fafc;--muted:#94a3b8;--accent:#38bdf8;--w:#22c55e;--d:#eab308;--l:#ef4444;--discord:#5865f2}
*{box-sizing:border-box}html{color-scheme:dark;min-height:100%;background:linear-gradient(160deg,var(--bg),var(--bg2)) var(--bg)}
body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--text)}
a{color:var(--accent)}.wrap{max-width:1100px;margin:0 auto;padding:24px 16px 48px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:2px;color:var(--text);text-decoration:none}
.brand img{width:40px;height:40px;border-radius:10px}.tag{font-size:12px;letter-spacing:1px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 10px}
h1{font-size:28px;margin:28px 0 6px}.sub{color:var(--muted)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:22px 0}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.kpi b{display:block;font-size:30px}.kpi span{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:1px}
h2{font-size:14px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin:30px 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.club{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:14px 16px;border-top:1px solid var(--line)}
.club:first-child{border-top:0}.name{font-weight:700;font-size:17px}.meta{color:var(--muted);font-size:13px;margin-top:3px}
.st{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;margin-left:8px;vertical-align:middle}
.st.activo{background:#22c55e26;color:var(--w)}.st.pendiente{background:#eab30826;color:var(--d)}.st.rechazado,.st.inactivo{background:#ef444426;color:var(--l)}
.acts{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}form{margin:0}
button,.btn{font:inherit;font-weight:700;font-size:14px;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:#ffffff0d;color:var(--text);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:8px}
button.ok{background:#16a34a;border-color:#16a34a}button.no{background:#dc262633;border-color:#dc2626;color:#fecaca}
.btn.discord{background:var(--discord);border-color:var(--discord);font-size:17px;padding:12px 20px}
.empty{padding:20px;color:var(--muted);text-align:center}.note{padding:12px 16px;border-radius:12px;background:#38bdf81a;border:1px solid #38bdf855;margin-top:16px}
.err{background:#ef44441a;border-color:#ef444455}.soon{padding:16px;color:var(--muted)}
.center{text-align:center;padding-top:70px}.center img{width:96px;height:96px;border-radius:22px}
@media (max-width:640px){.club{grid-template-columns:1fr}.acts{justify-content:flex-start}}
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} · PIRLO BOT</title>
<meta name="theme-color" content="#020617"><link rel="icon" href="/favicon.png"><style>${CSS}</style></head>
<body><main class="wrap">${body}</main></body></html>`;
}

const notice = (text: string) =>
  `<div class="center"><img src="/logo.png" alt=""><h1>Panel de PIRLO BOT</h1><p class="sub">${esc(text)}</p><p><a href="/">Volver a PIRLO BOT</a></p></div>`;

export function loginPage(error: string | null): string {
  const msg =
    error === 'discord'
      ? '<p class="note err">Discord no confirmó el inicio de sesión. Inténtalo de nuevo.</p>'
      : error === 'sesion'
        ? '<p class="note err">La sesión caducó. Vuelve a iniciar sesión.</p>'
        : '';
  return page(
    'Panel',
    `<div class="center"><img src="/logo.png" alt=""><h1>Panel de PIRLO BOT</h1>
<p class="sub">Acceso solo para el equipo de PIRLO BOT.</p>${msg}
<p style="margin-top:26px"><a class="btn discord" href="/panel/login">Iniciar sesión con Discord</a></p>
<p style="margin-top:20px"><a href="/">Volver a PIRLO BOT</a></p></div>`,
  );
}

const STATUS_LABEL: Record<Club['status'], string> = {
  activo: 'Activo',
  pendiente: 'Pendiente',
  rechazado: 'Rechazado',
  inactivo: 'Desactivado',
};

function actions(c: AdminClubRow, csrf: string): string {
  const form = (estado: string, label: string, cls: string) =>
    `<form method="post" action="/panel/clubs/${c.id}/estado"><input type="hidden" name="csrf" value="${esc(csrf)}">` +
    `<input type="hidden" name="estado" value="${estado}"><button class="${cls}" type="submit">${label}</button></form>`;
  if (c.status === 'pendiente')
    return form('activo', 'Aprobar', 'ok') + form('rechazado', 'Rechazar', 'no');
  if (c.status === 'activo') return form('inactivo', 'Desactivar', 'no');
  return form('activo', 'Activar', 'ok');
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('es-VE', {
        timeZone: 'America/Caracas',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
}

export function renderPanel(clubs: AdminClubRow[], csrf: string, ok: string | null): string {
  const count = (s: Club['status']) => clubs.filter((c) => c.status === s).length;
  const row = (c: AdminClubRow) => {
    const servers = c.guilds.map((g) => esc(g.name ?? g.id)).join(', ') || 'sin servidor';
    const extras = [
      `${c.members} miembro${c.members === 1 ? '' : 's'}`,
      c.eaLinked ? 'EA vinculado' : 'sin EA',
      c.webPublic ? `<a href="/club/${encodeURIComponent(c.slug)}">web pública</a>` : 'web privada',
      `alta ${when(c.createdAt)}`,
    ].join(' · ');
    return `<div class="club"><div><div class="name">${esc(c.name)}<span class="st ${c.status}">${STATUS_LABEL[c.status]}</span></div>
<div class="meta"><code>${esc(c.slug)}</code> · ${servers}</div><div class="meta">${extras}</div></div>
<div class="acts">${actions(c, csrf)}</div></div>`;
  };
  const pending = clubs.filter((c) => c.status === 'pendiente');
  const others = clubs.filter((c) => c.status !== 'pendiente');
  const okMsg: Record<string, string> = {
    activo: 'Club activado.',
    rechazado: 'Club rechazado.',
    inactivo: 'Club desactivado.',
    'no-existe': 'Ese club ya no existe.',
  };
  return page(
    'Panel',
    `<div class="top"><a class="brand" href="/"><img src="/logo.png" alt="">PIRLO BOT</a>
<div style="display:flex;gap:10px;align-items:center"><span class="tag">Panel interno</span>
<form method="post" action="/panel/logout"><button type="submit">Cerrar sesión</button></form></div></div>
<h1>Panel</h1><div class="sub">Clubes de PIRLO BOT y su aprobación.</div>
${ok && okMsg[ok] ? `<p class="note">${okMsg[ok]}</p>` : ''}
<div class="kpis"><div class="kpi"><b>${clubs.length}</b><span>Clubes</span></div>
<div class="kpi"><b>${count('activo')}</b><span>Activos</span></div>
<div class="kpi"><b>${count('pendiente')}</b><span>Pendientes</span></div>
<div class="kpi"><b>${clubs.reduce((n, c) => n + c.members, 0)}</b><span>Miembros</span></div></div>
<h2>Pendientes de aprobación</h2><div class="card">${pending.length ? pending.map(row).join('') : '<p class="empty">No hay clubes pendientes.</p>'}</div>
<h2>Todos los clubes</h2><div class="card">${others.length ? others.map(row).join('') : '<p class="empty">Todavía no hay clubes.</p>'}</div>
<h2>Planes y cobros</h2><div class="card"><p class="soon">Próximamente: planes por club, facturación y límites. Aquí se gestionará la monetización.</p></div>`,
  );
}
