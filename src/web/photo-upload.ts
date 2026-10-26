import { randomBytes } from 'node:crypto';
import type { Hono } from 'hono';
import type { Repositories } from '../db/repositories/types.js';
import { isDomainError } from '../core/errors.js';
import { normalizePhoto, parseCrop } from '../render/photo.js';
import {
  cookie,
  cookies,
  csrfFor,
  readSession,
  RETURN_TO,
  SAFE_RETURN,
  same,
  STATE,
  USER_SESSION,
  userSessionKey,
} from './panel.js';
import { currentVersion, updateTags } from './version.js';

/**
 * Subir la foto del jugador desde la web (además de /plantilla foto en Discord).
 *
 * /club/<club>/jugador/<id>/foto — página sin caché: pide iniciar sesión con Discord (la misma
 * aplicación OAuth que el panel, scope "identify"), y solo deja subir la foto al propio jugador o a
 * un admin/DT de ese club. La base de datos vuelve a comprobarlo al guardar.
 */

export interface PhotoUploadDeps {
  repos: Repositories | null;
  clientId: string;
  clientSecret: string | undefined;
  origin: string;
  now?: () => number;
  log?: { error: (obj: object, msg: string) => void };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_BYTES = 4 * 1024 * 1024;
const HEADERS = {
  'content-security-policy':
    "default-src 'none'; img-src 'self' data: blob:; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  // same-origin: el navegador envía el Origin real en los formularios (con no-referrer envía «null»).
  'referrer-policy': 'same-origin',
  'cache-control': 'no-store',
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function registerPhotoUploadRoutes(app: Hono, deps: PhotoUploadDeps): void {
  const now = () => deps.now?.() ?? Date.now();

  /** Usuario con sesión iniciada desde una ficha (o null). */
  const user = (cookieHeader: string | undefined) => {
    if (!deps.clientSecret) return null;
    const token = cookies(cookieHeader)[USER_SESSION];
    const userId = readSession(userSessionKey(deps.clientSecret), token, now());
    return userId && token ? { userId, token } : null;
  };

  /** Club público, ficha del jugador y permiso del usuario sobre ella. */
  async function context(slug: string, playerId: string, userId: string | null) {
    if (!deps.repos || !UUID.test(playerId)) return null;
    const club = await deps.repos.clubs.findPublic(slug.toLowerCase());
    if (!club) return null;
    const roster = await deps.repos.memberships.listActive(club.id);
    const target = roster.find((m) => m.playerId === playerId);
    if (!target) return null;
    const actor = userId ? roster.find((m) => m.discordUserId === userId) : undefined;
    const allowed =
      userId !== null && (target.discordUserId === userId || actor?.role === 'admin' || actor?.role === 'dt');
    return { club, target, allowed };
  }

  app.get('/entrar', (c) => {
    const back = c.req.query('volver') ?? '';
    if (!deps.clientSecret || !SAFE_RETURN.test(back)) return c.redirect('/', 303);
    const state = randomBytes(24).toString('base64url');
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: deps.clientId,
      response_type: 'code',
      redirect_uri: `${deps.origin}/panel/callback`,
      scope: 'identify',
      state,
      prompt: 'none',
    }).toString();
    c.header('set-cookie', cookie(STATE, state, 600));
    c.header('set-cookie', cookie(RETURN_TO, encodeURIComponent(back), 600), { append: true });
    c.header('cache-control', 'no-store');
    return c.redirect(url.toString(), 302);
  });

  app.get('/club/:slug/jugador/:id/foto', async (c) => {
    const slug = c.req.param('slug').toLowerCase();
    const id = c.req.param('id');
    const u = user(c.req.header('cookie'));
    const ctx = await context(slug, id, u?.userId ?? null).catch(() => null);
    if (!ctx) return c.html(page('Ficha no encontrada', '<p>Esta ficha no existe o el club no la ha publicado.</p>', slug), 404, HEADERS);
    const back = `/club/${ctx.club.slug}/jugador/${id}`;
    const name = esc(ctx.target.displayName);
    const status = c.req.query('error');
    const error = status ? `<p class="err">${esc(ERRORS[status] ?? 'No se pudo guardar la foto.')}</p>` : '';
    if (!deps.clientSecret) {
      return c.html(page('Subir foto', '<p>La subida desde la web no está disponible ahora mismo. Usa <code>/plantilla foto</code> en Discord.</p>', slug, back), 503, HEADERS);
    }
    if (!u) {
      return c.html(
        page(
          `Foto de ${name}`,
          `<p>Para subir la foto de <b>${name}</b> inicia sesión con tu cuenta de Discord. Solo el propio jugador o un DT/admin de ${esc(ctx.club.name)} pueden cambiarla.</p>` +
            `<p><a class="btn discord" href="/entrar?volver=${encodeURIComponent(`${back}/foto`)}">Iniciar sesión con Discord</a></p>`,
          slug,
          back,
        ),
        200,
        HEADERS,
      );
    }
    if (!ctx.allowed) {
      return c.html(
        page('Sin permiso', `<p>Tu cuenta de Discord no puede cambiar la foto de <b>${name}</b>: solo el propio jugador o un DT/admin del club.</p>`, slug, back),
        403,
        HEADERS,
      );
    }
    return c.html(
      page(
        `Foto de ${name}`,
        error +
          GUIDE +
          `<form method="post" enctype="multipart/form-data" action="${back}/foto">` +
          `<input type="hidden" name="csrf" value="${esc(csrfFor(userSessionKey(deps.clientSecret), u.token))}">` +
          '<label class="file">Captura de The Grounds (PNG o JPG, máx. 4 MB)<input type="file" name="imagen" accept="image/png,image/jpeg,image/webp" required></label>' +
          CROP +
          '<button class="btn" type="submit">Subir foto</button></form><script src="/foto.js" defer></script>',
        slug,
        back,
      ),
      200,
      HEADERS,
    );
  });

  app.post('/club/:slug/jugador/:id/foto', async (c) => {
    const secret = deps.clientSecret;
    const u = user(c.req.header('cookie'));
    const slug = c.req.param('slug').toLowerCase();
    const id = c.req.param('id');
    if (!secret || !u || !deps.repos) return c.text('Inicia sesión con Discord', 401);
    const origin = c.req.header('origin');
    // Sin Origin, o «null» (páginas abiertas antes de este cambio), decide el token anti-CSRF.
    if (origin && origin !== 'null' && origin !== deps.origin) return c.text('Origen no permitido', 403);
    const declared = Number(c.req.header('content-length') ?? '0');
    if (declared > MAX_BYTES + 64 * 1024) return c.redirect(`/club/${slug}/jugador/${id}/foto?error=grande`, 303);
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const csrf = typeof form.csrf === 'string' ? form.csrf : '';
    if (!same(csrf, csrfFor(userSessionKey(secret), u.token))) return c.text('Token inválido', 403);
    const ctx = await context(slug, id, u.userId);
    if (!ctx) return c.text('Ficha no encontrada', 404);
    if (!ctx.allowed) return c.text('Sin permiso', 403);
    const file = form.imagen;
    const back = `/club/${ctx.club.slug}/jugador/${id}`;
    if (!(file instanceof File) || file.size === 0) return c.redirect(`${back}/foto?error=vacia`, 303);
    if (file.size > MAX_BYTES) return c.redirect(`${back}/foto?error=grande`, 303);
    try {
      const jpg = await normalizePhoto(new Uint8Array(await file.arrayBuffer()), parseCrop(form));
      await deps.repos.memberships.setPhoto(ctx.club.id, ctx.target.id, jpg, u.userId);
    } catch (err) {
      if (!isDomainError(err)) deps.log?.error({ err }, 'No se pudo guardar la foto desde la web');
      return c.redirect(`${back}/foto?error=${isDomainError(err) ? 'imagen' : 'interno'}`, 303);
    }
    // ?v= evita que el navegador muestre la ficha guardada en caché con la foto anterior.
    return c.redirect(`${back}?v=${now()}`, 303);
  });
}

const ERRORS: Record<string, string> = {
  vacia: 'Elige una imagen.',
  grande: 'La imagen es demasiado grande (máx. 4 MB).',
  imagen: 'Esa imagen no se pudo usar. Prueba con una captura PNG o JPG.',
  interno: 'Algo falló al guardar la foto. Inténtalo de nuevo en unos minutos.',
};

const GUIDE =
  '<ol class="guide"><li>En EA SPORTS FC 27 entra en <b>Clubes → The Grounds</b> con tu Pro.</li>' +
  '<li>Ponte de frente a la cámara y quita los menús de la pantalla.</li>' +
  '<li>Haz una captura: <b>PS5</b> botón Crear → Captura · <b>Xbox</b> botón Compartir · <b>PC</b> tecla de captura.</li>' +
  '<li>Pásala a este dispositivo (app de PlayStation o Xbox, o la carpeta de capturas) y súbela aquí.</li></ol>' +
  '<p class="meta">Al elegirla, encuadra tu tarjeta con el marco: muévelo y cambia su tamaño desde la esquina. La ficha la muestra tal cual.</p>';

/** Vista previa con el marco de recorte (lo maneja /foto.js; sin JavaScript se recorta solo). */
const CROP =
  '<div id="recorte" hidden><img alt="Vista previa de la captura"><div class="marco"><span class="asa" aria-label="Cambiar tamaño"></span></div></div>' +
  ['x', 'y', 'w', 'h'].map((k) => `<input type="hidden" name="recorte_${k}" value="">`).join('');

function page(title: string, body: string, slug: string, back?: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${title} · PIRLO BOT</title><meta name="theme-color" content="#020617">
<link rel="icon" href="/favicon.png"><style>
:root{--bg:#020617;--bg2:#0b1a4a;--card:#0f172acc;--line:#1e293b;--text:#f8fafc;--muted:#94a3b8;--accent:#38bdf8;--discord:#5865f2}
*{box-sizing:border-box}html{color-scheme:dark;min-height:100%;background:linear-gradient(160deg,var(--bg),var(--bg2)) var(--bg)}
body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--text)}
a{color:var(--accent)}.wrap{max-width:640px;margin:0 auto;padding:24px 16px 48px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px}
h1{font-size:26px;margin:18px 0 12px}.meta{color:var(--muted);font-size:14px}
.guide{line-height:1.7;padding-left:20px}
.btn{font:inherit;font-weight:800;font-size:16px;padding:12px 20px;border-radius:12px;border:0;background:var(--accent);color:#020617;cursor:pointer;text-decoration:none;display:inline-block}
.btn.discord{background:var(--discord);color:#fff}
.file{display:block;margin:16px 0;color:var(--muted);font-size:14px}.file input{display:block;margin-top:8px;color:var(--text)}
.err{background:#ef44441a;border:1px solid #ef444455;border-radius:12px;padding:10px 14px}
code{background:#ffffff14;padding:1px 6px;border-radius:6px}
#recorte{position:relative;overflow:hidden;border-radius:10px;margin:0 0 16px;user-select:none;touch-action:none;line-height:0}
#recorte img{width:100%;height:auto;border-radius:10px;display:block}
.marco{position:absolute;border:2px solid var(--accent);border-radius:8px;box-shadow:0 0 0 9999px #020617b3;cursor:move;touch-action:none}
.asa{position:absolute;right:-4px;bottom:-4px;width:22px;height:22px;border-radius:50%;background:var(--accent);border:3px solid #020617;cursor:nwse-resize;touch-action:none}
</style>${updateTags(currentVersion()).meta}</head>
<body><main class="wrap"><p><a href="${back ?? `/club/${esc(slug)}`}">← Volver a la ficha</a></p><div class="card"><h1>${title}</h1>${body}</div></main></body></html>`;
}
