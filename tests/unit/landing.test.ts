import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');

describe('public/index.html', () => {
  it('apunta la invitación a la aplicación oficial de PIRLO BOT', () => {
    expect(html).toContain('client_id=1562889315657195530');
    expect(html).toContain('scope=bot+applications.commands');
  });

  it('pide solo los permisos mínimos (Ver canales, Enviar, Enlaces, Adjuntos = 51200)', () => {
    const perms = [...html.matchAll(/permissions=(\d+)/g)].map((m) => m[1]);
    expect(perms.length).toBeGreaterThan(0);
    expect(new Set(perms)).toEqual(new Set(['51200']));
  });

  it('no contiene estadísticas ficticias en la vista de ejemplo', () => {
    expect(html).not.toMatch(/\d+\s*goles/i);
  });
});

describe('identidad visual', () => {
  it('usa el logo y el cartel oficiales, y todas las imágenes existen', () => {
    const refs = [...html.matchAll(/(?:src|href)="\/([\w.-]+\.(?:png|webp|jpg))"/g)].map((m) => m[1]!);
    expect(refs).toContain('logo.png');
    expect(refs).toContain('banner.webp');
    expect(refs).toContain('favicon.png');
    for (const f of refs) {
      expect(existsSync(new URL(`../../public/${f}`, import.meta.url))).toBe(true);
    }
  });

  it('los originales están guardados en docs/assets', () => {
    for (const f of ['pirlo-bot-logo.png', 'pirlo-bot-banner.png']) {
      expect(existsSync(new URL(`../../docs/assets/${f}`, import.meta.url))).toBe(true);
    }
  });
});
