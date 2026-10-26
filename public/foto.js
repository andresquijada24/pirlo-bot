/* global document, window, URL */
/*
 * PIRLO BOT · recorte de la foto del jugador.
 *
 * Al elegir la captura, la muestra con un marco con forma de tarjeta: el jugador lo mueve y lo
 * agranda o achica (ratón o dedo) hasta encuadrar su tarjeta. El formulario envía el recorte como
 * fracciones de la imagen (recorte_x, recorte_y, recorte_w, recorte_h) y el servidor recorta.
 * Sin dependencias; la imagen no sale del navegador hasta que se pulsa «Subir foto».
 */
(function () {
  'use strict';
  var input = document.querySelector('input[name="imagen"]');
  var stage = document.getElementById('recorte');
  if (!input || !stage) return;
  var img = stage.querySelector('img');
  var frame = stage.querySelector('.marco');
  var handle = stage.querySelector('.asa');
  var fields = {
    x: document.querySelector('input[name="recorte_x"]'),
    y: document.querySelector('input[name="recorte_y"]'),
    w: document.querySelector('input[name="recorte_w"]'),
    h: document.querySelector('input[name="recorte_h"]'),
  };
  var RATIO = 0.72; // ancho / alto de una tarjeta de jugador de FC
  // Forma del marco: la de la tarjeta encontrada o, si no, la de una tarjeta estándar.
  var ratio = RATIO;
  // Marco en píxeles de la imagen mostrada.
  var box = { x: 0, y: 0, w: 0, h: 0 };
  var url = null;
  // Tarjeta encontrada en la captura (fracciones), o null para el marco centrado.
  var found = null;

  /** Busca la tarjeta en una copia reducida de la imagen (no sale del navegador). */
  function detect() {
    found = null;
    if (typeof window.detectarTarjeta !== 'function' || !img.naturalWidth) return;
    try {
      var cw = Math.min(640, img.naturalWidth);
      var ch = Math.max(1, Math.round((img.naturalHeight * cw) / img.naturalWidth));
      var canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      var g = canvas.getContext('2d');
      g.drawImage(img, 0, 0, cw, ch);
      found = window.detectarTarjeta(g.getImageData(0, 0, cw, ch).data, cw, ch);
    } catch {
      found = null; // Sin acceso a los píxeles: marco centrado.
    }
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function render() {
    var W = img.clientWidth;
    var H = img.clientHeight;
    if (!W || !H) return;
    frame.style.left = box.x + 'px';
    frame.style.top = box.y + 'px';
    frame.style.width = box.w + 'px';
    frame.style.height = box.h + 'px';
    fields.x.value = (box.x / W).toFixed(5);
    fields.y.value = (box.y / H).toFixed(5);
    fields.w.value = (box.w / W).toFixed(5);
    fields.h.value = (box.h / H).toFixed(5);
  }

  function reset() {
    var W = img.clientWidth;
    var H = img.clientHeight;
    if (found) {
      // Marco al ras de la tarjeta encontrada; al cambiar el tamaño conserva su forma.
      box = { x: found.x * W, y: found.y * H, w: found.w * W, h: found.h * H };
      ratio = box.w / box.h;
      render();
      return;
    }
    ratio = RATIO;
    var h = H * 0.8;
    var w = h * ratio;
    if (w > W * 0.9) {
      w = W * 0.9;
      h = w / ratio;
    }
    box = { x: (W - w) / 2, y: (H - h) / 2, w: w, h: h };
    render();
  }

  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    if (url) URL.revokeObjectURL(url);
    if (!file) {
      stage.hidden = true;
      return;
    }
    url = URL.createObjectURL(file);
    img.onload = function () {
      stage.hidden = false;
      detect();
      reset();
    };
    img.src = url;
  });

  // Arrastrar el marco (mover) o el asa (cambiar tamaño), con ratón o dedo.
  var drag = null;
  function start(e, mode) {
    e.preventDefault();
    e.stopPropagation();
    drag = {
      mode: mode,
      px: e.clientX,
      py: e.clientY,
      box: { x: box.x, y: box.y, w: box.w, h: box.h },
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
  }
  function move(e) {
    if (!drag) return;
    var W = img.clientWidth;
    var H = img.clientHeight;
    var dx = e.clientX - drag.px;
    var dy = e.clientY - drag.py;
    if (drag.mode === 'mover') {
      box.x = clamp(drag.box.x + dx, 0, W - box.w);
      box.y = clamp(drag.box.y + dy, 0, H - box.h);
    } else {
      // El eje que más se movió manda (hacia fuera agranda, hacia dentro achica).
      var delta = Math.abs(dx) >= Math.abs(dy * ratio) ? dx : dy * ratio;
      var w = clamp(drag.box.w + delta, 40, W - drag.box.x);
      var h = w / ratio;
      if (drag.box.y + h > H) {
        h = H - drag.box.y;
        w = h * ratio;
      }
      box.w = w;
      box.h = h;
    }
    render();
  }
  function end() {
    drag = null;
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', end);
  }
  frame.addEventListener('pointerdown', function (e) {
    start(e, 'mover');
  });
  handle.addEventListener('pointerdown', function (e) {
    start(e, 'tamano');
  });
  window.addEventListener('resize', function () {
    if (!stage.hidden) reset();
  });
})();
