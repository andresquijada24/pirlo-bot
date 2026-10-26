#!/usr/bin/env python3
"""Genera los recursos del renderizador de imágenes (src/render/assets/).

- Trazos de la fuente Inter (SIL OFL 1.1) para los caracteres que usa PIRLO: así el PNG no depende
  de las fuentes instaladas en el servidor.
- El logo ORIGINAL de docs/assets reducido a 96 px (solo se escala; no es un logo distinto).

Uso (requiere fontTools y Pillow, solo para regenerar):
  python3 scripts/build-render-assets.py /ruta/Inter-Bold.otf /ruta/Inter-Medium.otf
"""
import base64, io, json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

CHARS = ''.join(chr(c) for c in range(32, 127)) + 'áéíóúÁÉÍÓÚñÑüÜ¿¡·–—×…'

def glyphs(path):
    f = TTFont(path)
    cmap = f.getBestCmap()
    gs = f.getGlyphSet()
    hmtx = f['hmtx']
    out = {}
    for ch in CHARS:
        name = cmap.get(ord(ch))
        if not name:
            continue
        pen = SVGPathPen(gs)
        gs[name].draw(pen)
        # Coordenadas enteras: reduce el tamaño sin pérdida visible.
        d = pen.getCommands()
        out[ch] = [hmtx[name][0], d]
    return {'unitsPerEm': f['head'].unitsPerEm, 'ascender': f['hhea'].ascent, 'glyphs': out}

def main():
    bold, medium = sys.argv[1], sys.argv[2]
    data = {'bold': glyphs(bold), 'medium': glyphs(medium)}
    with open('src/render/assets/inter.ts', 'w') as fh:
        fh.write('// Generado por scripts/build-render-assets.py: trazos de Inter (SIL OFL 1.1, ver LICENSE-Inter.txt).\n')
        fh.write('// [avance, trazo SVG en unidades de la fuente; eje Y hacia arriba]\n/* eslint-disable */\n')
        fh.write('export const INTER = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ' as const;\n')
    from PIL import Image
    img = Image.open('docs/assets/pirlo-bot-logo.png').convert('RGBA')
    img.thumbnail((96, 96), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'PNG', optimize=True)
    with open('src/render/assets/logo.ts', 'w') as fh:
        fh.write('// Generado por scripts/build-render-assets.py: logo original de docs/assets, escalado a 96 px.\n')
        fh.write(f"export const LOGO_PNG_BASE64 = '{base64.b64encode(buf.getvalue()).decode()}';\n")
        fh.write(f'export const LOGO_SIZE = {{ width: {img.width}, height: {img.height} }};\n')

main()
