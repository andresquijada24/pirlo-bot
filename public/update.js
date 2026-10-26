/* global document, window, fetch, setInterval */
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
    // Capa que oscurece la página y, en el centro, la tarjeta con el botón.
    var overlay = document.createElement('div');
    var o = overlay.style;
    o.position = 'fixed';
    o.inset = '0';
    o.zIndex = '2147483647';
    o.display = 'flex';
    o.alignItems = 'center';
    o.justifyContent = 'center';
    o.padding = '16px';
    o.background = 'rgba(2,6,23,.72)';

    var card = document.createElement('div');
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-live', 'assertive');
    card.setAttribute('aria-label', 'Actualizaci\u00F3n disponible');
    var s = card.style;
    s.display = 'flex';
    s.flexDirection = 'column';
    s.alignItems = 'center';
    s.gap = '16px';
    s.width = '100%';
    s.maxWidth = '360px';
    s.padding = '26px 22px';
    s.borderRadius = '18px';
    s.background = '#0f172a';
    s.border = '1px solid #38bdf8';
    s.boxShadow = '0 20px 60px rgba(0,0,0,.55)';
    s.color = '#f8fafc';
    s.textAlign = 'center';
    s.font = '600 17px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

    var icon = document.createElement('div');
    icon.textContent = '\uD83D\uDD04';
    icon.style.fontSize = '34px';

    var text = document.createElement('div');
    text.textContent = 'Hay una actualizaci\u00F3n de PIRLO BOT';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Actualizar';
    var b = btn.style;
    b.font = 'inherit';
    b.fontWeight = '800';
    b.fontSize = '17px';
    b.width = '100%';
    b.padding = '13px 18px';
    b.border = '0';
    b.borderRadius = '12px';
    b.background = '#38bdf8';
    b.color = '#020617';
    b.cursor = 'pointer';
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Actualizando\u2026';
      window.location.reload();
    });

    var later = document.createElement('button');
    later.type = 'button';
    later.textContent = 'M\u00E1s tarde';
    var l = later.style;
    l.font = 'inherit';
    l.fontSize = '14px';
    l.fontWeight = '600';
    l.border = '0';
    l.background = 'transparent';
    l.color = '#94a3b8';
    l.cursor = 'pointer';
    later.addEventListener('click', function () {
      overlay.remove();
    });

    card.appendChild(icon);
    card.appendChild(text);
    card.appendChild(btn);
    card.appendChild(later);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    btn.focus();
  }

  check();
  setInterval(check, INTERVAL);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') check();
  });
})();
