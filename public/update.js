/*
 * PIRLO BOT · aviso de actualización.
 *
 * Comprueba cada minuto (y al volver a la pestaña) qué versión de PIRLO BOT está publicada. Si
 * cambió desde que se abrió la página, muestra un aviso con el botón «Actualizar», que recarga la
 * página con los cambios aplicados. Sin dependencias ni datos personales; crea el aviso con nodos DOM.
 */
(function () {
  'use strict';
  var meta = document.querySelector('meta[name="pirlo-version"]');
  var current = meta ? meta.getAttribute('content') : null;
  var shown = false;
  var INTERVAL = 60 * 1000;

  function check() {
    if (shown || document.visibilityState === 'hidden') return;
    fetch('/api/version', { cache: 'no-store', credentials: 'omit' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        var v = data && typeof data.version === 'string' ? data.version : null;
        if (!v) return;
        if (!current)
          current = v; // Páginas estáticas: la primera respuesta es la referencia.
        else if (v !== current) show();
      })
      .catch(function () {
        /* Sin conexión: se vuelve a intentar en la próxima comprobación. */
      });
  }

  function show() {
    shown = true;
    var bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    var s = bar.style;
    s.position = 'fixed';
    s.left = '50%';
    s.bottom = '20px';
    s.transform = 'translateX(-50%)';
    s.zIndex = '2147483647';
    s.display = 'flex';
    s.alignItems = 'center';
    s.gap = '14px';
    s.maxWidth = 'calc(100% - 32px)';
    s.padding = '12px 14px 12px 18px';
    s.borderRadius = '14px';
    s.background = '#0f172a';
    s.border = '1px solid #38bdf8';
    s.boxShadow = '0 10px 30px rgba(0,0,0,.45)';
    s.color = '#f8fafc';
    s.font = '600 15px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

    var text = document.createElement('span');
    text.textContent = '\uD83D\uDD04 Hay una actualizaci\u00F3n de PIRLO BOT';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Actualizar';
    var b = btn.style;
    b.font = 'inherit';
    b.fontWeight = '700';
    b.padding = '8px 14px';
    b.border = '0';
    b.borderRadius = '10px';
    b.background = '#38bdf8';
    b.color = '#020617';
    b.cursor = 'pointer';
    b.flex = 'none';
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Actualizando\u2026';
      window.location.reload();
    });

    bar.appendChild(text);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  check();
  setInterval(check, INTERVAL);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') check();
  });
})();
