/*
 * PIRLO BOT · busca la tarjeta del jugador en una captura de EA SPORTS FC.
 *
 * La tarjeta es la zona grande, vertical, brillante y con color que destaca sobre la interfaz
 * oscura del juego. Se marca cada píxel brillante y saturado, se agrupan en zonas conectadas y
 * se elige la mayor que tenga forma de tarjeta. Sin dependencias; lo usa /foto.js.
 */
(function (root) {
  'use strict';

  /**
   * @param data píxeles RGBA (p. ej. ImageData.data de un canvas reducido a ~320 px de ancho)
   * @returns {x, y, w, h} en fracciones de la imagen (0–1), o null si no hay nada convincente.
   */
  function detectarTarjeta(data, w, h) {
    var n = w * h;
    var mask = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var r = data[i * 4];
      var g = data[i * 4 + 1];
      var b = data[i * 4 + 2];
      var max = Math.max(r, g, b);
      var min = Math.min(r, g, b);
      var sat = max === 0 ? 0 : (max - min) / max;
      mask[i] = max > 110 && sat > 0.28 ? 1 : 0;
    }
    // Etiqueta de zona de cada píxel (0 = sin zona).
    var seen = new Int32Array(n);
    var label = 0;
    var queue = new Int32Array(n);
    var best = null;
    for (var s = 0; s < n; s++) {
      if (!mask[s] || seen[s]) continue;
      label++;
      var head = 0;
      var tail = 0;
      var count = 0;
      var x0 = w;
      var x1 = 0;
      var y0 = h;
      var y1 = 0;
      queue[tail++] = s;
      seen[s] = label;
      while (head < tail) {
        var p = queue[head++];
        var x = p % w;
        var y = (p - x) / w;
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (x > 0 && mask[p - 1] && !seen[p - 1]) {
          seen[p - 1] = label;
          queue[tail++] = p - 1;
        }
        if (x < w - 1 && mask[p + 1] && !seen[p + 1]) {
          seen[p + 1] = label;
          queue[tail++] = p + 1;
        }
        if (y > 0 && mask[p - w] && !seen[p - w]) {
          seen[p - w] = label;
          queue[tail++] = p - w;
        }
        if (y < h - 1 && mask[p + w] && !seen[p + w]) {
          seen[p + w] = label;
          queue[tail++] = p + w;
        }
      }
      var bw = x1 - x0 + 1;
      var bh = y1 - y0 + 1;
      // Forma de tarjeta: vertical, de buen tamaño y bastante llena (no un marco ni texto suelto).
      if (bh < h * 0.15 || bw < w * 0.05) continue;
      if (bw / bh < 0.45 || bw / bh > 1.1 || count / (bw * bh) < 0.35) continue;
      // Casi toda la imagen: es la propia tarjeta ya recortada o un fondo; no hay nada que buscar.
      if (bw > w * 0.95 && bh > h * 0.95) continue;
      if (!best || count > best.count)
        best = { x0: x0, y0: y0, bw: bw, bh: bh, count: count, label: label };
    }
    if (!best) return null;
    return ajustar(seen, w, best);
  }

  /**
   * Borde exacto de la tarjeta: quita los salientes pegados a ella (los pentágonos de la izquierda,
   * el ícono de posición de la derecha), que ocupan poca altura o anchura comparados con la tarjeta.
   */
  function ajustar(seen, w, best) {
    var cols = new Int32Array(best.bw);
    var rows = new Int32Array(best.bh);
    for (var y = 0; y < best.bh; y++) {
      for (var x = 0; x < best.bw; x++) {
        if (seen[(best.y0 + y) * w + best.x0 + x] === best.label) {
          cols[x]++;
          rows[y]++;
        }
      }
    }
    var l = recorte(cols);
    var t = recorte(rows);
    var W = w;
    var H = seen.length / w;
    return {
      x: (best.x0 + l[0]) / W,
      y: (best.y0 + t[0]) / H,
      w: (l[1] - l[0] + 1) / W,
      h: (t[1] - t[0] + 1) / H,
    };
  }

  /** Primer y último índice cuyo recuento llega a la mitad del máximo. */
  function recorte(counts) {
    var max = 0;
    for (var i = 0; i < counts.length; i++) if (counts[i] > max) max = counts[i];
    var a = 0;
    var b = counts.length - 1;
    while (a < b && counts[a] < max * 0.5) a++;
    while (b > a && counts[b] < max * 0.5) b--;
    return [a, b];
  }

  root.detectarTarjeta = detectarTarjeta;
})(this);
