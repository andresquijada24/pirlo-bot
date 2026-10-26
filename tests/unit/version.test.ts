import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { currentVersion, updateTags } from '../../src/web/version.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';

describe('aviso de actualización', () => {
  it('la versión sale del despliegue y nunca inyecta HTML', () => {
    expect(currentVersion({ VERCEL_GIT_COMMIT_SHA: 'abc123' })).toBe('abc123');
    expect(currentVersion({})).toBe('dev');
    expect(currentVersion({ VERCEL_GIT_COMMIT_SHA: '"><script>x' })).toBe('scriptx');
    expect(updateTags('a"b').meta).toBe('<meta name="pirlo-version" content="ab">');
  });

  it('/api/version responde sin caché', async () => {
    const app = createApp({ discordPublicKey: '0'.repeat(64), repos: createMemoryRepos().repos });
    const res = await app.request('/api/version');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ version: currentVersion() });
  });

  it('las páginas cargan el aviso y la CSP solo permite scripts propios', async () => {
    const app = createApp({ discordPublicKey: '0'.repeat(64), repos: createMemoryRepos().repos });
    for (const path of ['/clubes', '/club/no-existe']) {
      const res = await app.request(path);
      const html = await res.text();
      expect(html).toMatch('<script src="/update.js" defer></script>');
      expect(html).not.toMatch(/<script>/);
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toMatch("script-src 'self'");
      expect(csp).toMatch("connect-src 'self'");
      expect(csp).not.toMatch('unsafe-eval');
    }
    const landing = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
    expect(landing).toMatch('<script src="/update.js" defer></script>');
  });

  it('el script no usa innerHTML ni eval y solo consulta /api/version', () => {
    const js = readFileSync(new URL('../../public/update.js', import.meta.url), 'utf8');
    expect(js).not.toMatch(/innerHTML|eval\(|new Function/);
    expect(js).toMatch("fetch('/api/version'");
    expect(js).toMatch('window.location.reload()');
  });
});
